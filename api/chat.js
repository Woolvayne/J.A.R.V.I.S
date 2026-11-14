// J.A.R.V.I.S – Vercel Function: thin Groq proxy (single call, no tool loop).
// The tool loop (MCP) runs in the browser; this function only hides the API
// key (Vercel env) OR forwards a browser key (BYOK). Groq only – no local
// models, no other providers, no demo fallback.
// POST { messages, model?, tools? }  ->  OpenAI-compatible response
// Optional header: x-llm-key: <own key> (overrides the env key)

const GROQ_BASE = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = typeof req.body === "string" ? safeJson(req.body) : (req.body || {});
  const { messages, model, tools } = body;
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: "messages missing" });
  }
  const key = req.headers["x-llm-key"] || process.env.GROQ_API_KEY;
  if (!key) {
    return res.status(501).json({
      error: "No Groq API key. Set GROQ_API_KEY in Vercel or enter your own key in the dashboard (Settings).",
    });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 28000);
  try {
    const payload = {
      model: model || DEFAULT_MODEL,
      messages,
      max_tokens: 700,
      temperature: 0.7,
    };
    if (Array.isArray(tools) && tools.length) {
      payload.tools = tools;
      payload.tool_choice = "auto";
    }
    const r = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    res.status(r.status);
    res.setHeader("Content-Type", "application/json");
    return res.send(text);
  } catch (e) {
    return res.status(502).json({ error: "Groq upstream unreachable: " + String(e && e.message || e) });
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
