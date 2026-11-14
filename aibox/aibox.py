#!/usr/bin/env python3
"""
J.A.R.V.I.S "AI Box" – tiny fallback brain for the Raspberry Pi (3B+ ok).

A token-guarded, OpenAI-compatible gateway in front of a local Ollama.
JARVIS (on Vercel) uses Groq as its primary AI; when Groq is unreachable,
/api/chat forwards the very same payload here – so JARVIS keeps answering,
including MCP tool calls (Composio etc.), with a tiny local model.

Endpoints:
  GET  /health               -> {"ok": true, "engine": "ollama", "model": ...,
                                 "ollama": true, "models": [...], ...}
  POST /v1/chat/completions  -> OpenAI-compatible chat completion, proxied
                                to Ollama (tools/tool_calls pass through).
                                Token via header "X-AI-Token" or
                                "Authorization: Bearer ..."

Start (normally via systemd, see deploy/aibox.service):
  AIBOX_TOKEN=secret python3 aibox.py

Listens on 127.0.0.1:8771 by default – exposed publicly ONLY through a
Cloudflare Tunnel (never port forwarding), see AIBOX.md.
Python standard library only; Ollama does the actual inference.
"""
from __future__ import annotations

import json
import os
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HOST = os.getenv("AIBOX_HOST", "127.0.0.1")
PORT = int(os.getenv("AIBOX_PORT", "8771"))
TOKEN = os.getenv("AIBOX_TOKEN", "")
MODEL = os.getenv("AIBOX_MODEL", "qwen3:0.6b")
OLLAMA = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
MAX_TOKENS_CAP = int(os.getenv("AIBOX_MAX_TOKENS", "256"))
GEN_TIMEOUT = int(os.getenv("AIBOX_TIMEOUT", "240"))


def ollama_get(path: str, timeout: float = 3.0):
    with urllib.request.urlopen(OLLAMA + path, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def list_models() -> list[str]:
    try:
        data = ollama_get("/api/tags")
        return [m.get("name", "") for m in data.get("models", [])]
    except Exception:
        return []


def chat_completion(payload: dict) -> tuple[int, bytes]:
    model = str(payload.get("model") or MODEL)
    body: dict = {
        "model": model,
        "messages": payload.get("messages") or [],
        "stream": False,
        "max_tokens": max(16, min(int(payload.get("max_tokens") or 256), MAX_TOKENS_CAP)),
        "temperature": payload.get("temperature", 0.6),
    }
    if str(model).startswith("qwen3"):
        body["think"] = False  # no long reasoning monologues on a Pi
    if isinstance(payload.get("tools"), list) and payload["tools"]:
        body["tools"] = payload["tools"]
        body["tool_choice"] = payload.get("tool_choice", "auto")
    req = urllib.request.Request(
        OLLAMA + "/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=GEN_TIMEOUT) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


class Handler(BaseHTTPRequestHandler):
    server_version = "JarvisAiBox/1.0"
    protocol_version = "HTTP/1.1"

    # -- helpers --------------------------------------------------------
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-AI-Token, Authorization")

    def _send(self, code: int, data: bytes, ctype: str = "application/json"):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json(self, code: int, obj: dict):
        self._send(code, json.dumps(obj).encode("utf-8"))

    def _token_ok(self) -> bool:
        if not TOKEN:
            return True
        given = (self.headers.get("X-AI-Token")
                 or (self.headers.get("Authorization", "").removeprefix("Bearer ").strip()))
        return given == TOKEN

    # -- HTTP -----------------------------------------------------------
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            models = list_models()
            self._json(200, {"ok": bool(models), "engine": "ollama", "model": MODEL,
                             "ollama": bool(models), "models": models,
                             "token_required": bool(TOKEN)})
        else:
            self._json(404, {"error": {"message": "Unknown path"}})

    def do_POST(self):
        parsed = urlparse(self.path)
        # Always read the body first, otherwise keep-alive mangles the rest
        # into a bogus new request (400 errors in the log).
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
        except Exception:
            raw = b"{}"
        if parsed.path != "/v1/chat/completions":
            return self._json(404, {"error": {"message": "Unknown path"}})
        if not self._token_ok():
            return self._json(401, {"error": {"message": "Token missing/wrong (X-AI-Token)"}})
        try:
            payload = json.loads(raw or b"{}")
        except Exception:
            return self._json(400, {"error": {"message": "Invalid JSON"}})
        if not payload.get("messages"):
            return self._json(400, {"error": {"message": "messages missing"}})
        try:
            code, data = chat_completion(payload)
        except Exception as e:  # noqa: BLE001 – pass a readable error upstream
            return self._json(502, {"error": {"message": "Ollama unreachable: " + str(e)}})
        self._send(code, data)

    def log_message(self, fmt, *args):  # keep the journal quiet
        print("[aibox]", fmt % args, flush=True)


if __name__ == "__main__":
    print(f"AI Box running on http://{HOST}:{PORT} – model: {MODEL} – ollama: {OLLAMA} – token: {'ON' if TOKEN else 'OFF'}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
