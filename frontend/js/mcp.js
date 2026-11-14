/* J.A.R.V.I.S – MCP client in the browser (Model Context Protocol, Streamable HTTP)
 *
 * Connects ANY remote MCP server directly from the dashboard – e.g.
 * Composio (Gmail, Google Drive, Sheets, Slack …), your own servers, etc.
 * Flow, like everywhere with MCP: initialize -> tools/list -> tools are
 * handed to the AI (Groq) via function calling -> tools/call when needed.
 *
 * Transport per server (selectable):
 *   proxy  – via the Vercel function /api/mcp (avoids CORS, recommended)
 *   direct – browser straight to the server (only if the server allows CORS)
 *   auto   – direct first, proxy on failure
 * A browser fundamentally CANNOT start stdio servers (local programs).
 *
 * The server list lives only in the browser (localStorage "jarvis_mcp_servers").
 * Do NOT share API keys/URLs with tokens – they are as sensitive as passwords.
 */

const MCP_KEY = "jarvis_mcp_servers";
let _rpcId = 0;
const _sessions = {};   // name -> { id: sessionId|null, ready: bool }
let _toolsCache = null; // [{full, server, tool, description, schema}]
let _toolsAt = 0;
const _mcpErrors = {};  // server name -> error message

const MCP_PRESETS = {
  composio: {
    name: "composio",
    url: "https://backend.composio.dev/v3/mcp/YOUR_SERVER_ID?user_id=YOUR_USER_ID",
    headers: { "x-api-key": "ak_YOUR_COMPOSIO_KEY" },
    via: "proxy",
    enabled: true,
    hint: "Composio dashboard: create an MCP server (toolkits e.g. Gmail/Drive), replace SERVER_ID, USER_ID and the API key.",
  },
  composioConnect: {
    name: "composio-connect",
    url: "https://connect.composio.dev/mcp",
    headers: {},
    via: "proxy",
    enabled: true,
    hint: "Composio Connect: if the key is stored in the Vercel env (COMPOSIO_CONSUMER_KEY), just leave the header as {} – the proxy adds x-consumer-api-key server-side. Otherwise enter {\"x-consumer-api-key\":\"ck_…\"} here.",
  },
};

function mcpLoadServers() {
  try {
    const raw = localStorage.getItem(MCP_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function mcpSaveServers(list) {
  localStorage.setItem(MCP_KEY, JSON.stringify(list || []));
  _toolsCache = null; _toolsAt = 0;
}
function _sanitizeName(n) {
  return String(n || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}
function _mcpStringify(result) {
  try {
    if (result && Array.isArray(result.content)) {
      const parts = result.content.map((b) =>
        b && b.type === "text" ? String(b.text || "") : JSON.stringify(b));
      const text = parts.filter(Boolean).join("\n");
      return (result.isError ? "MCP tool reports an error: " : "") + (text.slice(0, 6000) || "(empty result)");
    }
    return JSON.stringify(result).slice(0, 6000);
  } catch { return String(result).slice(0, 6000); }
}

/* ------------------------------------------------------------ transport */
async function _mcpHttpDirect(server, payload) {
  const sess = _sessions[server.name] || {};
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(server.headers || {}),
  };
  if (sess.id) headers["Mcp-Session-Id"] = sess.id;
  const r = await fetch(server.url, { method: "POST", headers, body: JSON.stringify(payload) });
  const sid = r.headers.get("mcp-session-id");
  if (sid) (_sessions[server.name] = _sessions[server.name] || {}).id = sid;
  return { status: r.status, ok: r.ok, text: await r.text() };
}

async function _mcpHttpProxy(server, payload) {
  const sess = _sessions[server.name] || {};
  const headers = {};
  if (sess.id) headers["x-mcp-session-id"] = sess.id;
  const r = await fetch("/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ url: server.url, headers: server.headers || {}, payload }),
  });
  const sid = r.headers.get("x-mcp-session-id");
  if (sid) (_sessions[server.name] = _sessions[server.name] || {}).id = sid;
  return { status: r.status, ok: r.ok, text: await r.text() };
}

function _mcpParse(text, wantId) {
  const t = (text || "").trim();
  if (!t) return {};
  if (t.startsWith("{")) { try { return JSON.parse(t); } catch { /* fall through to SSE */ } }
  // SSE: scan the data: lines
  let found = {};
  for (const line of t.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      const msg = JSON.parse(line.slice(5).trim());
      if (wantId == null || msg.id === wantId) return msg;
      found = msg;
    } catch { /* ignore */ }
  }
  if (Object.keys(found).length) return found;
  throw new Error("Unexpected MCP response: " + t.slice(0, 160));
}

async function _mcpSend(server, payload) {
  const via = server.via || "proxy";
  const wantId = payload.id != null ? payload.id : null;
  const attempt = async (fn) => {
    const res = await fn(server, payload);
    if (!res.ok) throw new Error("HTTP " + res.status + ": " + res.text.slice(0, 180));
    return _mcpParse(res.text, wantId);
  };
  if (via === "direct") return attempt(_mcpHttpDirect);
  if (via === "auto") {
    try { return await attempt(_mcpHttpDirect); }
    catch { return attempt(_mcpHttpProxy); }
  }
  return attempt(_mcpHttpProxy); // proxy (default)
}

async function _mcpRequest(server, method, params) {
  const id = ++_rpcId;
  const msg = await _mcpSend(server, { jsonrpc: "2.0", id, method, params: params || {} });
  if (msg.error) throw new Error("MCP error " + method + ": " + JSON.stringify(msg.error).slice(0, 200));
  return msg.result || {};
}

async function _mcpEnsure(server) {
  const sess = _sessions[server.name] || (_sessions[server.name] = { id: null, ready: false });
  if (sess.ready) return;
  await _mcpRequest(server, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "jarvis-vercel", version: "3.0.0" },
  });
  try { await _mcpSend(server, { jsonrpc: "2.0", method: "notifications/initialized" }); } catch { /* ignore */ }
  sess.ready = true;
}

