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
