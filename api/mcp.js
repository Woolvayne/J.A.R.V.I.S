// J.A.R.V.I.S – Vercel Function: MCP-Proxy (Streamable HTTP).
// Der Browser kann viele Remote-MCP-Server wegen CORS nicht direkt rufen –
// diese Funktion leitet JSON-RPC weiter (z. B. zu Composio) und gibt auch
// SSE-Antworten unverändert zurück. Session-ID wird durchgereicht.
// POST { url, headers?, payload }  ->  Antwort des MCP-Servers
//
// Sicherheit: Standardmäßig nur *.composio.dev + Hosts aus MCP_ALLOWED_HOSTS
// (Komma-Liste). MCP_ALLOW_ANY=1 erlaubt beliebige https-Ziele (eigenes Risiko).
// http ist nur für localhost erlaubt (Tests).

function hostAllowed(hostname) {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  const allow = (process.env.MCP_ALLOWED_HOSTS || "composio.dev")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.some((h) => hostname === h || hostname.endsWith("." + h))) return true;
  return process.env.MCP_ALLOW_ANY === "1";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Nur POST" });
  const body = typeof req.body === "string" ? safeJson(req.body) : (req.body || {});
  const { url, headers = {}, payload } = body;
  if (!url || !payload) return res.status(400).json({ error: "url/payload fehlt" });

  let target;
  try { target = new URL(url); } catch { return res.status(400).json({ error: "Ungültige URL" }); }
  const isLocal = target.hostname === "localhost" || target.hostname === "127.0.0.1";
  if (target.protocol !== "https:" && !isLocal) {
    return res.status(400).json({ error: "Nur https (außer localhost)" });
  }
  if (!hostAllowed(target.hostname)) {
    return res.status(403).json({
      error: `Host ${target.hostname} nicht erlaubt. In Vercel MCP_ALLOWED_HOSTS setzen (z. B. composio.dev) oder MCP_ALLOW_ANY=1.`,
    });
  }

  const fwdHeaders = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...headers,
  };
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
    return res.status(502).json({ error: "MCP-Upstream nicht erreichbar: " + String(e && e.message || e) });
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
