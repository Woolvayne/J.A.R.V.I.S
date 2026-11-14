// J.A.R.V.I.S – Vercel Function: Voicebox proxy (Piper TTS on the Pi).
// The browser no longer needs the Pi voicebox's URL/token: both live
// server-side in the Vercel env (VOICEBOX_URL / VOICEBOX_TOKEN / optional
// VOICEBOX_VOICE); this function adds the token header and passes the WAV
// audio through.
// POST { text, voice? }  ->  audio/wav
// A voicebox entered locally in Settings still takes precedence in the
// browser – this proxy is the central default.

export default async function handler(req, res) {
  if (req.method === "GET") return diagnose(res);
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = typeof req.body === "string" ? safeJson(req.body) : (req.body || {});
  const text = String(body.text || "").trim().slice(0, 1200);
  if (!text) return res.status(400).json({ error: "text missing" });

  const base = String(process.env.VOICEBOX_URL || "").replace(/\/+$/, "");
  if (!base) {
    return res.status(501).json({
      error: "VOICEBOX_URL is not set in the Vercel env (set the Pi voicebox centrally or locally in Settings).",
    });
  }
  let target;
  try { target = new URL(base + "/tts"); } catch { return res.status(500).json({ error: "VOICEBOX_URL invalid" }); }
  if (target.protocol !== "https:" && target.hostname !== "localhost" && target.hostname !== "127.0.0.1") {
    return res.status(500).json({ error: "VOICEBOX_URL must be https" });
  }

  const wanted = String(body.voice || process.env.VOICEBOX_VOICE || "en_GB-alan-medium").trim();
  const voice = /^[A-Za-z0-9._-]+$/.test(wanted) ? wanted : "en_GB-alan-medium";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 28000);
  try {
    const r = await fetch(target.toString(), {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        ...(process.env.VOICEBOX_TOKEN ? { "X-Voice-Token": process.env.VOICEBOX_TOKEN } : {}),
      },
      body: JSON.stringify({ text, voice }),
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      return res.status(502).json({ error: `Voicebox HTTP ${r.status}`, detail });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.status(200);
    res.setHeader("Content-Type", r.headers.get("content-type") || "audio/wav");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Cache-Control", "no-store");
    return res.send(buf);
  } catch (e) {
    return res.status(502).json({ error: "Voicebox unreachable: " + String((e && e.message) || e) });
  } finally {
    clearTimeout(timer);
  }
}

// GET /api/tts = self-test (no audio playback in the browser):
// Checks from Vercel: is the Pi reachable via the tunnel? Is the token
// accepted? That way you can see at a glance whether a failure is the Pi
// service, the token or only iOS playback. Token/URL are never printed.
async function diagnose(res) {
  const base = String(process.env.VOICEBOX_URL || "").replace(/\/+$/, "");
  if (!base) return res.status(200).json({ ok: false, configured: false, error: "VOICEBOX_URL not set" });
  const voice = process.env.VOICEBOX_VOICE || "en_GB-alan-medium";
  const out = { ok: false, configured: true, voice, upstream_reachable: false, token_accepted: false };
  try {
    const h = await fetch(base + "/health", { signal: timeoutSignal(10000) });
    out.upstream_reachable = h.ok;
    if (h.ok) { try { out.voices = (await h.json()).voices || []; } catch { /* egal */ } }
    else out.health_status = h.status;
  } catch (e) { out.health_error = String((e && e.message) || e); }
  if (out.upstream_reachable) {
    try {
      const r = await fetch(base + "/tts", {
        method: "POST",
        signal: timeoutSignal(25000),
        headers: {
          "Content-Type": "application/json",
          ...(process.env.VOICEBOX_TOKEN ? { "X-Voice-Token": process.env.VOICEBOX_TOKEN } : {}),
        },
        body: JSON.stringify({ text: "Test", voice }),
      });
      out.upstream_tts_status = r.status;
      out.token_accepted = r.status === 200;
      if (r.ok) out.audio_bytes = (await r.arrayBuffer()).byteLength;
      else { try { out.upstream_error = (await r.text()).slice(0, 200); } catch { /* egal */ } }
    } catch (e) { out.tts_error = String((e && e.message) || e); }
  }
  out.ok = out.upstream_reachable && out.token_accepted;
  return res.status(200).json(out);
}

function timeoutSignal(ms) {
  try { return typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined; }
  catch { return undefined; }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
