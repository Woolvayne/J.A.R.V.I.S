"""
J.A.R.V.I.S – MCP-Client (Model Context Protocol), leichtgewichtig für den Raspberry Pi.

JARVIS ist der MCP-Host: Er verbindet sich mit BELIEBIGEN MCP-Servern
(Konfiguration in mcp_servers.json), fragt deren Tools ab (tools/list) und
reicht sie als Function-Calling-Tools an die Cloud-KI (Groq/Gemini/…) weiter.
Entscheidet sich die KI für ein Tool, ruft JARVIS tools/call beim passenden
Server auf und gibt das Ergebnis an die KI zurück.

Unterstützte Transporte (Standard-MCP):
  - stdio            (Server als lokaler Prozess, z. B. `uvx mcp-server-time`)
  - Streamable HTTP  (Server unter einer URL, JSON oder SSE-Antworten)

Bewusst NUR mit Python-Standardbibliothek + requests umgesetzt – kein schweres
SDK nötig, ideal für den Pi 3B+ (1 GB RAM). Protokoll: JSON-RPC 2.0.

Sicherheit: MCP-Server laufen mit deinen Rechten. Nur vertrauenswürdige
Server aktivieren! API-Keys gehören in die env/headers der Server-Config,
nie in den Chat.
"""
from __future__ import annotations

import json
import os
import queue
import re
import subprocess
import threading
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
PROTOCOL_VERSION = "2024-11-05"
CALL_TIMEOUT = float(os.getenv("MCP_TIMEOUT", "20"))


def enabled() -> bool:
    return os.getenv("MCP_ENABLED", "1").lower() not in ("0", "false", "no", "off")


def _config_path() -> Path:
    p = os.getenv("MCP_SERVERS_FILE", "")
    return Path(p) if p else ROOT / "mcp_servers.json"


def load_server_configs() -> list[dict]:
    """Serverliste aus mcp_servers.json lesen (fehlende Datei = keine Server)."""
    path = _config_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        servers = data.get("servers", []) if isinstance(data, dict) else data
        out = []
        for s in servers:
            if not isinstance(s, dict) or not s.get("name"):
                continue
            s.setdefault("enabled", False)
            s.setdefault("transport", "stdio" if s.get("command") else "http")
            out.append(s)
        return out
    except Exception:
        return []


def _sanitize(name: str) -> str:
    """OpenAI-Toolnamen dürfen nur [a-zA-Z0-9_-] enthalten (max 64 Zeichen)."""
    return re.sub(r"[^a-zA-Z0-9_-]", "_", str(name))[:64]


def _stringify_result(result) -> str:
    """MCP-Ergebnis (content-Blöcke) in kompakten Text für die KI verwandeln."""
    try:
        if isinstance(result, dict) and isinstance(result.get("content"), list):
            parts = []
            for block in result["content"]:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(str(block.get("text", "")))
                elif isinstance(block, dict):
                    parts.append(json.dumps(block, ensure_ascii=False))
            text = "\n".join(p for p in parts if p)
            if result.get("isError"):
                return "MCP-Tool meldet Fehler: " + text
            return text[:6000] or "(leeres Ergebnis)"
        return json.dumps(result, ensure_ascii=False)[:6000]
    except Exception:
        return str(result)[:6000]


