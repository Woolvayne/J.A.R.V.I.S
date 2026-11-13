# 🔌 MCP – Model Context Protocol in J.A.R.V.I.S

## Kurz erklärt

**MCP** ist ein offener Standard, mit dem KI-Anwendungen (Hosts) Tools von
externen Programmen (Servern) nutzen können – über ein einheitliches
JSON-RPC-Protokoll. Wichtig zu verstehen:

> **Die KI selbst „kann“ kein MCP.** Das Modell (Groq/Gemini/…) bekommt nur
> eine Tool-Liste als Function-Calling übergeben. Der **MCP-Client in
> J.A.R.V.I.S** verbindet die Server, übersetzt Tool-Aufrufe und reicht
> Ergebnisse an das Modell zurück.

Damit kann J.A.R.V.I.S **jeden MCP-Server** einbinden – egal ob Zeit, Dateien,
Wetter, Datenbanken, Home Assistant, GitHub u. v. m. Und umgekehrt stellt
J.A.R.V.I.S seine eigenen Fähigkeiten selbst als MCP-Server bereit.

```
Nutzer ─► J.A.R.V.I.S (MCP-Host + Client auf dem Pi)
            │  Tool-Liste (tools/list)
            ├──────────────► MCP-Server A (stdio, z. B. uvx mcp-server-time)
            ├──────────────► MCP-Server B (stdio, z. B. npx …/server-filesystem)
            └──────────────► MCP-Server C (HTTP, z. B. https://…/mcp)
            │
            └─► Cloud-KI (Groq ⭐ / Gemini / …) entscheidet per Function-Calling,
                welches Tool läuft; J.A.R.V.I.S führt tools/call aus.
```

Warum so leichtgewichtig? Der MCP-Client (`backend/mcp_client.py`) nutzt nur
die Python-Standardbibliothek – **kein schweres SDK**, ideal für den Pi 3B+.

## 1) MCP-Server für die KI aktivieren (J.A.R.V.I.S als Client)

Datei **`mcp_servers.json`** im Projektordner bearbeiten:

```json
{
  "servers": [
    { "name": "time",  "enabled": true,  "transport": "stdio",
      "command": "uvx", "args": ["mcp-server-time"], "env": {} },

    { "name": "filesystem", "enabled": false, "transport": "stdio",
      "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/pi"],
      "env": {} },

    { "name": "mein-remote-server", "enabled": false, "transport": "http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer DEIN_TOKEN" } }
  ]
}
```

Danach: im Dashboard 🔌 **MCP-Plugin → „Neu laden / verbinden“** (oder
`curl -X POST localhost:8000/api/mcp/reload`). Die Tools erscheinen dort und
oben in der Statusleiste („● MCP: N Tools“). Ab dann nutzt die KI sie
automatisch, z. B.:

- „Wie spät ist es gerade in Tokio?“ → Time-Server
- „Lies die Datei notizen.txt“ → Filesystem-Server (nur freigegebener Ordner!)

### Transporte

| Transport | Was läuft wo | Beispiele |
|---|---|---|
| `stdio` | Server startet als Prozess auf dem Pi | `uvx …` (Python-Server, leicht), `npx …` (Node-Server, schwerer) |
| `http` | Server läuft remote (Streamable HTTP) | gehostete MCP-Server, eigene Dienste im LAN |

### Nützliche Server (Auswahl)

| Server | Start | Hinweis für Pi 3B+ |
|---|---|---|
| Time | `uvx mcp-server-time` | ✅ leicht, Python |
| Fetch (Web lesen) | `uvx mcp-server-fetch` | ✅ leicht, Python |
| Filesystem | `npx @modelcontextprotocol/server-filesystem /pfad` | ⚠️ Node nötig, nur nötige Ordner freigeben |
| Memory | `npx @modelcontextprotocol/server-memory` | ⚠️ Node nötig |
| GitHub | offizieller GitHub-MCP-Server (remote/Docker) | eher remote per HTTP nutzen |
| Eigene Server | beliebiges Programm mit JSON-RPC über stdio/HTTP | ✅ volle Freiheit |

`uvx` bekommst du mit: `curl -LsSf https://astral.sh/uv/install.sh | sh`

### Endpunkte

| Endpunkt | Zweck |
|---|---|
| `GET /api/mcp/status` | Server, Verbindung, Tool-Anzahl, Fehler |
| `GET /api/mcp/tools` | Alle Tools (Name `server__tool`) |
| `POST /api/mcp/call` | Tool manuell testen: `{"name":"time__get_current_time","arguments":{}}` |
| `POST /api/mcp/reload` | Config neu laden, Server neu verbinden |

## 2) J.A.R.V.I.S selbst als MCP-Server (für Claude Desktop & Co.)

`backend/mcp_server.py` stellt JARVIS-Tools für andere MCP-Hosts bereit:
`get_time`, `get_system_status` (inkl. Pi-Temperatur), `calculate`, `get_weather`.

Start: `.venv/bin/python backend/mcp_server.py`

