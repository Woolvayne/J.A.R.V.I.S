# J.A.R.V.I.S – Just A Rather Very Intelligent System 🍓 Raspberry-Pi-Edition

Ein JARVIS-artiges HUD-Dashboard wie aus den Iron-Man-Filmen – optimiert für den
**Raspberry Pi 3B+** (1 GB RAM, ARM): Der Pi zeigt Dashboard, Stimme und
MCP-Brücke, die KI rechnet **kostenlos in der Cloud** (kein Download, nur ein
gratis API-Key). Dazu **beliebig viele MCP-Server** als Werkzeuge für die KI.

![Stack](https://img.shields.io/badge/Stack-FastAPI%20%2B%20Vanilla%20JS-00d4ff) ![Kosten](https://img.shields.io/badge/Kosten-0%20%E2%82%AC-2bff88) ![Pi](https://img.shields.io/badge/Raspberry%20Pi-3B%2B-c51a4a) ![Sprache](https://img.shields.io/badge/UI-Deutsch-1a7fff)

## ✨ Features

- **HUD-Dashboard:** System-Gauges (CPU/RAM/Disk + 🌡 Pi-Temperatur live), Wetter, Weltuhr, News (RSS), Krypto-Kurse
- **Animierter Orb** mit Pi-Sparmodus (halbe FPS, weniger Partikel, kein Blur)
- **Stimme:** Microsoft **Edge TTS** (kostenlos, kein Key) – Standard `de-DE-ConradNeural` 🇩🇪, Spracheingabe per Web Speech API
- **Cloud-KI (gratis, ohne Download):** Groq ⭐ → Gemini → Cerebras → Mistral → OpenRouter → Pollinations → Offline-Demo
- **🔌 MCP-Support in beide Richtungen:**
  - JARVIS als **MCP-Client**: *jeden* MCP-Server anbinden (`mcp_servers.json`), Tools nutzt die KI automatisch
  - JARVIS als **MCP-Server**: eigene Tools für Claude Desktop/Cursor (`backend/mcp_server.py`)
- **20 Plugins** + lokale Offline-Befehle (Wetter, Timer, Rechnen, Suche, Witze …)

## 🍓 Raspberry Pi 3B+ – Installation

**Empfehlung:** Raspberry Pi OS **64-bit** (Lite reicht), Kühlkörper/Gehäuselüfter, gutes 5V/2.5A-Netzteil.

```bash
git clone https://github.com/Woolvayne/J.A.R.V.I.S
cd J.A.R.V.I.S
./install-pi.sh
```

Das Skript installiert Python, die schlanken Pi-Abhängigkeiten
(`requirements-pi.txt`), erstellt die `.env` und richtet den
**Autostart-Dienst** `jarvis` (systemd) ein. Danach im Browser:
`http://<PI-IP>:8000` (IP zeigt dir das Skript an; Handy/Tablet im selben WLAN geht auch).

```bash
sudo systemctl status jarvis     # Status
journalctl -u jarvis -f          # Live-Logs
sudo systemctl restart jarvis    # z. B. nach .env-Änderung
```

Ohne systemd (z. B. zum Testen): `./start.sh` – erkennt ARM automatisch.

### Warum läuft die KI (standardmäßig) nicht auf dem Pi?

Ein 3B+ hat 1 GB RAM – große lokale LLMs sind damit nicht sinnvoll.
Deshalb standardmäßig: **Intelligenz aus der Gratis-Cloud, der Pi bleibt schlank.**

**Optional geht lokal doch was:** Mit `./install-ollama-pi.sh` läuft ein
Mini-Modell (`qwen2.5:0.5b`, ~400 MB) offline auf dem Pi – langsam
(3–6 Token/s), aber **inklusive MCP-Tool-Calling**. Details & Modell-Tabelle
in **MCP.md** Abschnitt 4. Empfehlung: Hybrid `LLM_ORDER=ollama,groq,demo`.

### Pi-Tuning (schon eingebaut)

- Nur **1 Uvicorn-Worker**, GZip, TTL-Caches (Wetter/News 10 Min, Krypto 2 Min)
- Nicht-blockierende CPU-Messung, System-Polling im Pi-Modus alle 7 s
- Frontend-Sparmodus: Orb ~30 FPS, 8 statt 24 Partikel, kein `backdrop-filter`
- systemd-Speichergrenzen (`MemoryHigh=450M`) statt OOM-Absturz
- MCP-Client nur mit Standardbibliothek – kein schweres SDK

## 🤖 Welche kostenlose KI? (Recherche-Stand: November 2026)

| Anbieter | Gratis-Limit (ca.) | Karte? | Tool-Calling (MCP) | Fazit |
|---|---|---|---|---|
| **Groq** ⭐ | ~1.000 Anfragen/Tag pro Modell (Llama 3.3 70B), 30/Min | nein | ✅ nativ | **Empfehlung:** extrem schnell – perfekt für Sprache + MCP auf dem Pi. Key: console.groq.com. Modell `llama-3.1-8b-instant` hat noch höhere Limits |
| **Google Gemini** | ~1.500 Anfragen/Tag (Flash), 1M Kontext | nein | ✅ nativ | Bestes Backup / sehr großzügig. Key: aistudio.google.com ⚠️ Free-Tier-Eingaben dürfen außerhalb EU/UK/CH zur Produktverbesserung genutzt werden |
| Cerebras | schnelles Kontingent (Dashboard prüfen) | nein* | ✅ | Sehr schnell, Konditionen können wechseln |
| Mistral | ~1 Mrd. Token/Monat pro Modell (Experiment) | nein (Telefon nötig) | ✅ | EU-Anbieter, 1 Anfrage/s reicht für JARVIS |
| OpenRouter `:free` | 50/Tag (1.000/Tag nach einmalig $10 Guthaben) | nein | ✅ (modellabhängig) | Viele Modelle, als Primärquelle auf dem Pi zu knapp |
| Pollinations | keylos, begrenzt | – | ❌ | Notfall-Fallback ohne Key (eingebaut) |

`GROQ_API_KEY` in die `.env` eintragen, Dienst neu starten – fertig.
Reihenfolge änderbar per `LLM_ORDER=gemini,groq,demo`.

## 🔎 Kiro Free – geht das?

**Zum Entwickeln ja, als Laufzeit-KI nein.** Kiro (AWS Agentic IDE) gibt im
Free-Tier 50 Credits/Monat – ideal, um dieses Projekt zu *bauen*. Eine
einbettbare Runtime-API für das Dashboard gibt es nicht; dafür nutzt JARVIS
die obige Gratis-Kette (Groq & Co.). Stimme: Edge TTS (`rany2/edge-tts`), keylos.

## 🔌 MCP – jeden Connector verbinden

**Bei Groq wird kein MCP „hinzugefügt“** – Groq ist nur das Modell, JARVIS
ist der MCP-Host: Server in `mcp_servers.json` auf `"enabled": true` setzen →
im Dashboard 🔌 MCP → „Neu laden“. Die KI (Groq/Gemini oder lokales
Mini-Modell) nutzt die Tools ab dann automatisch. JARVIS selbst als
MCP-Server für Claude Desktop: `backend/mcp_server.py`.
**Ausführlich: [MCP.md](MCP.md)**

## 🎙 Beispiele (Text oder Mikrofon)

| Sag / schreib | Was passiert |
|---|---|
| „Wetter in Hamburg“ | Wetter-Widget wechselt die Stadt |
| „Timer 5 Minuten“ | Timer-Plugin startet |
| „Rechne 12*8“ | Lokaler Rechner |
| „Suche nach schwarzen Löchern“ | DuckDuckGo-Suche (keylos) |
| „Wie spät ist es in Tokio?“ | MCP-Time-Server (wenn aktiviert) |
| „Öffne MCP“ / „Öffne Notizen“ | Plugin öffnet sich |
| Beliebige Frage | Cloud-KI antwortet (Groq/Gemini/…) |

## 🧩 Plugins (20)

Wetter 🌤 · System 🖥 · **MCP 🔌** · Notizen 📝 · Todos ✅ · Rechner 🧮 · Timer ⏱ · Stoppuhr ⏲ ·
Suche 🔍 · Wikipedia 📚 · News 📰 · Krypto ₿ · GitHub 🐙 · Bild-KI 🎨 · Übersetzer 🌐 ·
Dateien 📁 · Weltuhr 🕐 · Pomodoro 🍅 · Smart Light 💡 · Media 🎬

Eigenes Plugin bauen → **[PLUGINS.md](PLUGINS.md)** (ein Eintrag in `frontend/js/plugins.js`).

## 🏗 Architektur

```
Browser (HUD, Vanilla JS, Pi-Sparmodus)
  app.js · voice.js (Edge TTS) · chat.js · plugins.js (20 Plugins)
        │  HTTP /api/*
FastAPI auf dem Pi (backend/server.py, 1 Worker, Caches, GZip)
  ├─ /api/system   psutil + Pi-Temperatur
  ├─ /api/chat     LLM-Kette (backend/llm.py) + MCP-Tool-Calling
  ├─ /api/mcp/*    MCP-Client (backend/mcp_client.py, nur Stdlib)
  │                  ├─ stdio-Server (uvx/npx lokal auf dem Pi)
  │                  └─ HTTP-Server (Streamable HTTP, remote)
  ├─ /api/tts      Edge TTS → MP3 (backend/tts.py)
  ├─ /api/weather|news|crypto   keylose Gratis-APIs mit Cache
  └─ backend/mcp_server.py      JARVIS selbst als MCP-Server (stdio)
```

Sicherheit: Dateimanager nur im Projektordner (403-Schutz), MCP-Server laufen
mit deinen Rechten – nur Vertrauenswürdiges aktivieren und das Dashboard nicht
ungeschützt ins Internet hängen (kein Login eingebaut).

## 📁 Projektstruktur

```
backend/    server.py · llm.py · tts.py · mcp_client.py · mcp_server.py
frontend/   index.html · css/style.css · js/{app,voice,chat,plugins}.js
deploy/     jarvis.service (systemd-Vorlage)
mcp_servers.json  MCP-Serverliste (Beispiele deaktiviert)
install-pi.sh · install-ollama-pi.sh (lokales Mini-Modell) · start.sh/start.bat · requirements-pi.txt · MCP.md · PLUGINS.md
```

Inspiriert von JARVIS-HUD-Projekten auf GitHub; gebaut mit FastAPI,
[edge-tts](https://github.com/rany2/edge-tts), Open-Meteo, CoinGecko,
Pollinations, Groq & Gemini Free Tier – alles Open Source / gratis.

*„At your service, Sir.“*
