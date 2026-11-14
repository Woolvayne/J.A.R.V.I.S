// J.A.R.V.I.S – Vercel Function: Voicebox-Proxy (Piper-TTS auf dem Pi).
// Der Browser muss URL/Token der Pi-Voicebox dann nicht mehr kennen:
// URL + Token liegen serverseitig in der Vercel-Env (VOICEBOX_URL /
// VOICEBOX_TOKEN / optional VOICEBOX_VOICE), diese Funktion trägt den
// Token-Header ein und reicht das WAV-Audio durch.
// POST { text, voice? }  ->  audio/wav
// Eine im Dashboard lokal eingetragene Voicebox (Einstellungen) hat im
// Browser weiterhin Vorrang – dieser Proxy ist der zentrale Standard.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Nur POST" });
  const body = typeof req.body === "string" ? safeJson(req.body) : (req.body || {});
  const text = String(body.text || "").trim().slice(0, 1200);
  if (!text) return res.status(400).json({ error: "text fehlt" });

  const base = String(process.env.VOICEBOX_URL || "").replace(/\/+$/, "");
  if (!base) {
    return res.status(501).json({
      error: "VOICEBOX_URL ist in der Vercel-Env nicht gesetzt (Pi-Voicebox zentral eintragen oder lokal in den Einstellungen).",
    });
  }
  let target;
  try { target = new URL(base + "/tts"); } catch { return res.status(500).json({ error: "VOICEBOX_URL ungültig" }); }
  if (target.protocol !== "https:" && target.hostname !== "localhost" && target.hostname !== "127.0.0.1") {
    return res.status(500).json({ error: "VOICEBOX_URL muss https sein" });
  }

  const wanted = String(body.voice || process.env.VOICEBOX_VOICE || "de_DE-thorsten-medium").trim();
  const voice = /^[A-Za-z0-9._-]+$/.test(wanted) ? wanted : "de_DE-thorsten-medium";

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
    return res.status(502).json({ error: "Voicebox nicht erreichbar: " + String((e && e.message) || e) });
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