/* ----------------------------------------------------------------- API */
async function mcpListTools(force) {
  if (!force && _toolsCache && Date.now() - _toolsAt < 60000) return _toolsCache;
  const tools = [];
  for (const k of Object.keys(_mcpErrors)) delete _mcpErrors[k];
  for (const server of mcpLoadServers()) {
    if (!server.enabled || !server.url) continue;
    try {
      await _mcpEnsure(server);
      const res = await _mcpRequest(server, "tools/list");
      for (const t of res.tools || []) {
        const raw = String(t.name || "");
        let schema = t.inputSchema || { type: "object", properties: {} };
        if (schema.type !== "object") schema = { type: "object", properties: {} };
        tools.push({
          full: _sanitizeName(server.name) + "__" + _sanitizeName(raw),
          server: server.name, tool: raw,
          description: String(t.description || "").slice(0, 500), schema,
        });
      }
    } catch (e) {
      _mcpErrors[server.name] = String(e.message || e).slice(0, 300);
    }
  }
  _toolsCache = tools; _toolsAt = Date.now();
  return tools;
}

async function mcpOpenaiTools() {
  const tools = await mcpListTools(false);
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.full,
      description: ("[MCP:" + t.server + "] " + t.description).trim(),
      parameters: t.schema,
    },
  }));
}

async function mcpCallTool(full, args) {
  const tools = await mcpListTools(false);
  const entry = tools.find((t) => t.full === full);
  if (!entry) return "Unknown MCP tool: " + full;
  const server = mcpLoadServers().find((s) => s.name === entry.server);
  if (!server || !server.enabled) return "MCP server '" + entry.server + "' is not enabled.";
  try {
    await _mcpEnsure(server);
    const result = await _mcpRequest(server, "tools/call", { name: entry.tool, arguments: args || {} });
    return _mcpStringify(result);
  } catch (e) {
    return "MCP call failed (" + full + "): " + String(e.message || e);
  }
}

async function mcpStatus() {
  const tools = await mcpListTools(false);
  const counts = {};
  tools.forEach((t) => { counts[t.server] = (counts[t.server] || 0) + 1; });
  const servers = mcpLoadServers().map((s) => ({
    name: s.name, transport: "http", via: s.via || "proxy",
    enabled: Boolean(s.enabled), connected: Boolean(counts[s.name]),
    tools: counts[s.name] || 0, error: _mcpErrors[s.name] || null,
    target: s.url || "",
  }));
  return { enabled: true, servers, tools: tools.map((t) => ({ name: t.full, server: t.server, description: t.description })), tool_count: tools.length };
}

function mcpRefresh() {
  for (const k of Object.keys(_sessions)) delete _sessions[k];
  _toolsCache = null; _toolsAt = 0;
  return mcpListTools(true);
}

const Mcp = {
  presets: MCP_PRESETS,
  loadServers: mcpLoadServers, saveServers: mcpSaveServers,
  listTools: mcpListTools, openaiTools: mcpOpenaiTools,
  callTool: mcpCallTool, status: mcpStatus, refresh: mcpRefresh,
};
