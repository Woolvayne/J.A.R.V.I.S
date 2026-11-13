# J.A.R.V.I.S – Just A Rather Very Intelligent System

Ein JARVIS-artiges HUD-Dashboard wie aus den Iron-Man-Filmen – mit Live-Widgets,
animiertem Reactor-Orb, deutscher Stimme und Chat-KI. **100 % kostenlos:**
keine kostenpflichtigen APIs, keine Keys nötig.

![Stack](https://img.shields.io/badge/Stack-FastAPI%20%2B%20Vanilla%20JS-00d4ff) ![Kosten](https://img.shields.io/badge/Kosten-0%20%E2%82%AC-2bff88) ![Sprache](https://img.shields.io/badge/UI-Deutsch-1a7fff)

## ✨ Features

- **HUD-Dashboard:** System-Gauges (CPU/RAM/Disk live), Wetter, Weltuhr, News (RSS), Krypto-Kurse (BTC/ETH/SOL)
- **Animierter Orb** (Canvas) mit Sprech-/Hör-Animation + Boot-Sequenz
- **Stimme:** Microsoft **Edge TTS** (kostenlos, kein Key, 300+ neuronale Stimmen) – Standard: `de-DE-ConradNeural` 🇩🇪
- **Spracheingabe:** Web Speech API (`de-DE`, kostenlos, Chrome/Edge)
- **KI-Chat mit Fallback-Kette** (alles kostenlos): Ollama lokal → Pollinations (keylos) → OpenRouter `:free` → Groq → Gemini → Offline-Demo
- **19 Plugins** (siehe unten), auch per Sprach-/Textbefehl erreichbar
- **Lokale Befehle offline:** Wetter, Timer, Rechnen, Suche, Witze, Uhrzeit, Plugin-Öffner …

## 🚀 Schnellstart

```bash
git clone https://github.com/Woolvayne/J.A.R.V.I.S
cd J.A.R.V.I.S

python3 -m venv .venv
.venv/bin/pip install -r requirements.txt   # Windows: .venv\Scripts\pip

.venv/bin/python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000
# oder einfach: ./start.sh   (Windows: start.bat)
```

Dann im Browser öffnen: **http://localhost:8000**

> Internet wird für Wetter/News/Krypto/TTS/Pollinations benötigt. Ohne Netz
> läuft JARVIS im Demo-Modus weiter (lokale Befehle + Plugins funktionieren).

## 🎙 Beispiele (Text oder Mikrofon)

| Sag / schreib | Was passiert |
|---|---|
| „Wetter in Hamburg“ | Wetter-Widget wechselt die Stadt |
| „Timer 5 Minuten“ | Timer-Plugin startet |
| „Rechne 12 mal 8“ (als `12*8` oder „Rechne 12*8“) | Lokaler Rechner |
| „Suche nach schwarzen Löchern“ | DuckDuckGo-Suche (keylos) |
| „Öffne Notizen“ / „Todos“ | Plugin öffnet sich |
| „Erzähl mir einen Witz“ | Offline-Witz |
| Beliebige Frage | KI antwortet (Pollinations/Ollama/…) |

## 🧩 Plugins (19)

Wetter 🌤 · System 🖥 · Notizen 📝 · Todos ✅ · Rechner 🧮 · Timer ⏱ · Stoppuhr ⏲ ·
Suche 🔍 · Wikipedia 📚 · News 📰 · Krypto ₿ · GitHub 🐙 · Bild-KI 🎨 (Pollinations) ·
Übersetzer 🌐 · Dateien 📁 · Weltuhr 🕐 · Pomodoro 🍅 · Smart Light 💡 (Demo) · Media 🎬

Eigenes Plugin bauen → siehe **[PLUGINS.md](PLUGINS.md)** (ein Eintrag in `frontend/js/plugins.js` genügt).

## 🤖 KI-Anbieter – alle kostenlos

| Anbieter | Key nötig | Hinweis |
|---|---|---|
| **Ollama** (lokal) | nein | Offline & privat. `ollama pull llama3.1`, läuft auf `localhost:11434` |
| **Pollinations** | **nein** | Keylose Cloud-KI, Standard-Fallback |
| OpenRouter `:free` | kostenloser Key | 50 Req/Tag gratis, Modelle mit `:free` |
| Groq | kostenloser Key | Sehr schnell, Free Tier |
| Google Gemini | kostenloser Key | Free Tier ohne Kreditkarte |
| Demo-Modus | nein | Regelbasiert, immer verfügbar (offline) |

Optionale Keys kommen in eine `.env` (Vorlage: `.env.example` – einfach kopieren).

## 🔎 Kiro Free – geht das?

Kurze Antwort: **Für die Entwicklung ja, als Laufzeit-KI nein.**

- **Kiro** (AWS Agentic IDE) ist eine Entwicklungsumgebung, kein API-Dienst.
  Der Free-Tier gibt **50 Credits/Monat** (inkl. Claude Sonnet u. a.) – perfekt,
  um dieses Projekt mit KI-Hilfe zu *bauen und zu erweitern*.
- Das Dashboard selbst kann Kiro aber **nicht** als Gehirn nutzen (keine
  einbettbare Runtime-API). Dafür nutzt JARVIS die obige Gratis-Kette:
  **Pollinations (keylos)** im Netz oder **Ollama lokal** – beides dauerhaft 0 €.
- Stimme kommt von **Edge TTS** (`rany2/edge-tts`, GitHub, 11k+ ⭐) – ebenfalls keylos.

## 🏗 Architektur

```
Browser (HUD, Vanilla JS + Canvas)
  ├─ app.js      Uhr, Gauges, Wetter, News, Krypto, Orb
  ├─ voice.js    Edge TTS (MP3) / Browser-Fallback + Spracheingabe
  ├─ chat.js     Befehls-Parser (offline) + KI-Routing
  └─ plugins.js  19 Plugins (erweiterbar)
        │  HTTP /api/*
FastAPI-Backend (backend/server.py)
  ├─ /api/system   psutil Live-Werte
  ├─ /api/chat     LLM-Fallback-Kette (backend/llm.py)
  ├─ /api/tts      Edge TTS → MP3 (backend/tts.py)
  ├─ /api/weather  Open-Meteo (keylos)   /api/news  RSS-Proxy
  ├─ /api/crypto   CoinGecko (keylos)    /api/files Dateimanager (nur Projektordner!)
  └─ /             serviert das Frontend
```

Sicherheit: Der Dateimanager ist strikt auf den Projektordner beschränkt
(Path-Traversal → 403). Chat-Verlauf bleibt im Browser.

## 📁 Projektstruktur

```
backend/   server.py · llm.py · tts.py
frontend/  index.html · css/style.css · js/{app,voice,chat,plugins}.js
.env.example · requirements.txt · start.sh / start.bat · PLUGINS.md
```

## 🛠 Entwicklung

Backend-Tests per Hand: `curl localhost:8000/api/health` · `/api/system` · `/api/llm/status`.
Neue Plugins, Stimmen oder Anbieter lassen sich ohne Build-Schritt ergänzen – einfach Dateien speichern und Seite neu laden.

Inspiriert von den vielen JARVIS-HUD-Projekten auf GitHub; umgesetzt mit
[edge-tts](https://github.com/rany2/edge-tts), FastAPI, Open-Meteo, CoinGecko und Pollinations – alles Open Source / gratis.

*„At your service, Sir.“*
