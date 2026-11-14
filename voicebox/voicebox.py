#!/usr/bin/env python3
"""
J.A.R.V.I.S "Voicebox" – winziger TTS-Server für den Raspberry Pi (3B+ tauglich).

Warum nicht das Original "Voicebox" (jamiepine/voicebox, Qwen3-TTS)?
Das braucht mind. 8 GB RAM – der Pi 3B+ hat 1 GB. Diese Voicebox nutzt
stattdessen Piper (rhasspy/piper): neuronale Stimmen, läuft auf dem Pi
schneller als Echtzeit, komplett offline & kostenlos.

Endpunkte:
  GET  /health  -> {"ok": true, "engine": "piper", "voices": [...], ...}
  GET  /voices  -> verfügbare Stimmen (Modellnamen ohne .onnx)
  POST /tts     -> JSON {"text": "...", "voice": "de_DE-thorsten-medium"}
                   Antwort: audio/wav. Optional Token-Schutz per
                   Header "X-Voice-Token" oder "Authorization: Bearer ..."

Start (normalerweise per systemd, siehe deploy/voicebox.service):
  VOICEBOX_TOKEN=geheim python3 voicebox.py

Der Server lauscht standardmäßig nur auf 127.0.0.1:8770 – öffentlich wird
er NICHT per LAN/Portfreigabe, sondern per Cloudflare Tunnel
(https://voice.deine-domain.de -> http://127.0.0.1:8770), siehe VOICEBOX.md.
Nur Python-Standardbibliothek + `piper`-Binary nötig.
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HOST = os.getenv("VOICEBOX_HOST", "127.0.0.1")
PORT = int(os.getenv("VOICEBOX_PORT", "8770"))
TOKEN = os.getenv("VOICEBOX_TOKEN", "")
PIPER = os.getenv("PIPER_BIN", "piper")
VOICES_DIR = os.getenv("VOICEBOX_VOICES", "/opt/voicebox/voices")
DEFAULT_VOICE = os.getenv("VOICEBOX_VOICE", "de_DE-thorsten-medium")
MAX_TEXT = 1200

_lock = threading.Lock()          # Piper nutzt die Pi-CPU voll – seriell arbeiten
_cache: dict[tuple[str, str], bytes] = {}
_CACHE_MAX = 32


def list_voices() -> list[str]:
    try:
        return sorted(f[:-5] for f in os.listdir(VOICES_DIR) if f.endswith(".onnx"))
    except OSError:
        return []


def synthesize(text: str, voice: str) -> bytes:
    text = (text or "").strip()[:MAX_TEXT]
    if not text:
        raise ValueError("Leerer Text")
    voice = (voice or DEFAULT_VOICE).strip()
    if "/" in voice or ".." in voice:
        raise ValueError("Ungültiger Stimmenname")
    key = (voice, text)
    if key in _cache:
        return _cache[key]
    model = os.path.join(VOICES_DIR, voice + ".onnx")
    if not os.path.isfile(model):
        raise FileNotFoundError("Stimme nicht installiert: " + voice)
    fd, out_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        with _lock:
            proc = subprocess.run(
                [PIPER, "--model", model, "--output_file", out_path],
                input=text.encode("utf-8"),
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180,
            )
        if proc.returncode != 0:
            raise RuntimeError("Piper-Fehler: " + proc.stderr.decode("utf-8", "ignore")[-300:])
        with open(out_path, "rb") as fh:
            data = fh.read()
    finally:
        try:
            os.unlink(out_path)
        except OSError:
            pass
    if len(_cache) >= _CACHE_MAX:
        _cache.clear()
    _cache[key] = data
    return data


class Handler(BaseHTTPRequestHandler):
    server_version = "JarvisVoicebox/1.0"
    protocol_version = "HTTP/1.1"

    # -- Helfer ---------------------------------------------------------
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Voice-Token, Authorization")

    def _json(self, code: int, obj: dict):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _token_ok(self, query_token: str = "") -> bool:
        if not TOKEN:
            return True
        given = (self.headers.get("X-Voice-Token")
                 or (self.headers.get("Authorization", "").removeprefix("Bearer ").strip())
                 or query_token)
        return given == TOKEN

    # -- HTTP -----------------------------------------------------------
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        if parsed.path == "/health":
            self._json(200, {"ok": True, "engine": "piper", "default_voice": DEFAULT_VOICE,
                             "voices": list_voices(), "token_required": bool(TOKEN)})
        elif parsed.path == "/voices":
            self._json(200, {"voices": list_voices(), "default": DEFAULT_VOICE})
        elif parsed.path == "/tts":  # Bequemlichkeit: GET /tts?text=Hallo&token=…
            if not self._token_ok(qs.get("token", [""])[0]):
                return self._json(401, {"error": "Token fehlt/falsch (X-Voice-Token)"})
            try:
                data = synthesize(qs.get("text", [""])[0], qs.get("voice", [DEFAULT_VOICE])[0])
            except Exception as e:  # noqa: BLE001 – Fehlertext an Client geben
                return self._json(502, {"error": str(e)})
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self._json(404, {"error": "Unbekannter Pfad"})

    def do_POST(self):
        parsed = urlparse(self.path)
        # Body immer zuerst lesen, sonst zerlegt Keep-Alive den Rest als
        # angebliche neue Anfrage (400-Fehler im Log).
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
        except Exception:
            raw = b"{}"
        if parsed.path != "/tts":
            return self._json(404, {"error": "Unbekannter Pfad"})
        if not self._token_ok():
            return self._json(401, {"error": "Token fehlt/falsch (X-Voice-Token)"})
        try:
            payload = json.loads(raw or b"{}")
        except Exception:
            return self._json(400, {"error": "Ungültiges JSON"})
        try:
            data = synthesize(payload.get("text", ""), payload.get("voice") or DEFAULT_VOICE)
        except FileNotFoundError as e:
            return self._json(404, {"error": str(e), "voices": list_voices()})
        except Exception as e:  # noqa: BLE001
            return self._json(502, {"error": str(e)})
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):  # Journal etwas ruhiger
        print("[voicebox]", fmt % args, flush=True)


if __name__ == "__main__":
    print(f"Voicebox läuft auf http://{HOST}:{PORT} – Stimmen: {list_voices()} – Token: {'an' if TOKEN else 'AUS'}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
