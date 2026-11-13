"""
J.A.R.V.I.S – Backend (FastAPI), optimiert für Raspberry Pi 3B+

Start:  .venv/bin/python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000
        oder: ./install-pi.sh (installiert auch den Autostart-Dienst)

APIs:
  GET  /api/health          – Status (inkl. Pi-Erkennung)
  GET  /api/system          – CPU/RAM/Disk/Temperatur/Uptime (psutil, gecacht)
  GET  /api/files?path=...  – Dateimanager (nur Projektordner)
  POST /api/chat            – KI-Chat (Groq/Gemini/…, kostenlos, inkl. MCP-Tools)
  GET  /api/llm/status      – Verfügbare KI-Anbieter
  POST /api/tts             – Edge TTS -> MP3
  GET  /api/voices          – Stimmenliste
  GET  /api/weather         – Open-Meteo Proxy (kein Key, Cache)
  GET  /api/news            – RSS-Proxy (Tagesschau/BBC/..., Cache)
  GET  /api/crypto          – CoinGecko Proxy (BTC/ETH, kein Key, Cache)
  GET  /api/mcp/status      – MCP-Server + Tool-Anzahl
  GET  /api/mcp/tools       – Alle MCP-Tools aller aktivierten Server
  POST /api/mcp/call        – MCP-Tool manuell aufrufen {name, arguments}
  POST /api/mcp/reload      – MCP-Konfiguration neu laden
"""
from __future__ import annotations

import os
import platform
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass

try:
    from backend import llm, mcp_client, tts  # noqa: E402  (Start per `uvicorn backend.server:app`)
except ImportError:  # Fallback: Start per `python backend/server.py` aus dem Backend-Ordner-Kontext
    import sys
    from pathlib import Path as _P

    sys.path.insert(0, str(_P(__file__).resolve().parent.parent))
    from backend import llm, mcp_client, tts  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
BOOT = time.time()
VERSION = "1.1.0-pi"


def _detect_pi() -> tuple[bool, str]:
    """Raspberry Pi erkennen (PI_MODE=1/0 in .env überschreibt die Erkennung)."""
    env = os.getenv("PI_MODE")
    if env is not None:
        return env.lower() not in ("0", "false", "no", "off"), "env PI_MODE"
    try:
        model = Path("/proc/device-tree/model").read_text(errors="ignore")
        if "raspberry" in model.lower():
            return True, model.strip("\x00 ").strip()
    except Exception:
        pass
    machine = platform.machine().lower()
    return machine.startswith(("arm", "aarch")), f"{platform.system()} {machine}"


PI_MODE, PI_MODEL = _detect_pi()

app = FastAPI(title="J.A.R.V.I.S", version=VERSION)
app.add_middleware(GZipMiddleware, minimum_size=800)  # spart Bandbreite/CPU im Heimnetz
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Einfacher TTL-Cache: schont Pi-CPU, SD-Karte und die Gratis-APIs
_CACHE: dict[str, tuple[float, object]] = {}


def _cached(key: str, ttl: float, producer):
    now = time.time()
    hit = _CACHE.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    value = producer()
    _CACHE[key] = (now, value)
    return value


try:  # psutil-CPU-Messung "anwärmen", damit interval=None danach echte Werte liefert
    import psutil as _psutil

    _psutil.cpu_percent(interval=None)
except Exception:
    pass


# ------------------------------------------------------------------ Models
class ChatIn(BaseModel):
    messages: list[dict]


class TtsIn(BaseModel):
    text: str
    voice: str | None = None
    rate: str | None = None


class McpCallIn(BaseModel):
    name: str  # voller Toolname, z. B. "time__get_current_time"
    arguments: dict | None = None


# ------------------------------------------------------------------- APIs
@app.get("/api/health")
def health():
    return {
        "status": "online", "uptime_s": round(time.time() - BOOT), "version": VERSION,
        "pi_mode": PI_MODE, "pi_model": PI_MODEL, "machine": platform.machine(),
        "mcp_enabled": mcp_client.enabled(),
    }


