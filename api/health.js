// J.A.R.V.I.S – Vercel Function: status (no secrets, only "is a key set?")
export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    runtime: "vercel",
    version: "3.0.0-vercel",
    pi_mode: false,
    llm_env: {
      groq: Boolean(process.env.GROQ_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
      cerebras: Boolean(process.env.CEREBRAS_API_KEY),
      mistral: Boolean(process.env.MISTRAL_API_KEY),
    },
    mcp_proxy: true,
    // Only "is set?" – the key itself is never printed. When present, /api/mcp
    // injects it server-side for connect.composio.dev and the dashboard
    // creates the MCP server automatically (no key in the browser).
    composio_connect: Boolean(process.env.COMPOSIO_CONSUMER_KEY),
    // Only "is set?" plus the (non-secret) voice name – the Pi voicebox's
    // URL/token stay server-side; the browser talks to /api/tts.
    voicebox: Boolean(process.env.VOICEBOX_URL),
    voicebox_voice: process.env.VOICEBOX_VOICE || "en_GB-alan-medium",
  });
}
