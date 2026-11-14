# J.A.R.V.I.S – Just A Rather Very Intelligent System — Vercel Edition

A minimal voice assistant HUD, styled after a certain film butler: an
arc-reactor orb you tap to speak, a British voice from your own
Raspberry Pi, an AI brain by **Groq only**, and real tools via the
**Model Context Protocol (MCP)** — e.g. Composio with Gmail, Google
Drive and Sheets. Everything runs as a static page on Vercel plus a
few tiny serverless helper functions. No backend to host, nothing
local to install (except the optional Pi voice), all free tiers.

Optimised for Safari on iPad and iPhone, usable on any modern browser.

## Live

**https://jarvis-claw11.vercel.app** — open it, tap the orb, allow the
microphone, and talk. Typing works too.

> If the page asks for a Vercel login first: Vercel dashboard →
> Project `jarvis` → Settings → Deployment Protection →
> **Vercel Authentication: Disabled**.

## Features

- **Tap the orb and talk** – speech recognition in British English;
  replies are read back in a British Piper voice from the Pi
  (`en_GB-alan-medium`, the closest legal voice to the films).
- **Groq only** – every AI answer comes from Groq (Llama 3.3 70B, free
  tier). No local model, no offline demo fallback: if Groq cannot be
  reached, JARVIS says so instead of guessing.
- **Real MCP servers in the browser** – Composio and any remote MCP
  server (Streamable HTTP); Groq calls their tools automatically
  (function calling loop, up to 4 rounds).
- **17 plugins** – weather, news, crypto, notes, tasks, calculator,
  timer, stopwatch, world clock, search, Wikipedia, GitHub, image
  generation, translator, pomodoro and more.
- **Minimal design** – near-black HUD, hairline cyan, delicate motion
  (respects `prefers-reduced-motion` and the low-power mode).
- **Pi-friendly** – the dashboard runs fine in a browser on a Pi 3B+;
  the Pi's real job is the voice (see below).

## Deploy on Vercel (2 minutes)

1. Import this repo at vercel.com → **Add New → Project** (framework:
   *Other*; output directory `frontend` is already configured via
   `vercel.json`).
2. Optional but recommended, in **Settings → Environment Variables**:
   - `GROQ_API_KEY` – free key from https://console.groq.com/keys
   - `COMPOSIO_CONSUMER_KEY` – Composio Connect `ck_…` key (enables
     one-tap Gmail/Drive/Sheets tools)
   - `VOICEBOX_URL`, `VOICEBOX_TOKEN`, `VOICEBOX_VOICE=en_GB-alan-medium`
     – your Pi voicebox (see `VOICEBOX.md`)
   - `MCP_ALLOWED_HOSTS` – MCP host allowlist (default `composio.dev`)
3. Done. Without any env keys, JARVIS still works: paste your own Groq
   key under **Settings → Groq API key**.

## Voice: the Pi Voicebox

Speech synthesis runs **on your Raspberry Pi** (Piper TTS, offline,
unlimited, free) and is exposed to the internet through a Cloudflare
Tunnel — no LAN-only setup, no port forwarding. Full guide:
[`VOICEBOX.md`](VOICEBOX.md). If the Pi is off, JARVIS falls back to
the device voice automatically.

## MCP: real tools (Gmail, Drive, Sheets …)

JARVIS is the **MCP host**; the client runs in your browser and the
tool-calling loop is built in.

- With `COMPOSIO_CONSUMER_KEY` set in Vercel, the `composio-connect`
  server is created automatically; the key is injected server-side by
  `/api/mcp` and never reaches the browser or git.
- Otherwise open the **MCP plugin → “+ Composio template”**, paste your
  MCP URL and API key, and press “Save & connect”. Step-by-step
  instructions (incl. screenshots-free walkthrough of the Composio
  dashboard) are inside the plugin and in [`MCP.md`](MCP.md).
- Then just ask: *“Show my latest emails”* — Groq picks the tools.

Note: a browser cannot start local stdio MCP servers (`npx …`,
`uvx …`); remote Streamable-HTTP servers only.

## Examples

- “Good morning, JARVIS.”
- “What’s the weather in [Your City]?”
- “Show my latest emails.” *(with Composio connected)*
- “Set a timer for 5 minutes.”
- “Open the calculator.”
- “What can you do?”

## Architecture

```
Browser (iPad / Safari)                Vercel                    External
┌───────────────────────┐        ┌──────────────────┐
│ static HUD (frontend/) │──AI──▶ │ /api/chat        │──▶ Groq (only AI)
│ MCP client in JS       │──MCP─▶ │ /api/mcp (proxy) │──▶ Composio / MCP servers
│ speech recognition     │──TTS─▶ │ /api/tts (proxy) │──▶ Pi Voicebox (Piper)
│ (Web Speech API)       │──news▶ │ /api/news (RSS)  │──▶ BBC, Guardian, …
└───────────────────────┘        └──────────────────┘        Raspberry Pi 3B+
  weather/crypto direct                                        Piper + Cloudflare
  from browser APIs                                            Tunnel (Alan voice)
```

## Project structure

| Path | What |
|---|---|
| `frontend/` | Static HUD (HTML/CSS/JS) – deployed to Vercel |
| `frontend/js/app.js` | Boot, clock, device info, weather, news, crypto, orb |
| `frontend/js/voice.js` | Speech in/out (Web Speech API + Pi Voicebox) |
| `frontend/js/chat.js` | Chat, Groq-only answering, MCP tool loop |
| `frontend/js/mcp.js` | MCP client in the browser |
| `frontend/js/plugins.js` | The 17 plugins |
| `api/` | Tiny Vercel Functions: `chat`, `mcp`, `tts`, `health`, `news` |
| `voicebox/` + `install-voicebox-pi.sh` | Piper TTS server for the Pi |
| `MCP.md` / `PLUGINS.md` / `VOICEBOX.md` | Guides |

## Privacy & security

- API keys belong in Vercel environment variables (never in git).
  The browser only ever learns *that* a key exists, never the key.
- Your own Groq key (Settings) stays in your browser’s local storage.
- The Pi voicebox answers only with its token header; the token is
  injected by `/api/tts` server-side.
