// J.A.R.V.I.S – Vercel Function: Status (keine Secrets, nur "ist ein Key gesetzt?")
export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    runtime: "vercel",
    version: "2.0.0-vercel",
    pi_mode: false,
    llm_env: {
      groq: Boolean(process.env.GROQ_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
      cerebras: Boolean(process.env.CEREBRAS_API_KEY),
      mistral: Boolean(process.env.MISTRAL_API_KEY),
    },
    mcp_proxy: true,
  });
}
