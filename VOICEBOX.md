# Pi "Voicebox" – speech output from the Pi, reachable from anywhere

## Does the original "Voicebox" run on the Pi 3B+?

**No.** The well-known open-source "Voicebox" (jamiepine/voicebox,
Qwen3-TTS, voice cloning) needs at least **8 GB RAM** per the project
and ~30 s per generation on a modern machine – the Pi 3B+ has **1 GB**.
So this repo ships its own **Voicebox**: same principle (your own TTS
server with an HTTP API) but with **Piper** (rhasspy/piper) – neural
voices, English, offline, faster than real time on the Pi.

Default voice: **`en_GB-alan-medium`** (British) – the closest legal
Piper voice to the film J.A.R.V.I.S. An exact Paul Bettany voice is not
legally downloadable; Piper is the free, unlimited, offline option that
fits the Pi.

```
iPad/Safari ──https──▶ Cloudflare Tunnel ──▶ Pi: 127.0.0.1:8770 (Piper)
   JARVIS                   voice.your-            │ token protection
 (Vercel site)              domain.com             └─ no LAN requirement,
                                                      no port forwarding
```

## 1) Install on the Pi

```bash
cd J.A.R.V.I.S          # repo on the Pi (git pull is enough after the merge)
chmod +x install-voicebox-pi.sh
./install-voicebox-pi.sh
```

The script downloads Piper + the British voice `en_GB-alan-medium`,
**patches the voice config** (removes multi-codepoint diphthong keys
that crash the 2023 piper binary – backup `.onnx.json.orig`), generates
a random **token** (`/opt/voicebox/voicebox.env`, shown at the end) and
starts the `voicebox` service (systemd). Test on the Pi:

```bash
curl http://127.0.0.1:8770/health
curl -X POST http://127.0.0.1:8770/tts -H "X-Voice-Token: YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"text":"Good evening. All systems are fully operational."}' --output test.wav
```

More voices: just drop `*.onnx` + `*.onnx.json` into `/opt/voicebox/voices/`
(catalogue: huggingface.co/rhasspy/piper-voices, e.g.
`en_GB-jenny_dioco-medium`, `de_DE-thorsten-medium`) and select the name
in JARVIS Settings.

### Existing install: switch to Alan (one block)

```bash
cd /opt/voicebox/voices && \
curl -fsSL -O https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx && \
curl -fsSL -O https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json && \
python3 - <<'EOF'
import json, shutil
p = "/opt/voicebox/voices/en_GB-alan-medium.onnx.json"
shutil.copyfile(p, p + ".orig")
d = json.load(open(p))
bad = [k for k in set(list(d.get("phoneme_id_map", {})) + list(d.get("phoneme_map", {}))) if len(k) > 1]
for s in ("phoneme_id_map", "phoneme_map"):
    for k in list(d.get(s, {})):
        if len(k) > 1:
            del d[s][k]
d.pop("vowel_clusters", None)
json.dump(d, open(p, "w"), ensure_ascii=False)
print("patched, removed:", bad)
EOF
sudo sed -i "s/^VOICEBOX_VOICE=.*/VOICEBOX_VOICE=en_GB-alan-medium/" /opt/voicebox/voicebox.env && \
sudo systemctl restart voicebox && sleep 2 && \
curl -s http://127.0.0.1:8770/health && echo && \
curl -s -X POST http://127.0.0.1:8770/tts -H "X-Voice-Token: $(sudo grep ^VOICEBOX_TOKEN= /opt/voicebox/voicebox.env | cut -d= -f2)" -H "Content-Type: application/json" -d '{"text":"Good evening. All systems are fully operational."}' -o /tmp/alan-test.wav -w "HTTP %{http_code} – %{size_download} bytes\n"
```

Then set `VOICEBOX_VOICE=en_GB-alan-medium` in Vercel as well
(Project → Settings → Environment Variables) and redeploy – or simply
leave it: the JARVIS frontend already asks for Alan by name.

## 2) Expose it via a Cloudflare Tunnel (no LAN, no port forwarding)

Requirement: a domain whose DNS is on Cloudflare (free).

On the Pi:

```bash
# install cloudflared (ARM – for a 64-bit OS use cloudflared-linux-arm64)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm -o cloudflared
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/

cloudflared tunnel login                              # browser approval
cloudflared tunnel create jarvis-voice
cloudflared tunnel route dns jarvis-voice voice.your-domain.com
```

File `~/.cloudflared/config.yml`:

```yaml
tunnel: jarvis-voice
credentials-file: /home/pi/.cloudflared/<TUNNEL-ID>.json
ingress:
  - hostname: voice.your-domain.com
    service: http://127.0.0.1:8770
  - service: http_status:404
```

Start as a service:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
curl https://voice.your-domain.com/health   # must show {"ok": true, ...}
```

**Just for testing** (changing address, no domain):
`cloudflared tunnel --url http://127.0.0.1:8770` prints an
`https://….trycloudflare.com` URL – enter that in JARVIS temporarily.

## 3) Enter it in JARVIS

**Recommended: centrally in Vercel (once, for all devices).** In Vercel
(Project → Settings → Environment Variables) set:

- `VOICEBOX_URL` = `https://voice.your-domain.com` (or the
  `….trycloudflare.com` URL – it changes on every tunnel restart,
  update it here then)
- `VOICEBOX_TOKEN` = the token from `voicebox.env` (type: encrypted)
- `VOICEBOX_VOICE` = `en_GB-alan-medium`

Then redeploy (happens automatically on merge to `main`).
JARVIS detects the central voicebox via `/api/health` and speaks through
the `/api/tts` proxy – **nothing to type on the iPad**, and the token
never leaves the server.

**Alternative: per device.** Settings (stays in this browser only):

- **Pi voicebox URL:** `https://voice.your-domain.com`
- **Pi voicebox token:** the token from `voicebox.env`
- **Pi voice:** `en_GB-alan-medium`

A locally entered voicebox takes precedence over the central one.
Either way: turn on "Read replies aloud" → **"Test voice"**.

Output order: **voicebox (Pi, local or via Vercel)** → browser voice
(fallback, e.g. when the Pi is off).

## Security

- The token header is mandatory protection: without it, `/tts` answers
  401. Without a token your voicebox would be an open microphone for the
  whole internet.
- Even stronger: put **Zero Trust → Access** in front of the domain in
  Cloudflare (JARVIS would then need a service token – optional).
- The Pi only needs **outbound** internet (tunnel) – no inbound ports
  to open on the router.

## Problems?

- `/health` OK locally but not via the domain: check
  `sudo systemctl status cloudflared` and the hostname in `config.yml`.
- JARVIS still speaks with the browser voice: the speech status line in
  Settings names the cause (e.g. "Voicebox HTTP 401" = token).
- It sounds choppy: on the Pi 3B+, Piper generates short sentences
  fastest – JARVIS sends at most 900 characters per reply.
