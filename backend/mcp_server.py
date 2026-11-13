#!/usr/bin/env python3
"""
J.A.R.V.I.S als MCP-Server (stdio) – die Gegenrichtung zum MCP-Client.

Damit können andere MCP-Hosts (Claude Desktop, Cursor, Windsurf, …) JARVIS'
eigene Fähigkeiten als Tools nutzen. Start:

    .venv/bin/python backend/mcp_server.py

Beispiel-Config für Claude Desktop (claude_desktop_config.json):

    {
      "mcpServers": {
        "jarvis": {
          "command": "/home/pi/J.A.R.V.I.S/.venv/bin/python",
          "args": ["/home/pi/J.A.R.V.I.S/backend/mcp_server.py"]
        }
      }
    }

Nur Standardbibliothek (+ optional psutil/requests, falls vorhanden).
Tools: get_time, get_system_status, calculate, get_weather.
"""
from __future__ import annotations

import ast
import datetime
import json
import operator
import os
import sys
import urllib.parse
import urllib.request

PROTOCOL_VERSION = "2024-11-05"

TOOLS = [
    {
        "name": "get_time",
        "description": "Aktuelle Uhrzeit und Datum (optional: Zeitzone, z. B. Europe/Berlin).",
        "inputSchema": {
            "type": "object",
            "properties": {"timezone": {"type": "string", "description": "IANA-Zeitzone, optional"}},
        },
    },
    {
        "name": "get_system_status",
        "description": "Systemstatus des Raspberry Pi: CPU, RAM, Disk, Temperatur, Uptime.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "calculate",
        "description": "Sicherer Taschenrechner, z. B. expression='12*8+5'.",
        "inputSchema": {
            "type": "object",
            "properties": {"expression": {"type": "string"}},
            "required": ["expression"],
        },
    },
    {
        "name": "get_weather",
        "description": "Aktuelles Wetter einer Stadt (Open-Meteo, kostenlos, kein Key).",
        "inputSchema": {
            "type": "object",
            "properties": {"city": {"type": "string", "description": "z. B. Berlin, Hamburg, Giesen"}},
            "required": ["city"],
        },
    },
]

CITIES = {
    "berlin": (52.52, 13.405), "hamburg": (53.55, 9.99), "muenchen": (48.14, 11.58),
    "münchen": (48.14, 11.58), "koeln": (50.94, 6.96), "köln": (50.94, 6.96),
    "giesen": (52.15, 9.95), "hildesheim": (52.15, 9.89), "wien": (48.2, 16.37),
    "zuerich": (47.37, 8.54), "zürich": (47.37, 8.54),
}

_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
        ast.Div: operator.truediv, ast.Mod: operator.mod, ast.Pow: operator.pow,
        ast.USub: operator.neg}


def _safe_eval(node):
    if isinstance(node, ast.Expression):
        return _safe_eval(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_safe_eval(node.left), _safe_eval(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_safe_eval(node.operand))
    raise ValueError("Ausdruck nicht erlaubt")


def _temp_c():
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return round(int(f.read().strip()) / 1000, 1)
    except Exception:
        return None


def call_tool(name: str, args: dict) -> str:
    if name == "get_time":
        tz = None
        zone = (args or {}).get("timezone")
        if zone:
            try:
                from zoneinfo import ZoneInfo
                tz = ZoneInfo(zone)
            except Exception:
                pass
        now = datetime.datetime.now(tz)
        return now.strftime("%A, %d.%m.%Y, %H:%M:%S Uhr")
    if name == "get_system_status":
        try:
            import psutil
            vm, du = psutil.virtual_memory(), psutil.disk_usage("/")
            cpu = psutil.cpu_percent(interval=0.2)
            extra = f"CPU {cpu} %, RAM {vm.percent} %, Disk {du.percent} %"
        except Exception:
            extra = "psutil nicht verfügbar"
        temp = _temp_c()
        return f"JARVIS auf {os.uname().sysname} {os.uname().machine}: {extra}" + (f", CPU-Temperatur {temp} °C" if temp else "")
    if name == "calculate":
        expr = str((args or {}).get("expression", "")).replace(",", ".")
        val = _safe_eval(ast.parse(expr, mode="eval"))
        return f"{expr} = {round(val, 6) if isinstance(val, float) else val}"
    if name == "get_weather":
        city = str((args or {}).get("city", "Berlin")).lower()
        lat, lon = CITIES.get(city, CITIES["berlin"])
        url = ("https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s"
               "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m"
               "&timezone=Europe/Berlin" % (lat, lon))
        with urllib.request.urlopen(url, timeout=10) as r:
            cur = json.loads(r.read())["current"]
        return (f"{city.title()}: {cur['temperature_2m']} °C (gefühlt {cur['apparent_temperature']} °C), "
                f"Luftfeuchte {cur['relative_humidity_2m']} %, Wind {cur['wind_speed_10m']} km/h")
    raise ValueError(f"Unbekanntes Tool: {name}")


def handle(msg: dict) -> dict | None:
    method = msg.get("method", "")
    mid = msg.get("id")
    if method == "initialize":
        return {"jsonrpc": "2.0", "id": mid, "result": {
            "protocolVersion": (msg.get("params") or {}).get("protocolVersion", PROTOCOL_VERSION),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "jarvis", "version": "1.1.0"}}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": mid, "result": {"tools": TOOLS}}
    if method == "tools/call":
        params = msg.get("params") or {}
        try:
            text = call_tool(params.get("name", ""), params.get("arguments") or {})
            result = {"content": [{"type": "text", "text": text}]}
        except Exception as e:
            result = {"content": [{"type": "text", "text": f"Fehler: {e}"}], "isError": True}
        return {"jsonrpc": "2.0", "id": mid, "result": result}
    if method == "ping":
        return {"jsonrpc": "2.0", "id": mid, "result": {}}
    if mid is not None:  # unbekannte Methode
        return {"jsonrpc": "2.0", "id": mid,
                "error": {"code": -32601, "message": f"Method not found: {method}"}}
    return None  # Notification -> keine Antwort


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            msg = json.loads(line)
        except Exception:
            continue
        resp = handle(msg)
        if resp is not None:
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