# ---------------------------------------------------------------- stdio-Client
class _StdioClient:
    """Ein MCP-Server als lokaler Prozess (JSON-RPC zeilenweise über stdio)."""

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.name = cfg["name"]
        self.proc: subprocess.Popen | None = None
        self._lock = threading.Lock()
        self._waiters: dict[int, queue.Queue] = {}
        self._next_id = 0
        self._initialized = False
        self.error: str | None = None

    def _start(self):
        cmd = [self.cfg["command"]] + [str(a) for a in self.cfg.get("args", [])]
        env = dict(os.environ)
        env.update({str(k): str(v) for k, v in (self.cfg.get("env") or {}).items()})
        self.proc = subprocess.Popen(
            cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1, env=env,
        )
        threading.Thread(target=self._reader, daemon=True).start()

    def _reader(self):
        try:
            for line in self.proc.stdout:  # type: ignore[union-attr]
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    msg = json.loads(line)
                except Exception:
                    continue
                mid = msg.get("id")
                if mid in self._waiters:
                    self._waiters[mid].put(msg)
        except Exception:
            pass

    def _send(self, payload: dict):
        self.proc.stdin.write(json.dumps(payload) + "\n")  # type: ignore[union-attr]
        self.proc.stdin.flush()  # type: ignore[union-attr]

    def request(self, method: str, params: dict | None = None, timeout: float = CALL_TIMEOUT):
        with self._lock:
            self._ensure()
            self._next_id += 1
            mid = self._next_id
            q: queue.Queue = queue.Queue()
            self._waiters[mid] = q
            try:
                self._send({"jsonrpc": "2.0", "id": mid, "method": method, "params": params or {}})
                msg = q.get(timeout=timeout)
            except queue.Empty:
                raise TimeoutError(f"MCP-Server '{self.name}': Timeout bei {method}")
            finally:
                self._waiters.pop(mid, None)
            if "error" in msg:
                raise RuntimeError(f"MCP-Fehler {method}: {msg['error']}")
            return msg.get("result", {})

    def _ensure(self):
        if self.proc and self.proc.poll() is None and self._initialized:
            return
        self._start()
        self._next_id += 1
        mid = self._next_id
        q: queue.Queue = queue.Queue()
        self._waiters[mid] = q
        try:
            self._send({
                "jsonrpc": "2.0", "id": mid, "method": "initialize",
                "params": {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {"name": "jarvis-pi", "version": "1.1.0"},
                },
            })
            msg = q.get(timeout=CALL_TIMEOUT)
            if "error" in msg:
                raise RuntimeError(f"initialize fehlgeschlagen: {msg['error']}")
        finally:
            self._waiters.pop(mid, None)
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        self._initialized = True
        self.error = None

    def list_tools(self) -> list[dict]:
        return self.request("tools/list").get("tools", [])

    def call_tool(self, tool: str, arguments: dict):
        return self.request("tools/call", {"name": tool, "arguments": arguments or {}})

    def close(self):
        try:
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()
        except Exception:
            pass
        self.proc = None
        self._initialized = False


# ----------------------------------------------------------------- HTTP-Client
class _HttpClient:
    """MCP-Server per Streamable HTTP (JSON- oder SSE-Antwort)."""

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.name = cfg["name"]
        self.url = cfg["url"]
        self.headers = {str(k): str(v) for k, v in (cfg.get("headers") or {}).items()}
        self._session_id: str | None = None
        self._next_id = 0
        self._initialized = False
        self.error: str | None = None

    def _post(self, payload: dict, timeout: float = CALL_TIMEOUT) -> dict:
        headers = {"Content-Type": "application/json",
                   "Accept": "application/json, text/event-stream", **self.headers}
        if self._session_id:
            headers["Mcp-Session-Id"] = self._session_id
        r = requests.post(self.url, json=payload, headers=headers, timeout=timeout)
        r.raise_for_status()
        sid = r.headers.get("Mcp-Session-Id")
        if sid:
            self._session_id = sid
        ctype = r.headers.get("Content-Type", "")
        if "text/event-stream" in ctype:  # SSE: data:-Zeilen parsen, passende ID suchen
            found = {}
            for line in r.text.splitlines():
                if line.startswith("data:"):
                    try:
                        msg = json.loads(line[5:].strip())
                    except Exception:
                        continue
                    if msg.get("id") == payload.get("id"):
                        return msg
                    found = msg
            return found
        return r.json() if r.text.strip() else {}

    def request(self, method: str, params: dict | None = None, timeout: float = CALL_TIMEOUT):
        self._ensure()
        self._next_id += 1
        msg = self._post({"jsonrpc": "2.0", "id": self._next_id, "method": method,
                          "params": params or {}}, timeout)
        if "error" in msg:
            raise RuntimeError(f"MCP-Fehler {method}: {msg['error']}")
        return msg.get("result", {})

    def _ensure(self):
        if self._initialized:
            return
        self._next_id += 1
        msg = self._post({
            "jsonrpc": "2.0", "id": self._next_id, "method": "initialize",
            "params": {"protocolVersion": PROTOCOL_VERSION, "capabilities": {},
                       "clientInfo": {"name": "jarvis-pi", "version": "1.1.0"}},
        })
        if "error" in msg:
            raise RuntimeError(f"initialize fehlgeschlagen: {msg['error']}")
        try:  # Initialized-Notification (Antwort egal, darf auch 202/Fehler sein)
            headers = {"Content-Type": "application/json", **self.headers}
            if self._session_id:
                headers["Mcp-Session-Id"] = self._session_id
            requests.post(self.url, json={"jsonrpc": "2.0", "method": "notifications/initialized"},
                          headers=headers, timeout=5)
        except Exception:
            pass
        self._initialized = True
        self.error = None

    def list_tools(self) -> list[dict]:
        return self.request("tools/list").get("tools", [])

    def call_tool(self, tool: str, arguments: dict):
        return self.request("tools/call", {"name": tool, "arguments": arguments or {}})

    def close(self):
        self._initialized = False
        self._session_id = None


