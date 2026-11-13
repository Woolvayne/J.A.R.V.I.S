// J.A.R.V.I.S – Vercel Function: dünner LLM-Proxy (1 Aufruf, kein Tool-Loop).
// Der Tool-Loop (MCP) läuft im Browser; diese Funktion versteckt nur den
// API-Key (Vercel-Env) ODER leitet einen Browser-Key (BYOK) weiter.
// POST { messages, provider?, model?, tools? }  ->  OpenAI-kompatible Antwort
// Optionaler Header: x-llm-key: <eigener Key> (überschreibt den Env-Key)

const PROVIDERS = {
  groq: { base: "https://api.groq.com/openai/v1", env: "GROQ_API_KEY", model: "llama-3.3-70b-versatile" },
  gemini: { base: "https://generativelanguage.googleapis.com/v1beta/openai", env: "GEMINI_API_KEY", model: "gemini-2.5-flash" },
  openrouter: { base: "https://openrouter.ai/api/v1", env: "OPENROUTER_API_KEY", model: "openrouter/free" },
  cerebras: { base: "https://api.cerebras.ai/v1", env: "CEREBRAS_API_KEY", model: "llama-3.3-70b" },
  mistral: { base: "https://api.mistral.ai/v1", env: "MISTRAL_API_KEY", model: "mistral-small-latest" },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Nur POST" });
  const body = typeof req.body === "string" ? safeJson(req.body) : (req.body || {});
  const { messages, provider = "groq", model, tools } = body;
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: "messages fehlt" });
  }
  const cfg = PROVIDERS[provider] || PROVIDERS.groq;
  const key = req.headers["x-llm-key"] || process.env[cfg.env];
  if (!key) {
    return res.status(501).json({
      error: `Kein API-Key für ${provider}. Entweder Env ${cfg.env} in Vercel setzen oder eigenen Key im Dashboard (Einstellungen) eintragen.`,
    });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 28000);
  try {
    const payload = {
      model: model || cfg.model,
      messages,
      max_tokens: 700,
      temperature: 0.7,
    };
    if (Array.isArray(tools) && tools.length) {
      payload.tools = tools;
      payload.tool_choice = "auto";
    }
    const r = await fetch(`${cfg.base}/chat/completions`, {
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
    return res.status(502).json({ error: "LLM-Upstream nicht erreichbar: " + String(e && e.message || e) });
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