def _cpu_temp_c():
    """Pi-CPU-Temperatur (°C) aus dem Thermal-Sysfs, sonst None."""
    try:
        raw = Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip()
        return round(int(raw) / 1000, 1)
    except Exception:
        return None


@app.get("/api/system")
def system():
    try:
        import psutil

        vm = psutil.virtual_memory()
        du = psutil.disk_usage("/")
        return {
            "cpu_percent": psutil.cpu_percent(interval=None),  # nicht-blockierend (Pi-schonend)
            "cpu_count": psutil.cpu_count(),
            "ram_percent": vm.percent,
            "ram_used_gb": round(vm.used / 1e9, 2),
            "ram_total_gb": round(vm.total / 1e9, 2),
            "disk_percent": du.percent,
            "disk_used_gb": round(du.used / 1e9, 1),
            "disk_total_gb": round(du.total / 1e9, 1),
            "uptime_s": round(time.time() - BOOT),
            "platform": os.uname().sysname if hasattr(os, "uname") else "unknown",
            "cpu_temp_c": _cpu_temp_c(),
            "pi_mode": PI_MODE,
        }
    except Exception as e:  # psutil fehlt -> Mock, damit die UI nie leer bleibt
        return {
            "cpu_percent": 12.0, "cpu_count": 4, "ram_percent": 38.0,
            "ram_used_gb": 6.1, "ram_total_gb": 16.0, "disk_percent": 55.0,
            "disk_used_gb": 140.0, "disk_total_gb": 256.0,
            "uptime_s": round(time.time() - BOOT), "platform": "mock",
            "cpu_temp_c": None, "pi_mode": PI_MODE, "error": str(e),
        }


@app.get("/api/files")
def files(path: str = Query(default=".")):
    """Dateimanager – strikt auf den Projektordner beschränkt."""
    base = ROOT.resolve()
    target = (base / path).resolve()
    if base not in target.parents and target != base:
        raise HTTPException(403, "Zugriff außerhalb des Projektordners verweigert")
    if not target.is_dir():
        raise HTTPException(404, "Ordner nicht gefunden")
    items = []
    for p in sorted(target.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
        if p.name.startswith(".venv") or p.name == "__pycache__":
            continue
        try:
            items.append({
                "name": p.name,
                "type": "dir" if p.is_dir() else "file",
                "size": p.stat().st_size if p.is_file() else None,
            })
        except OSError:
            continue
    return {"path": str(target.relative_to(base)) or ".", "items": items[:200]}


@app.post("/api/chat")
def chat(body: ChatIn):
    if not body.messages:
        raise HTTPException(400, "Keine Nachrichten")
    # MCP-Tools an die KI geben (falls Server aktiviert sind). Fehler hier
    # dürfen den Chat niemals verhindern -> alles defensiv gekapselt.
    tools, executor = None, None
    if mcp_client.enabled():
        try:
            found = mcp_client.MANAGER.openai_tools()
            if found:
                tools = found
                executor = mcp_client.MANAGER.call_tool
        except Exception:
            tools, executor = None, None
    return llm.chat(body.messages, tools=tools, tool_executor=executor)


@app.get("/api/llm/status")
def llm_status():
    return llm.status()


# ---------------------------------------------------------------------- MCP
@app.get("/api/mcp/status")
def mcp_status():
    return mcp_client.MANAGER.status()


@app.get("/api/mcp/tools")
def mcp_tools():
    return {"tools": mcp_client.MANAGER.status()["tools"]}


@app.post("/api/mcp/call")
def mcp_call(body: McpCallIn):
    if not mcp_client.enabled():
        raise HTTPException(403, "MCP ist deaktiviert (MCP_ENABLED=0)")
    result = mcp_client.MANAGER.call_tool(body.name, body.arguments or {})
    return {"name": body.name, "result": result}


@app.post("/api/mcp/reload")
def mcp_reload():
    return mcp_client.MANAGER.reload()


@app.get("/api/voices")
def voices():
    return {"voices": tts.VOICES, "default": os.getenv("TTS_VOICE", "de-DE-ConradNeural")}


@app.post("/api/tts")
def speak(body: TtsIn):
    try:
        mp3 = tts.synthesize(body.text, body.voice, body.rate)
        return Response(content=mp3, media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(502, f"TTS fehlgeschlagen: {e}")


@app.get("/api/weather")
def weather(lat: float = 52.52, lon: float = 13.405, name: str = "Berlin"):
    """Open-Meteo (kostenlos, kein Key), 10-Minuten-Cache. Doku: https://open-meteo.com"""
    def fetch():
        r = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat, "longitude": lon,
                "current": "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
                "timezone": "Europe/Berlin", "forecast_days": 1,
            },
            timeout=10,
        )
        r.raise_for_status()
        cur = r.json().get("current", {})
        # WMO-Codes -> Text (vereinfacht)
        code = cur.get("weather_code", 0)
        labels = {0: "Klar", 1: "Überwiegend klar", 2: "Teils bewölkt", 3: "Bedeckt",
                  45: "Nebel", 48: "Reifnebel", 51: "Leichter Niesel", 53: "Niesel",
                  61: "Leichter Regen", 63: "Regen", 65: "Starker Regen",
                  71: "Leichter Schnee", 73: "Schnee", 80: "Schauer", 95: "Gewitter"}
        return {
            "city": name, "temp": cur.get("temperature_2m"),
            "feels": cur.get("apparent_temperature"), "humidity": cur.get("relative_humidity_2m"),
            "wind": cur.get("wind_speed_10m"), "label": labels.get(code, f"Code {code}"),
        }

    try:
        return _cached(f"weather:{lat}:{lon}:{name}", 600, fetch)
    except Exception as e:
        raise HTTPException(502, f"Wetter-API nicht erreichbar: {e}")


