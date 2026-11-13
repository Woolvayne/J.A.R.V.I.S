"""
J.A.R.V.I.S – Backend (FastAPI)

Start:  .venv/bin/python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000
        oder: .venv/bin/python backend/server.py

APIs:
  GET  /api/health          – Status
  GET  /api/system          – CPU/RAM/Disk/Uptime (psutil)
  GET  /api/files?path=...  – Dateimanager (nur Projektordner)
  POST /api/chat            – KI-Chat (Multi-Provider, kostenlos)
  GET  /api/llm/status      – Verfügbare KI-Anbieter
  POST /api/tts             – Edge TTS -> MP3
  GET  /api/voices          – Stimmenliste
  GET  /api/weather         – Open-Meteo Proxy (kein Key)
  GET  /api/news            – RSS-Proxy (Tagesschau/BBC/...)
  GET  /api/crypto          – CoinGecko Proxy (BTC/ETH, kein Key)
"""
from __future__ import annotations

import os
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass

try:
    from backend import llm, tts  # noqa: E402  (Start per `uvicorn backend.server:app`)
except ImportError:  # Fallback: Start per `python backend/server.py` aus dem Backend-Ordner-Kontext
    import sys
    from pathlib import Path as _P

    sys.path.insert(0, str(_P(__file__).resolve().parent.parent))
    from backend import llm, tts  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
BOOT = time.time()

app = FastAPI(title="J.A.R.V.I.S", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------ Models
class ChatIn(BaseModel):
    messages: list[dict]


class TtsIn(BaseModel):
    text: str
    voice: str | None = None
    rate: str | None = None


# ------------------------------------------------------------------- APIs
@app.get("/api/health")
def health():
    return {"status": "online", "uptime_s": round(time.time() - BOOT), "version": "1.0.0"}


@app.get("/api/system")
def system():
    try:
        import psutil

        vm = psutil.virtual_memory()
        du = psutil.disk_usage("/")
        return {
            "cpu_percent": psutil.cpu_percent(interval=0.3),
            "cpu_count": psutil.cpu_count(),
            "ram_percent": vm.percent,
            "ram_used_gb": round(vm.used / 1e9, 2),
            "ram_total_gb": round(vm.total / 1e9, 2),
            "disk_percent": du.percent,
            "disk_used_gb": round(du.used / 1e9, 1),
            "disk_total_gb": round(du.total / 1e9, 1),
            "uptime_s": round(time.time() - BOOT),
            "platform": os.uname().sysname if hasattr(os, "uname") else "unknown",
        }
    except Exception as e:  # psutil fehlt -> Mock, damit die UI nie leer bleibt
        return {
            "cpu_percent": 12.0, "cpu_count": 4, "ram_percent": 38.0,
            "ram_used_gb": 6.1, "ram_total_gb": 16.0, "disk_percent": 55.0,
            "disk_used_gb": 140.0, "disk_total_gb": 256.0,
            "uptime_s": round(time.time() - BOOT), "platform": "mock", "error": str(e),
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
    result = llm.chat(body.messages)
    return result


@app.get("/api/llm/status")
def llm_status():
    return llm.status()


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
    """Open-Meteo (kostenlos, kein Key). Doku: https://open-meteo.com"""
    try:
        r = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat, "longitude": lon,
                "current": "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
                "hourly": "temperature_2m",
                "timezone": "Europe/Berlin", "forecast_days": 1,
            },
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        cur = data.get("current", {})
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
    try:
        r = requests.get(url, timeout=10, headers={"User-Agent": "JARVIS/1.0"})
        r.raise_for_status()
        root = ET.fromstring(r.content)
        items = []
        for item in root.iter("item"):
            title = item.findtext("title", "")
            link = item.findtext("link", "")
            pub = item.findtext("pubDate", "")
            if title:
                items.append({"title": title, "link": link, "date": pub})
            if len(items) >= 8:
                break
        return {"feed": feed, "items": items}
    except Exception as e:
        raise HTTPException(502, f"News-Feed nicht erreichbar: {e}")


@app.get("/api/crypto")
def crypto():
    """CoinGecko (kostenlos ohne Key, Ratenlimit beachten)."""
    try:
        r = requests.get(
            "https://api.coingecko.com/api/v3/simple/price",
            params={"ids": "bitcoin,ethereum,solana", "vs_currencies": "eur", "include_24hr_change": "true"},
            timeout=10,
        )
        r.raise_for_status()
        return r.json()
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