# -------------------------------------------------------------------- Manager
class McpManager:
    """Verwaltet alle konfigurierten MCP-Server + deren Tool-Registry."""

    def __init__(self):
        self._clients: dict[str, object] = {}
        self._tools: list[dict] | None = None       # [{full, server, tool, description, schema}]
        self._tools_at = 0.0
        self._errors: dict[str, str] = {}

    # -- intern ------------------------------------------------------------
    def _client(self, cfg: dict):
        name = cfg["name"]
        if name not in self._clients:
            self._clients[name] = (_HttpClient(cfg) if cfg.get("transport") == "http"
                                   else _StdioClient(cfg))
        return self._clients[name]

    # -- öffentlich ----------------------------------------------------------
    def list_tools(self, force: bool = False) -> list[dict]:
        """Alle Tools aller aktivierten Server (60 s Cache, damit der Pi ruhig bleibt)."""
        if not enabled():
            return []
        if not force and self._tools is not None and time.time() - self._tools_at < 60:
            return self._tools
        tools: list[dict] = []
        self._errors = {}
        for cfg in load_server_configs():
            if not cfg.get("enabled"):
                continue
            try:
                client = self._client(cfg)
                for t in client.list_tools():
                    raw_name = str(t.get("name", ""))
                    full = f"{_sanitize(cfg['name'])}__{_sanitize(raw_name)}"
                    schema = t.get("inputSchema") or {"type": "object", "properties": {}}
                    if schema.get("type") != "object":
                        schema = {"type": "object", "properties": {}}
                    tools.append({
                        "full": full, "server": cfg["name"], "tool": raw_name,
                        "description": str(t.get("description", ""))[:500], "schema": schema,
                    })
            except Exception as e:  # Server kaputt/nicht installiert -> merken, weitergehen
                self._errors[cfg["name"]] = str(e)[:300]
        self._tools = tools
        self._tools_at = time.time()
        return tools

    def openai_tools(self) -> list[dict]:
        """Tools im OpenAI-Function-Calling-Format (für Groq/Gemini/…)."""
        return [{
            "type": "function",
            "function": {
                "name": t["full"],
                "description": f"[MCP:{t['server']}] {t['description']}".strip(),
                "parameters": t["schema"],
            },
        } for t in self.list_tools()]

    def call_tool(self, full_name: str, arguments: dict | None = None) -> str:
        """Ein Tool ausführen. Gibt Text für die KI zurück (wirft nie)."""
        entry = next((t for t in self.list_tools() if t["full"] == full_name), None)
        if entry is None:
            return f"Unbekanntes MCP-Tool: {full_name}"
        cfg = next((c for c in load_server_configs() if c["name"] == entry["server"]), None)
        if cfg is None or not cfg.get("enabled"):
            return f"MCP-Server '{entry['server']}' ist nicht aktiviert."
        try:
            result = self._client(cfg).call_tool(entry["tool"], arguments or {})
            return _stringify_result(result)
        except Exception as e:
            return f"MCP-Aufruf fehlgeschlagen ({full_name}): {e}"

    def status(self) -> dict:
        tools = self.list_tools()
        counts: dict[str, int] = {}
        for t in tools:
            counts[t["server"]] = counts.get(t["server"], 0) + 1
        servers = []
        for cfg in load_server_configs():
            name = cfg["name"]
            servers.append({
                "name": name,
                "transport": cfg.get("transport"),
                "enabled": bool(cfg.get("enabled")),
                "connected": name in counts,
                "tools": counts.get(name, 0),
                "error": self._errors.get(name),
                "target": cfg.get("url") or (cfg.get("command", "") + " " + " ".join(map(str, cfg.get("args", [])))).strip(),
            })
        return {
            "enabled": enabled(),
            "config_file": str(_config_path()),
            "server_count": len(servers),
            "tool_count": len(tools),
            "servers": servers,
            "tools": [{"name": t["full"], "server": t["server"], "description": t["description"]} for t in tools],
        }

    def reload(self) -> dict:
        for c in self._clients.values():
            try:
                c.close()  # type: ignore[attr-defined]
            except Exception:
                pass
        self._clients = {}
        self._tools = None
        self._tools_at = 0.0
        return self.status()


MANAGER = McpManager()
