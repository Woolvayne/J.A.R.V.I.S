// J.A.R.V.I.S – Vercel Function: AI router (single call, no tool loop).
// Primary: Groq. The tool loop (MCP) runs in the browser; this function
// only hides the API keys and routes:
//   1) Groq (env GROQ_API_KEY or header x-llm-key), model from GROQ_MODEL
//      (default openai/gpt-oss-120b). On model_not_found it retries once
//      with openai/gpt-oss-20b – Groq retires models without much notice
//      (llama-3.3-70b-versatile died that way in Aug 2026).
//   2) Pi fallback: if PI_AI_URL/PI_AI_TOKEN are set, the same payload is
//      sent to the tiny Ollama "aibox" on the Raspberry Pi (via Cloudflare
//      Tunnel) – JARVIS keeps answering (and using MCP tools) even when
//      Groq is down. Header x-ai-route tells the UI which brain answered.
// POST { messages, model?, tools? }  ->  OpenAI-compatible response
// Errors are always readable strings – never "[object Object]".

const GROQ_BASE = "https://api.groq.com/openai/v1";
const FALLBACK_MODEL = "openai/gpt-oss-20b";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = typeof req.body === "string" ? safeJson(req.body) : (req.body || {});
  const { messages, tools } = body;
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: "messages missing" });
  }
  const errors = [];
  const groqKey = req.headers["x-llm-key"] || process.env.GROQ_API_KEY;

  /* 1) Groq ------------------------------------------------------ */
  if (groqKey) {
    const wanted = String(body.model || process.env.GROQ_MODEL || "openai/gpt-oss-120b");
    const models = wanted === FALLBACK_MODEL ? [wanted] : [wanted, FALLBACK_MODEL];
    for (const model of models) {
      try {
        const r = await callUpstream(`${GROQ_BASE}/chat/completions`, {
          Authorization: `Bearer ${groqKey}`,
        }, { model, messages, tools, max_tokens: 700, temperature: 0.7 }, 28000);
        if (r.ok) {
          res.setHeader("x-ai-route", "groq");
          res.status(200); res.setHeader("Content-Type", "application/json");
          return res.send(r.text);
        }
        errors.push(`Groq (${model}) HTTP ${r.status}: ${readableError(r.text)}`);
        if (r.status !== 404 && !/model_not_found/i.test(r.text)) break; // only retry on retired models
      } catch (e) {
        errors.push(`Groq (${model}) unreachable: ${errText(e)}`);
        break;
      }
    }
  }

  /* 2) Pi fallback (Ollama aibox via Cloudflare Tunnel) ----------- */
  const piBase = String(process.env.PI_AI_URL || "").replace(/\/+$/, "");
  if (piBase) {
    try {
      const r = await callUpstream(piBase + "/v1/chat/completions", {
        ...(process.env.PI_AI_TOKEN ? { "X-AI-Token": process.env.PI_AI_TOKEN } : {}),
      }, {
        model: process.env.PI_AI_MODEL || "qwen3:0.6b",
        messages, tools,
        max_tokens: 160, temperature: 0.6, // tiny Pi model: keep answers short & quick
      }, 27000);
      if (r.ok) {
        res.setHeader("x-ai-route", "pi");
        res.status(200); res.setHeader("Content-Type", "application/json");
        return res.send(r.text);
      }
      errors.push(`Pi fallback HTTP ${r.status}: ${readableError(r.text)}`);
    } catch (e) {
      errors.push(`Pi fallback unreachable: ${errText(e)}`);
    }
  }

  if (!groqKey && !piBase) {
    return res.status(501).json({
      error: "No AI configured: set GROQ_API_KEY (Groq) and/or PI_AI_URL + PI_AI_TOKEN (Pi fallback) in Vercel, or add your own Groq key in the dashboard Settings.",
    });
  }
  return res.status(502).json({ error: errors.filter(Boolean).join(" | ") || "All AI routes failed" });
}

async function callUpstream(url, extraHeaders, payload, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body = { model: payload.model, messages: payload.messages, max_tokens: payload.max_tokens, temperature: payload.temperature };
    if (Array.isArray(payload.tools) && payload.tools.length) {
      body.tools = payload.tools;
      body.tool_choice = "auto";
    }
    const r = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
    });
    return { ok: r.ok, status: r.status, text: await r.text() };
  } finally {
    clearTimeout(timer);
  }
}

// Groq/Pi errors arrive as {"error": {"message": "..."}} – surface the text.
function readableError(text) {
  try {
    const j = JSON.parse(text);
    const e = j && j.error;
    if (typeof e === "string") return e.slice(0, 240);
    if (e && e.message) return String(e.message).slice(0, 240);
    if (j && j.message) return String(j.message).slice(0, 240);
  } catch { /* not JSON */ }
  return String(text || "").slice(0, 240) || "unknown error";
}

function errText(e) { return String((e && e.message) || e); }
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
