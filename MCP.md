# 🔌 MCP – Model Context Protocol in J.A.R.V.I.S (Vercel-Edition)

## Kurz erklärt

**MCP** ist ein offener Standard, mit dem KI-Anwendungen (Hosts) Tools von
externen Programmen (Servern) nutzen können – über JSON-RPC. Wichtig:

> **Die KI selbst „kann“ kein MCP.** Das Modell (Groq/Ollama) bekommt nur
> eine Tool-Liste per Function-Calling. Der **MCP-Client in J.A.R.V.I.S**
> (läuft im Browser, `frontend/js/mcp.js`) verbindet die Server, übersetzt
> Tool-Aufrufe und reicht Ergebnisse an das Modell zurück.

Seit v2 läuft J.A.R.V.I.S **ohne eigenes Backend auf Vercel**. Deshalb gilt:

| MCP-Serverart | Geht ohne Backend? | Weg |
|---|---|---|
| **Remote-HTTP-Server** (Composio, gehostete Server) | ✅ Ja | Browser-MCP-Client, per Vercel-Proxy `/api/mcp` (CORS) oder direkt |
| **Lokale stdio-Server** (`uvx …`, `npx …` auf dem Pi) | ❌ Nein | Ein Browser kann keine Programme starten. Dafür optional das Pi-Backend (Abschnitt 5) |

## 1) Composio anbinden (Gmail, Drive, Sheets & 1000+ Apps) ⭐

Composio stellt dir einen fertigen Remote-MCP-Server mit deinen verbundenen
Accounts bereit (OAuth macht Composio). So geht's:

