# J.A.R.V.I.S – Just A Rather Very Intelligent System 🚀 Vercel-Edition

Ein JARVIS-artiges HUD-Dashboard wie aus den Iron-Man-Filmen – jetzt **komplett
ohne eigenes Backend**: Vercel hostet die statische Seite, die KI läuft per
**Groq (gratis)** oder **lokal per Ollama**, und **echte MCP-Server wie
Composio** (Gmail, Drive, Sheets …) werden direkt aus dem Browser verbunden.
**100 % kostenlos, keine kostenpflichtigen APIs.**

![Stack](https://img.shields.io/badge/Stack-Vercel%20%2B%20Vanilla%20JS-00d4ff) ![Kosten](https://img.shields.io/badge/Kosten-0%20%E2%82%AC-2bff88) ![Backend](https://img.shields.io/badge/Backend-keins%20n%C3%B6tig-1a7fff) ![Sprache](https://img.shields.io/badge/UI-Deutsch-1a7fff)

## ✨ Features

- **Kein Backend, kein Server, keine Wartung** – deployen und läuft
- **HUD-Dashboard:** Geräte-Infos, Wetter (Open-Meteo), Weltuhr, News (RSS), Krypto (CoinGecko) – alles direkt aus dem Browser
- **Animierter Orb**, Boot-Sequenz, deutsche **Browser-Stimme** + Spracheingabe (Web Speech API)
- **KI gratis ohne Download:** Groq ⭐ (eigener Key im Browser oder Vercel-Env) → Ollama lokal → Pollinations (keylos) → Demo
- **🔌 Echte MCP-Server im Browser:** Composio & beliebige Remote-MCPs (Streamable HTTP) – die KI nutzt ihre Tools automatisch (Gmail lesen, Drive suchen …)
- **Lokale Mini-Modelle mit MCP:** Ollama (`qwen2.5:0.5b`) auf Pi/PC + dieselben MCP-Tools, komplett offline möglich
- **20 Plugins** + Offline-Befehle („Wetter in Berlin“, „Timer 5 Minuten“, „Rechne 12*8“ …)
- Optional weiter dabei: Pi-Backend für stdio-MCP-Server, Edge TTS & echte Pi-Werte

## 🚀 Auf Vercel deployen (2 Minuten)

1. Repo auf GitHub → [vercel.com](https://vercel.com) → **Add New → Project** → dieses Repo importieren.
2. **Keine Einstellungen ändern** (`vercel.json` regelt alles: `frontend/` als Output, `api/` als Functions) → **Deploy**.
3. Fertig! Dashboard öffnen, ⚙ Einstellungen:
   - **Groq-Key** eintragen (kostenlos: console.groq.com, keine Kreditkarte) – bleibt nur in deinem Browser, **oder**
   - stattdessen Env `GROQ_API_KEY` in Vercel setzen (Project → Settings → Environment Variables), dann gilt der Key serverseitig für alle Besucher deiner Instanz.

Optional in Vercel: `MCP_ALLOWED_HOSTS=composio.dev,mein-server.de` (welche MCP-Hosts der Proxy `/api/mcp` anrufen darf).

**Lokal testen:** `npx vercel dev` – oder einfach `frontend/index.html` öffnen (dann ohne `/api`-Functions: Groq per Browser-Key, Ollama & Pollinations laufen trotzdem).

## 🔌 Composio & MCP (das Herzstück)

1. Auf composio.dev einen **MCP-Server** erstellen (Toolkits: Gmail, Google Drive, Sheets …; Accounts per OAuth verbinden).
2. MCP-URL (`https://backend.composio.dev/v3/mcp/…`) + API-Key kopieren.
3. In J.A.R.V.I.S: 🔌 **MCP-Plugin → „+ Composio-Vorlage“** → URL & `{"x-api-key":"ak_…"}` eintragen → verbinden.
4. Fragen wie *„Zeig meine letzten E-Mails“* – die KI ruft die Composio-Tools selbstständig auf.

Beliebige andere Remote-MCP-Server gehen genauso (URL + Header-JSON).
**Ausführliche Anleitung: [MCP.md](MCP.md)** – inkl. Ollama-CORS-Setup,
Sicherheits-Hinweisen und Fehlerbehebung.

> Warum kein stdio-MCP im Browser? Ein Browser kann keine lokalen Programme
> (`uvx`/`npx`) starten. Wer das braucht, nimmt das optionale Pi-Backend (unten).

## 🤖 Welche kostenlose KI?

| Weg | Key | MCP-Tools | Hinweis |
|---|---|---|---|
| **Groq** ⭐ | gratis Key (Browser oder Vercel-Env) | ✅ | Sehr schnell, Llama 3.3 70B, ~1.000 Anfragen/Tag. Empfehlung |
| **Ollama lokal** | nein | ✅ | Mini-Modell auf Pi/PC (`qwen2.5:0.5b`), offline, langsam. CORS: `OLLAMA_ORIGINS=*` (nur Heimnetz!) |
| Gemini u. a. | gratis Key (Vercel-Env via `/api/chat`) | ✅ | Provider per API wählbar (groq/gemini/openrouter/cerebras/mistral) |
| Pollinations | nein | ❌ | Keyloser Fallback direkt aus dem Browser |
| Demo | nein | ❌ | Offline-Regeln, immer da |

## 🎙 Beispiele

| Sag / schreib | Was passiert |
|---|---|
| „Zeig meine letzten E-Mails“ | Composio-Gmail-Tool (wenn verbunden) |
| „Wetter in Hamburg“ | Wetter-Widget |
| „Timer 5 Minuten“ / „Rechne 12*8“ | Lokale Plugins, offline |
| „Wie spät ist es in Tokio?“ | Weltuhr / MCP-Time-Server |
| Beliebige Frage | Groq (gratis) oder Ollama lokal |

## 🏗 Architektur

```
Vercel
├─ frontend/ (statisch) index.html · css · js
│   ├─ app.js      Geräte-Infos, Wetter/News/Krypto direkt, Orb
│   ├─ mcp.js      MCP-Client im Browser (initialize/tools/list/tools/call)
│   ├─ chat.js     Befehle + KI-Loop (Groq/Ollama/Pollinations) inkl. MCP-Tools
│   ├─ voice.js    Browser-Stimme + Spracheingabe (optional Edge TTS via Pi)
│   └─ plugins.js  20 Plugins (inkl. MCP-Manager mit Composio-Vorlage)
└─ api/ (winzige Functions, optional aber empfohlen)
    ├─ chat.js   LLM-Proxy – versteckt Env-Keys, 1 Aufruf, Loop bleibt im Browser
    ├─ mcp.js    MCP-Proxy – umgeht CORS, Host-Allowlist (Composio & Co.)
    ├─ news.js   RSS-Proxy          └─ health.js  Status/Env-Übersicht

Optional (Repo): backend/ FastAPI auf dem Pi (stdio-MCP, Edge TTS, Pi-Werte),
install-pi.sh, install-ollama-pi.sh, mcp_servers.json
```

Sicherheit: Keys liegen nur im Browser (localStorage) oder in der Vercel-Env –
nie im Code. MCP-Proxy hat eine Host-Allowlist. Dashboard ohne Login → bei
serverseitigen Keys die Vercel-Instanz ggf. per Vercel-Schutz absichern.

## 🍓 Raspberry Pi?

Das Dashboard läuft im Pi-Browser (Sparmodus in den ⚙ Einstellungen) oder auf
Handy/PC – der Pi wird nur noch gebraucht für: **Ollama-Mini-Modell**
(`./install-ollama-pi.sh`), **stdio-MCP-Server** oder **Edge TTS**
(`./install-pi.sh`, Backend-URL dann in den Einstellungen eintragen).

## 📁 Projektstruktur

```
frontend/   Das Dashboard (Vercel-Output)
api/        Vercel-Functions: health · chat · mcp · news
vercel.json Deployment-Konfiguration
backend/    Optionales Pi-Backend (FastAPI: stdio-MCP, Edge TTS, Pi-Werte)
deploy/     systemd-Vorlage · install-pi.sh · install-ollama-pi.sh
MCP.md      MCP-Anleitung (Composio, Ollama, Sicherheit)
PLUGINS.md  Eigenes Plugin bauen
```

Inspiriert von JARVIS-HUD-Projekten auf GitHub; gebaut mit Vercel, Groq &
Gemini Free Tier, Pollinations, Edge TTS (optional), Open-Meteo, CoinGecko,
Composio-MCP – alles gratis.

*„At your service, Sir.“*