FEEDS = {
    "tagesschau": "https://www.tagesschau.de/xml/rss_2_0",
    "bbc": "https://feeds.bbci.co.uk/news/rss.xml",
    "heise": "https://www.heise.de/rss/heise.rdf",
    "spiegel": "https://www.spiegel.de/schlagzeilen/topsstories.rss",
}


@app.get("/api/news")
def news(feed: str = "tagesschau"):
    url = FEEDS.get(feed, FEEDS["tagesschau"])

    def fetch():
        r = requests.get(url, timeout=10, headers={"User-Agent": "JARVIS/1.1 (Pi)"})
        r.raise_for_status()
        root = ET.fromstring(r.content)
        items = []
        for item in root.iter("item"):
            title = item.findtext("title", "")
            if title:
                items.append({"title": title, "link": item.findtext("link", ""),
                              "date": item.findtext("pubDate", "")})
            if len(items) >= 8:
                break
        return {"feed": feed, "items": items}

    try:
        return _cached(f"news:{feed}", 600, fetch)
    except Exception as e:
        raise HTTPException(502, f"News-Feed nicht erreichbar: {e}")


@app.get("/api/crypto")
def crypto():
    """CoinGecko (kostenlos ohne Key), 2-Minuten-Cache wegen Gratis-Ratenlimit."""
    def fetch():
        r = requests.get(
            "https://api.coingecko.com/api/v3/simple/price",
            params={"ids": "bitcoin,ethereum,solana", "vs_currencies": "eur", "include_24hr_change": "true"},
            timeout=10,
        )
        r.raise_for_status()
        return r.json()

    try:
        return _cached("crypto", 120, fetch)
    except Exception as e:
        raise HTTPException(502, f"CoinGecko nicht erreichbar: {e}")


# ---------------------------------------------------------------- Frontend
@app.get("/")
def index():
    return FileResponse(FRONTEND / "index.html")


app.mount("/static", StaticFiles(directory=FRONTEND), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", "8000")))