Beispiel für Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "jarvis": {
      "command": "/home/pi/J.A.R.V.I.S/.venv/bin/python",
      "args": ["/home/pi/J.A.R.V.I.S/backend/mcp_server.py"]
    }
  }
}
```

## 3) MCP mit Groq nutzen (Schritt für Schritt)

Bei **Groq selbst wird nichts hinzugefügt** – es gibt dort keine
Connector-Verwaltung wie in Claude Desktop. Groq ist nur das Modell;
**J.A.R.V.I.S ist der MCP-Host**, der die Tools an Groq weitergibt:

1. **Groq-Key holen:** [console.groq.com](https://console.groq.com/keys)
   (Login genügt, keine Kreditkarte) → in `.env`: `GROQ_API_KEY=gsk_…`
2. **MCP-Server aktivieren:** in `mcp_servers.json` beim gewünschten Server
   `"enabled": true` setzen (Beispiele: `time`, `fetch`, `filesystem`).
   stdio-Server brauchen ihr Startprogramm auf dem Pi, z. B. `uvx`:
   `curl -LsSf https://astral.sh/uv/install.sh | sh`
3. **Neu starten:** `sudo systemctl restart jarvis`
4. **Prüfen:** Dashboard → 🔌 MCP-Plugin → „Neu laden / verbinden“.
   Dort (und oben in der Pille „● MCP: N Tools“) siehst du alle Tools.
5. **Nutzen:** Einfach im Chat fragen, z. B. „Wie spät ist es in Tokio?“
   (Time-Server) – Groq entscheidet per Tool-Calling, J.A.R.V.I.S führt aus.
   Im Chat steht dann `via groq · 🔌 time__get_current_time`.

Gute Groq-Modelle für Tool-Calling: `llama-3.3-70b-versatile` (Standard) und
`llama-3.1-8b-instant` (höheres Gratis-Limit). Kommt eine
„tool_use_failed“-Meldung, Modell in `.env` wechseln (`GROQ_MODEL`).

## 4) Lokales Mini-Modell mit MCP (ganz ohne Cloud)

Ja, das geht – mit den richtigen Erwartungen. Ollama liefert Tool-Calling
für Modelle wie **qwen2.5** und **llama3.2**, und J.A.R.V.I.S spricht
dieselbe MCP-Brücke auch mit dem lokalen Modell:

```bash
./install-ollama-pi.sh            # Ollama + qwen2.5:0.5b (empfohlen)
# oder: ./install-ollama-pi.sh llama3.2:1b
```

In `.env` setzen:

```ini
ENABLE_OLLAMA=1
OLLAMA_MODEL=qwen2.5:0.5b
LLM_ORDER=ollama,groq,demo        # lokal zuerst, Groq als Backup (oder nur: ollama,demo)
OLLAMA_TIMEOUT=120
```

Danach `sudo systemctl restart jarvis`. MCP-Server wie oben aktivieren –
das lokale Modell bekommt dieselben Tools (im Chat: `via ollama · 🔌 …`).

**Realität auf dem 3B+ (1 GB RAM):**

| Modell | Download | RAM ca. | Tempo ca. | Tool-Calling |
|---|---|---|---|---|
| `qwen2.5:0.5b` | ~400 MB | ~450 MB | 3–6 Token/s | ok für einfache Tools |
| `llama3.2:1b` | ~800 MB | ~700 MB (eng!) | 1–3 Token/s | besser, aber langsam |
| `qwen2.5:1.5b` | ~900 MB | >750 MB | ~1–2 Token/s | nur zum Testen |

Tiny-Modelle wählen Tools manchmal unsicher oder erfinden Argumente.
Bewährt: **Hybrid** – Ollama für einfache Offline-Befehle, Groq (gratis)
für alles, was zuverlässig/schnell sein muss. Kühlkörper empfohlen,
Raspberry Pi OS Lite (ohne Desktop) lässt mehr RAM frei.

## ⚠️ Sicherheit

- MCP-Server laufen **mit deinen Benutzerrechten** auf dem Pi. Nur Server aus
  vertrauenswürdigen Quellen aktivieren.
- Dateizugriff nur auf ausdrücklich freigegebene Ordner beschränken.
- API-Keys gehören in `env`/`headers` der Server-Config oder in die `.env` –
  **niemals** in den Chat schreiben.
- Das Dashboard hat keine Anmeldung: Im Heimnetz betreiben, nicht
  ungeschützt ins Internet stellen (sonst z. B. Reverse-Proxy mit Passwort).

## Probleme?

- **„0 Tools“**: Server in `mcp_servers.json` auf `"enabled": true`? Befehl
  (`uvx`/`npx`) installiert? Im MCP-Plugin steht die Fehlermeldung.
- **Timeout**: `MCP_TIMEOUT` in `.env` erhöhen (Standard 20 s; erster
  `npx`-Start kann länger dauern).
- **Node-Server langsam**: Auf dem 3B+ Python-Server (`uvx`) bevorzugen.
