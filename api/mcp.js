// J.A.R.V.I.S – Vercel Function: MCP proxy (Streamable HTTP).
// The browser cannot call many remote MCP servers directly because of CORS –
// this function forwards JSON-RPC (e.g. to Composio) and passes SSE
// responses through unchanged. The session ID is forwarded.
// POST { url, headers?, payload }  ->  the MCP server's response
//
// Security: by default only *.composio.dev + hosts from MCP_ALLOWED_HOSTS
// (comma-separated list). MCP_ALLOW_ANY=1 allows any https target (own risk).
// http is only allowed for localhost (tests).

function hostAllowed(hostname) {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  const allow = (process.env.MCP_ALLOWED_HOSTS || "composio.dev")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.some((h) => hostname === h || hostname.endsWith("." + h))) return true;
  return process.env.MCP_ALLOW_ANY === "1";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = typeof req.body === "string" ? safeJson(req.body) : (req.body || {});
  const { url, headers = {}, payload } = body;
  if (!url || !payload) return res.status(400).json({ error: "url/payload missing" });

  let target;
  try { target = new URL(url); } catch { return res.status(400).json({ error: "Invalid URL" }); }
  const isLocal = target.hostname === "localhost" || target.hostname === "127.0.0.1";
  if (target.protocol !== "https:" && !isLocal) {
    return res.status(400).json({ error: "https only (except localhost)" });
  }
  if (!hostAllowed(target.hostname)) {
    return res.status(403).json({
      error: `Host ${target.hostname} is not allowed. Set MCP_ALLOWED_HOSTS in Vercel (e.g. composio.dev) or MCP_ALLOW_ANY=1.`,
    });
  }

  const fwdHeaders = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...headers,
  };
  // Composio Connect: when COMPOSIO_CONSUMER_KEY is set in the Vercel env,
  // the key is injected here server-side as x-consumer-api-key – the browser
  // then neither needs nor knows it. A real key stored in the browser takes
  // precedence; placeholders (…YOUR…) are replaced.
  if (target.hostname === "connect.composio.dev" && process.env.COMPOSIO_CONSUMER_KEY) {
    const existingKey = Object.keys(fwdHeaders).find((k) => k.toLowerCase() === "x-consumer-api-key");
    const existingVal = existingKey ? String(fwdHeaders[existingKey] || "") : "";
    if (!existingKey || existingVal.includes("YOUR") || existingVal.includes("DEIN")) {
      if (existingKey) delete fwdHeaders[existingKey];
      fwdHeaders["x-consumer-api-key"] = process.env.COMPOSIO_CONSUMER_KEY;
    }
  }
  const session = req.headers["x-mcp-session-id"];
  if (session) fwdHeaders["Mcp-Session-Id"] = session;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 28000);
  try {
    const r = await fetch(target.toString(), {
      method: "POST",
      signal: ctrl.signal,
      headers: fwdHeaders,
      body: JSON.stringify(payload),
    });
    const sid = r.headers.get("mcp-session-id");
    if (sid) res.setHeader("x-mcp-session-id", sid);
    res.setHeader("Access-Control-Expose-Headers", "x-mcp-session-id");
    const text = await r.text();
    res.status(r.status);
    res.setHeader("Content-Type", r.headers.get("content-type") || "application/json");
    return res.send(text);
  } catch (e) {
    return res.status(502).json({ error: "MCP upstream unreachable: " + String(e && e.message || e) });
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
