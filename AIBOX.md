# Pi "AI Box" – the fallback brain (tiny model, MCP-capable)

Groq is JARVIS's primary AI. When Groq is unreachable (or retires a
model again — `llama-3.3-70b-versatile` died that way in Aug 2026),
`/api/chat` automatically forwards the request to this **AI Box** on
your Raspberry Pi: Ollama running a tiny model, behind a small
token-guarded gateway. The MCP tool loop lives in the browser, so the
Pi model can drive the very same tools — including **Composio**
(Gmail, Drive, Sheets …) — it just answers more slowly and briefly.

```
iPad/Safari ──▶ Vercel /api/chat ──Groq ok──▶ Groq (primary)
                       │
                       └──Groq down──▶ Cloudflare Tunnel ──▶ Pi AI Box :8771
                                                              └─▶ Ollama :11434
                                                                  (qwen3:0.6b)
```

Expectations, honestly: a 0.6B model on a Pi 3B+ produces roughly
3–8 tokens/second. Short answers take ~10–30 s. It is a dependable
fallback, not a Groq replacement — keep questions short, and prefer
the Composio **Connect router** (few meta-tools) over servers exposing
hundreds of tools; tiny models drown in giant tool lists.

## 1) Install on the Pi (one block)

```bash
cd J.A.R.V.I.S          # repo on the Pi (git pull is enough after the merge)
chmod +x install-ai-pi.sh
./install-ai-pi.sh
```

The script installs Ollama, tunes it for the Pi (one model, one
request at a time, model unloads after 5 idle minutes so the Voicebox
keeps its RAM), downloads **`qwen3:0.6b`**, installs the gateway with a
random **token** (`/opt/aibox/aibox.env` — it is printed at the end),
starts the `aibox` service, and runs three tests: health, a chat
answer, and a **tool call**. The last test must show a `tool_calls`
entry naming `get_weather` — that proves MCP-style function calling
works on your Pi.

Prefer a slightly smarter model (Pi 4/5, or if RAM allows):
`AIBOX_MODEL=llama3.2:1b ./install-ai-pi.sh`

Manual checks any time:

```bash
curl http://127.0.0.1:8771/health
ollama list
sudo systemctl status aibox ollama
```

## 2) Expose it via Cloudflare Tunnel

Same idea as the Voicebox: outbound-only tunnel, no port forwarding.

**Quick tunnel (changing URL, zero setup)** — its own window/process:

```bash
cloudflared tunnel --url http://127.0.0.1:8771 --no-autoupdate
```

To keep it alive after you close the terminal (like the voice tunnel):

```bash
setsid nohup cloudflared tunnel --url http://127.0.0.1:8771 --no-autoupdate > ~/cloudflared-ai.log 2>&1 &
sleep 5 && grep -o "https://[a-z-]*\.trycloudflare\.com" ~/cloudflared-ai.log | tail -1
```

Note the printed `https://….trycloudflare.com` address — that is your
`PI_AI_URL` (it changes whenever the tunnel restarts).

**Named tunnel (stable address, if you have a domain on Cloudflare):**
add a second hostname to the same tunnel you use for the voice:

```bash
cloudflared tunnel route dns jarvis-voice ai.your-domain.com
```

and in `~/.cloudflared/config.yml` add above the `http_status:404` line:

```yaml
  - hostname: ai.your-domain.com
    service: http://127.0.0.1:8771
```

then `sudo systemctl restart cloudflared`.

## 3) Enter it in JARVIS (once, centrally in Vercel)

Project → Settings → Environment Variables:

- `PI_AI_URL` = the tunnel address, e.g. `https://ai.your-domain.com`
  or the `….trycloudflare.com` URL from step 2
- `PI_AI_TOKEN` = the token from `/opt/aibox/aibox.env` (type: encrypted)
- `PI_AI_MODEL` = `qwen3:0.6b`
- optional: `GROQ_MODEL` = `openai/gpt-oss-120b` (the built-in default;
  on `model_not_found` JARVIS also retries `openai/gpt-oss-20b` by itself)

Redeploy (automatic on merge to `main`). Nothing to type on the iPad:
`/api/health` will show `pi_ai: true`, and JARVIS labels fallback
answers "via Pi fallback (Ollama)". If Groq and the Pi are both down,
he says so — with the real error text, never `[object Object]`.

## 4) Try it

Ask JARVIS something and watch the `via …` label. To rehearse the
fallback, temporarily break Groq: Vercel → `GROQ_API_KEY` → set a
dummy value → redeploy → ask "Show my latest emails" — the Pi should
fetch and read them (slowly). Restore the key afterwards.

## Security

- The gateway refuses requests without `X-AI-Token` (401). The token
  lives only in `/opt/aibox/aibox.env` (chmod 600) and in the Vercel
  env — never in git, never in the browser.
- Ollama itself stays on `127.0.0.1` and is only reached by the
  gateway; the tunnel is outbound-only, no router ports opened.
- Optional hardening: put Cloudflare Zero Trust → Access in front of
  the AI hostname (JARVIS would then need a service token too).

## Problems?

- `/health` shows `"ollama": false`: Ollama is down —
  `sudo systemctl restart ollama`, check `ollama list` has the model.
- Test 3 shows no `tool_calls`: re-run it once (tiny models are
  moody); if it persists, try `AIBOX_MODEL=llama3.2:1b`.
- Answers cut off: Pi answers are deliberately capped short
  (Vercel functions time out at ~30 s). Raise `AIBOX_MAX_TOKENS` in
  `aibox.env` only if your tunnel/Vercel plan allows longer calls.
- Everything slow while it speaks: the Voicebox (Piper) and Ollama
  share one small Pi. `OLLAMA_KEEP_ALIVE=5m` (set by the installer)
  frees the model's RAM again for the voice.
