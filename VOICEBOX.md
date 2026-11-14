# 🔊 Pi-„Voicebox“ – Sprachausgabe vom Pi, von überall erreichbar

## Geht das Original „Voicebox“ auf dem Pi 3B+?

**Nein.** Das bekannte Open-Source-„Voicebox“ (jamiepine/voicebox,
Qwen3-TTS, Voice-Cloning) braucht laut Projekt **mind. 8 GB RAM** und
~30 s pro Generierung auf einem modernen Rechner – der Pi 3B+ hat **1 GB**.
Dafür wurde diese Repo-eigene **Voicebox** gebaut: gleiches Prinzip
(eigener TTS-Server mit HTTP-API), aber mit **Piper** (rhasspy/piper) –
neuronale Stimmen, deutsch, offline, auf dem Pi schneller als Echtzeit.

```
iPad/Safari ──https──▶ Cloudflare Tunnel ──▶ Pi: 127.0.0.1:8770 (Piper)
   JARVIS                   voice.deine-           │ Token-Schutz
 (Vercel-Seite)             domain.de              └─ kein LAN-Zwang,
                                                      keine Portfreigabe
```

## 1) Auf dem Pi installieren

```bash
cd J.A.R.V.I.S          # Repo auf dem Pi (git pull genügt nach dem Merge)
chmod +x install-voicebox-pi.sh
./install-voicebox-pi.sh
```

Das Skript lädt Piper + die deutsche Stimme `de_DE-thorsten-medium`,
erzeugt ein Zufalls-**Token** (`/opt/voicebox/voicebox.env`, wird am Ende
angezeigt) und startet den Dienst `voicebox` (systemd). Test auf dem Pi:

```bash
curl http://127.0.0.1:8770/health
curl -X POST http://127.0.0.1:8770/tts -H "X-Voice-Token: DEIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"text":"Hallo, ich bin deine Voicebox."}' --output test.wav
```

Weitere Stimmen: einfach `*.onnx` + `*.onnx.json` nach `/opt/voicebox/voices/`
legen (Katalog: huggingface.co/rhasspy/piper-voices, z. B.
`de_DE-kerstin-low`, `de_DE-karlsson-low`) und in JARVIS den Namen eintragen.

## 2) Per Cloudflare Tunnel öffentlich machen (kein LAN, keine Portfreigabe)

Voraussetzung: eine Domain, deren DNS bei Cloudflare liegt (kostenlos).

Auf dem Pi:

```bash
# cloudflared installieren (ARM – für 64-Bit-OS stattdessen cloudflared-linux-arm64)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm -o cloudflared
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/

cloudflared tunnel login                              # Browser-Freigabe
cloudflared tunnel create jarvis-voice
cloudflared tunnel route dns jarvis-voice voice.deine-domain.de
```

Datei `~/.cloudflared/config.yml`:

```yaml
tunnel: jarvis-voice
credentials-file: /home/pi/.cloudflared/<TUNNEL-ID>.json
ingress:
  - hostname: voice.deine-domain.de
    service: http://127.0.0.1:8770
  - service: http_status:404
```

Als Dienst starten:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
curl https://voice.deine-domain.de/health   # muss {"ok": true, ...} zeigen
```

**Nur zum Testen** (wechselnde Adresse, ohne Domain):
`cloudflared tunnel --url http://127.0.0.1:8770` zeigt eine
`https://….trycloudflare.com`-URL – die trägst du vorübergehend in JARVIS ein.

## 3) In JARVIS eintragen

**Empfohlen: zentral in Vercel (einmal für alle Geräte).** In Vercel
(Project → Settings → Environment Variables) setzen:

- `VOICEBOX_URL` = `https://voice.deine-domain.de` (bzw. die
  `….trycloudflare.com`-URL – die ändert sich bei jedem Tunnel-Neustart,
  dann hier aktualisieren)
- `VOICEBOX_TOKEN` = das Token aus der `voicebox.env` (Typ: encrypted)
- `VOICEBOX_VOICE` = `de_DE-thorsten-medium`

Danach neu deployen (geschieht automatisch beim Merge auf `main`).
JARVIS erkennt die zentrale Voicebox über `/api/health` und spricht über
den Proxy `/api/tts` – **auf dem iPad muss nichts eingetippt werden**,
der Token verlässt den Server nie.

**Alternative: pro Gerät.** ⚙ Einstellungen (bleibt nur in diesem Browser):

- **Pi-Voicebox-URL:** `https://voice.deine-domain.de`
- **Pi-Voicebox-Token:** das Token aus der `voicebox.env`
- **Pi-Voicebox-Stimme:** `de_DE-thorsten-medium`

Eine lokal eingetragene Voicebox hat Vorrang vor der zentralen.
In beiden Fällen: „Antworten vorlesen“ an → **„🔊 Stimme testen“**.

Reihenfolge der Ausgabe: **Voicebox (Pi, lokal oder via Vercel)** →
Edge TTS (optionales Pi-Backend) → Browser-Stimme (Fallback, z. B. wenn
der Pi aus ist).

## Sicherheit

- Der Token-Header ist Pflicht-Schutz: Ohne ihn antwortet `/tts` mit 401.
  Ohne Token wäre deine Voicebox ein offenes Mikrofon fürs ganze Internet.
- Noch stärker: In Cloudflare zusätzlich **Zero Trust → Access** vor die
  Domain legen (dann braucht JARVIS einen Service-Token – optional).
- Der Pi muss dafür nur **ausgehend** ins Internet (Tunnel) – keine
  eingehenden Ports am Router öffnen.

## Probleme?

- `/health` lokal ok, aber Domain nicht: `sudo systemctl status cloudflared`
  und Hostname in der `config.yml` prüfen.
- JARVIS spricht trotzdem mit Browser-Stimme: In den ⚙ Einstellungen steht
  im Sprachausgabe-Status die Ursache (z. B. „voicebox HTTP 401“ = Token).
- Es klingt abgehackt: Auf dem Pi 3B+ generiert Piper kurze Sätze am
  schnellsten – JARVIS schickt max. 900 Zeichen pro Antwort.