1. Auf [composio.dev](https://composio.dev) einloggen (Free Tier genügt).
2. **MCP-Server erstellen** (Dashboard → MCP / Tool Router):
   Toolkits wählen, z. B. **Gmail**, **Google Drive**, **Google Sheets**,
   und die Accounts per OAuth verbinden.
3. Du erhältst eine **MCP-URL** wie
   `https://backend.composio.dev/v3/mcp/DEINE_SERVER_ID?user_id=DEINE_USER_ID`
   und deinen **API-Key** (`ak_…`).
4. In J.A.R.V.I.S: 🔌 **MCP-Plugin → „+ Composio-Vorlage“**:
   - URL aus Schritt 3 eintragen
   - Header: `{"x-api-key": "ak_…"}` (mit deinem Key)
   - „Speichern & verbinden“ – die Tools erscheinen (z. B. `composio__GMAIL_FETCH_EMAILS`)
5. Jetzt einfach im Chat fragen: *„Zeig meine letzten E-Mails“* oder
   *„Fasse die Mail von gestern zusammen“*. Im Chat steht dann
   `via groq · 🔌 composio__…`.

Alternativ **Composio Connect**: URL `https://connect.composio.dev/mcp` mit
Header `{"x-consumer-api-key": "ck_…"}`.

> Die Serverliste (inkl. Keys) liegt **nur in deinem Browser** (localStorage).
> URLs/Keys sind wie Passwörter – nicht teilen, nicht committen.

## 2) Beliebige andere Remote-MCP-Server

Im MCP-Plugin → „+ Eigener Server“: Name, https-URL, Header als JSON
(z. B. `{"Authorization": "Bearer …"}`), Weg wählen:

- **Vercel-Proxy (empfohlen):** `/api/mcp` leitet weiter und umgeht CORS.
  Erlaubt sind standardmäßig `*.composio.dev` + Hosts aus der Vercel-Env
  `MCP_ALLOWED_HOSTS` (Komma-Liste). `MCP_ALLOW_ANY=1` öffnet alles (Vorsicht).
- **direkt:** Browser → Server (nur wenn der Server CORS erlaubt).
- **auto:** erst direkt, dann Proxy.

Tools werden 60 s gecacht; „↻ Neu verbinden“ setzt Sessions zurück.

## 3) MCP mit Groq nutzen

Bei **Groq selbst wird nichts hinzugefügt** (keine Connector-Verwaltung) –
J.A.R.V.I.S ist der Host: MCP-Tools aus Abschnitt 1/2 werden Groq bei jeder
Anfrage als Function-Calling-Tools übergeben. Voraussetzungen: Groq-Key in
den ⚙ Einstellungen (bleibt im Browser) **oder** `GROQ_API_KEY` in der
Vercel-Env. Gute Modelle: `llama-3.3-70b-versatile` (Standard).

## 4) MCP mit kleinem Ollama-Modell (lokal, offline) ✅

**Ja – das geht jetzt auch ohne Backend**, der Tool-Loop läuft im Browser:

1. Ollama auf dem Gerät installieren, auf dem es rechnen soll
   (Pi 3B+: `./install-ollama-pi.sh`, Modell `qwen2.5:0.5b`).
2. **CORS freigeben**, sonst blockt der Browser `localhost:11434`:
   Auf dem Pi (systemd):
   ```bash
   sudo systemctl edit ollama
   # einfügen:
   # [Service]
   # Environment="OLLAMA_HOST=0.0.0.0:11434"
   # Environment="OLLAMA_ORIGINS=*"
   sudo systemctl restart ollama
   ```
   Auf PC/Mac: `OLLAMA_ORIGINS=* ollama serve`
3. In J.A.R.V.I.S ⚙ Einstellungen: Ollama-URL prüfen
   (`http://localhost:11434` = gleicher Rechner; vom Handy aufs Pi z. B.
   `http://raspberrypi.local:11434`), Modell `qwen2.5:0.5b`,
   KI-Reihenfolge „Ollama lokal → …“.
4. MCP-Server wie oben verbinden – das lokale Modell bekommt dieselben
   Tools (im Chat: `via ollama lokal · 🔌 …`).

Erwartung (Pi 3B+): 0.5B-Modell ~3–6 Token/s, Tool-Calling für einfache
Tools okay; `llama3.2:1b` wählt Tools besser, ist aber langsamer/RAM-eng.
⚠️ `OLLAMA_ORIGINS=*` nur im Heimnetz nutzen – Ollama hat kein Passwort!

## 5) Optionales Pi-Backend (nur für stdio-MCP + Edge TTS)

Wer lokale stdio-Server (`uvx mcp-server-time`, `npx …`) nutzen will,
braucht einen Prozess-Starter – das bleibt Aufgabe des optionalen
FastAPI-Backends (`backend/`, läuft per `install-pi.sh` als Dienst).
Es bringt zusätzlich Edge TTS und echte Pi-Systemwerte mit.
Im Vercel-Dashboard einfach die Backend-URL in den ⚙ Einstellungen
eintragen (Stimme/System/Dateien nutzen es dann mit).

Zusätzlich kann sich JARVIS per `backend/mcp_server.py` selbst als
MCP-Server für Claude Desktop & Co. anbieten (Tools: Zeit, Pi-Status,
Rechner, Wetter).

## ⚠️ Sicherheit

- MCP-Server können Aktionen in deinen Accounts ausführen (Mails lesen/
  senden!). Nur vertrauenswürdige Server verbinden, bei Composio nur
  nötige Toolkits/Accounts freigeben.
- Keys/URLs niemals teilen oder ins Git committen (sie liegen hier nur
  im Browser bzw. in der Vercel-Env).
- Dashboard hat kein Login: Vercel-Deployment ggf. per Vercel
  Authentication/Password schützen, wenn du Keys serverseitig hinterlegst.

## Probleme?

- **„0 Tools“ trotz Server**: URL/Key korrekt? Im MCP-Plugin steht die
  Fehlermeldung. Bei Proxy-Weg: Host in `MCP_ALLOWED_HOSTS` erlaubt?
- **CORS-Fehler bei „direkt“**: Auf Weg „proxy“ oder „auto“ wechseln.
- **Ollama nicht erreichbar**: Läuft `ollama serve`? `OLLAMA_ORIGINS`
  gesetzt? URL in den Einstellungen passt zum Gerät (localhost ≠ Pi!)?
- **Composio-Tools fehlen**: Im Composio-Dashboard Toolkits/Accounts
  verbunden? Ggf. neue MCP-URL erzeugen und hier ersetzen.
