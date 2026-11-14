/* J.A.R.V.I.S – Chat: small deterministic commands (UI actions) + Groq.
 * AI policy: Groq ONLY. No local model, no keyless fallback, no demo
 * answers. Route: the server key in the Vercel env (/api/chat) first,
 * your own browser key second. MCP tools (mcp.js) are handed to Groq
 * via function calling; the tool loop runs here in the browser. */
/* Note: $, API, CITIES, state, Mcp are defined in app.js/mcp.js. */

const history = [];
const SYS_PROMPT = "You are J.A.R.V.I.S (Just A Rather Very Intelligent System), a polite, precise British AI butler. Always answer in British English, briefly and clearly, in at most 3-4 sentences. Address the user as 'Sir' where fitting. No emojis, no markdown tables. If tools are available, use them for current or factual information instead of guessing. If the user asks about emails and email tools are available, always fetch real emails with the tools, list sender, subject and time, and offer to read one in full – never invent emails. When the user refers to a numbered item from a list you just gave (e.g. 'read the second one'), act on that exact item with the tools.";

function addMsg(who, text, provider) {
  const log = $("#chatLog");
  const div = document.createElement("div");
  div.className = "msg " + (who === "user" ? "user" : "jarvis");
  div.innerHTML = `<span class="who">${who === "user" ? "You" : "J.A.R.V.I.S"}</span>${escapeHtml(text)}` +
    (provider ? `<span class="prov">via ${escapeHtml(provider)}</span>` : "");
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function initChat() {
  const nPlugins = typeof PLUGINS !== "undefined" ? PLUGINS.length : 20;
  addMsg("jarvis", `Good day, Sir. I am J.A.R.V.I.S – running entirely on Vercel: Groq is my only AI, my voice is the British Pi voice, and ${nPlugins} plugins plus real MCP servers (for example Composio) are at your disposal. Tap the orb to speak, or type a command below. Try "Show my latest emails" – I will fetch them and read them to you.`, "system");
  $("#chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#chatInput").value.trim();
    if (!v) return;
    $("#chatInput").value = "";
    handleUserText(v);
  });
}

async function handleUserText(text) {
  addMsg("user", text);
  history.push({ role: "user", content: text });

  // 1) Emails first: asking about mail must fetch and read real emails via
  //    MCP – never just open the MCP plugin (that was the old bug: the
  //    words "email"/"gmail" were UI shortcuts for the panel).
  setOrb("speak", "Fetching your emails …");
  let email = null;
  try { email = await handleEmailIntent(text); } catch { email = null; }
  if (email) {
    history.push({ role: "assistant", content: email.text });
    addMsg("jarvis", email.text, email.via || "Gmail via MCP");
    speak(email.speakText || email.text);
    setOrb("idle", "Ready, Sir.");
    return;
  }
  setOrb("idle", "Ready, Sir.");

  // 2) Deterministic UI commands (timer, weather panel, calculator …).
  //    These are interface actions, not AI – every real answer is Groq.
  const local = runLocalCommand(text);
  if (local !== null) {
    history.push({ role: "assistant", content: local });
    addMsg("jarvis", local, "command");
    speak(local);
    return;
  }

  // 3) Groq (with MCP tool loop)
  setOrb("speak", "Thinking …");
  try {
    const data = await llmReply();
    history.push({ role: "assistant", content: data.text });
    const via = data.provider + (data.tools_used && data.tools_used.length ? " · tools: " + data.tools_used.join(", ") : "");
    addMsg("jarvis", data.text, via);
    if (data.tools_used && data.tools_used.length) loadMcpPill();
    $("#pillLLM").className = "pill ok"; $("#pillLLM").textContent = "● AI: Groq";
    speak(data.text);
  } catch (e) {
    const reason = String((e && e.message) || e || "unknown error");
    const fallback = "Apologies, Sir – Groq is currently unreachable (" + reason + "). There is deliberately no local fallback, so I would rather tell you than guess. Please check your connection and try again in a moment.";
    addMsg("jarvis", fallback, "Groq unavailable");
    $("#pillLLM").className = "pill warn"; $("#pillLLM").textContent = "● AI: Groq unreachable";
    speak(fallback);
  } finally {
    setOrb("idle", "Ready, Sir.");
  }
}

/* ------------------------------------------------------- Groq (only) */
function chatMessages() {
  return [{ role: "system", content: SYS_PROMPT }, ...history.slice(-12)];
}

const EMAIL_COACH = "The user is asking about their emails. MCP email tools are available to you (Gmail via Composio, possibly behind COMPOSIO_SEARCH_TOOLS / COMPOSIO_MULTI_EXECUTE_TOOL meta-tools). You MUST use the tools to fetch real emails before answering – never claim you cannot access the inbox and never invent senders, subjects or content. If a tool has to be found first, search for a Gmail fetch/list tool and execute it (user 'me', at most 5 results, inbox). Then present a short numbered list: number, sender, subject, time. End by offering to read one in full. If the user refers to a numbered email from your previous list, fetch that exact message with the tools and read it.";

async function getMcpTools() {
  try { return typeof Mcp !== "undefined" ? await Mcp.openaiTools() : []; }
  catch { return []; }
}

function groqPayload(msgs, tools) {
  const payload = { model: "llama-3.3-70b-versatile", messages: msgs, max_tokens: 700, temperature: 0.7 };
  if (tools && tools.length) { payload.tools = tools; payload.tool_choice = "auto"; }
  return payload;
}

async function groqViaServer(msgs, tools) {
  const r = await fetch("/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: msgs, provider: "groq", tools }),
  });
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.json()).error || ""; } catch { /* ignore */ }
    throw new Error("Vercel proxy HTTP " + r.status + (detail ? ": " + detail : ""));
  }
  return (await r.json()).choices[0].message;
}

async function groqDirect(msgs, tools) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + state.groqKey, "Content-Type": "application/json" },
    body: JSON.stringify(groqPayload(msgs, tools)),
  });
  if (!r.ok) throw new Error("Groq HTTP " + r.status);
  return (await r.json()).choices[0].message;
}

let lastGroqRoute = "Groq";
async function groqOnce(msgs, tools) {
  const errors = [];
  // 1) Server key in the Vercel env (preferred – nothing to type anywhere)
  if (state.functions) {
    try { const m = await groqViaServer(msgs, tools); lastGroqRoute = "Groq (Vercel)"; return m; }
    catch (e) { errors.push(String(e.message || e)); }
  }
  // 2) Your own key in this browser (fallback)
  if (state.groqKey) {
    try { const m = await groqDirect(msgs, tools); lastGroqRoute = "Groq (your key)"; return m; }
    catch (e) { errors.push(String(e.message || e)); }
  }
  throw new Error(errors.filter(Boolean).join(" | ") || "No Groq key: set GROQ_API_KEY in Vercel or add your key in Settings");
}

/* Generic tool loop: the model may call MCP tools (a few rounds) */
async function toolLoop(callOnce, msgs, tools, maxRounds = 4) {
  const used = [];
  const m = [...msgs];
  for (let round = 0; round < maxRounds; round++) {
    const msg = await callOnce(m, tools);
    const calls = msg.tool_calls || [];
    if (!calls.length || !tools.length) return { text: (msg.content || "").trim(), tools_used: used };
    m.push({ role: "assistant", content: msg.content || "", tool_calls: calls });
    for (const tc of calls) {
      const fn = tc.function || {};
      let args = fn.arguments || {};
      if (typeof args === "string") { try { args = JSON.parse(args || "{}"); } catch { args = {}; } }
      const result = await Mcp.callTool(fn.name, args);
      used.push(fn.name);
      m.push({ role: "tool", tool_call_id: tc.id || fn.name, content: String(result).slice(0, 6000) });
    }
  }
  return { text: "The tool calls needed too many rounds, Sir.", tools_used: used };
}

async function llmReply() {
  const tools = await getMcpTools();
  const msgs = chatMessages();
  const lastUser = [...history].reverse().find((x) => x.role === "user");
  const emailCtx = Boolean(lastUser && EMAIL_WORD.test(lastUser.content));
  if (emailCtx) msgs.push({ role: "system", content: EMAIL_COACH });
  const out = await toolLoop(groqOnce, msgs, tools, emailCtx ? 6 : 4);
  if (!out.text) throw new Error("Groq returned an empty answer");
  return { ...out, provider: lastGroqRoute };
}

/* ------------------------------------------------- Email (Gmail via MCP) */
/* Asking about emails must NEVER just open the MCP plugin: JARVIS fetches
 * them with the connected Gmail tools, lists them, reads them aloud, and
 * "read the first one" fetches that message in full. Only when no MCP
 * tools are connected at all does he open the panel – with an explanation. */
let lastEmailList = [];   // [{id, threadId, sender, subject, date, snippet}]

const EMAIL_WORD = /\b(e-?mails?|gmail|inbox|unread)\b/i;
const MCP_ERR = /^(MCP tool reports an error|Unknown MCP tool|MCP call failed|MCP server)/i;
const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

async function _mcpTools() {
  try { return typeof Mcp !== "undefined" ? await Mcp.listTools(false) : []; }
  catch { return []; }
}

/* Find the Gmail list/read tools among all MCP tools (fuzzy on purpose:
 * direct Gmail tools on classic Composio servers; router meta-tools are
 * deliberately NOT matched here – Groq handles those with coaching). */
function _pickGmailTools(tools) {
  const g = (tools || []).filter((x) => /gmail/i.test(x.tool || "") || /gmail/i.test(x.full || ""));
  const name = (x) => String(x.tool || "");
  const list =
    g.find((x) => /FETCH_EMAILS|LIST_EMAILS|GET_EMAILS|FETCH_MESSAGES|LIST_MESSAGES|SEARCH_EMAILS/i.test(name(x))) ||
    g.find((x) => /(FETCH|LIST|SEARCH)/i.test(name(x)) && !/(MESSAGE_BY|BY_ID|LABELS?|SEND|DRAFT)/i.test(name(x))) ||
    null;
  const read =
    g.find((x) => /MESSAGE_BY|GET_MESSAGE|FETCH_MESSAGE|READ_EMAIL|GET_EMAIL/i.test(name(x)) && !/(EMAILS|MESSAGES)$/i.test(name(x).trim())) ||
    null;
  return { list, read, gmailCount: g.length };
}

/* Only pass arguments the tool's schema actually declares. */
function _buildListArgs(schema, userText) {
  const props = (schema && schema.properties) || {};
  const args = {};
  const unread = /\bunread\b/i.test(userText || "");
  for (const k of Object.keys(props)) {
    const lk = k.toLowerCase();
    if (/max_?results|limit|count|page_?size/.test(lk)) args[k] = 5;
    else if (lk === "query" || lk === "q" || lk === "search_query" || lk === "filter") args[k] = unread ? "in:inbox is:unread" : "in:inbox";
    else if (/label/.test(lk) && props[k].type === "array") args[k] = unread ? ["INBOX", "UNREAD"] : ["INBOX"];
    else if (lk === "user_id" || lk === "userid") args[k] = "me";
  }
  return args;
}

function _buildReadArgs(schema, item) {
  const props = (schema && schema.properties) || {};
  const args = {};
  for (const k of Object.keys(props)) {
    const lk = k.toLowerCase();
    if (/message/.test(lk) && /id/.test(lk) && item.id) args[k] = item.id;
    else if (lk === "id" && item.id) args[k] = item.id;
    else if (/thread/.test(lk) && item.threadId) args[k] = item.threadId;
    else if ((lk === "user_id" || lk === "userid")) args[k] = "me";
    else if (lk === "format") args[k] = "full";
  }
  return args;
}

/* ---- tolerant parsing of whatever the mail tool returns ---- */
function _jsonFromText(text) {
  const t = String(text || "");
  const start = t.search(/[\[{]/);
  if (start < 0) return null;
  try { return JSON.parse(t.slice(start)); } catch { return null; }
}
function _strField(obj, keys) {
  for (const k of keys) {
    const v = obj ? obj[k] : null;
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}
function _headerVal(obj, name) {
  const hs = obj && obj.payload && Array.isArray(obj.payload.headers) ? obj.payload.headers : [];
  const h = hs.find((x) => String(x.name || "").toLowerCase() === name);
  return h ? String(h.value || "") : "";
}
function _emailFromRaw(o) {
  if (!o || typeof o !== "object") return null;
  const pv = o.preview && typeof o.preview === "object" ? o.preview : {};
  const subject = _strField(o, ["subject", "title"]) || _strField(pv, ["subject", "title"]) || _headerVal(o, "subject") || "(no subject)";
  let sender = _strField(o, ["sender", "from", "fromAddress", "from_email", "author"]) || _strField(pv, ["sender", "from"]) || _headerVal(o, "from") || "Unknown sender";
  sender = sender.replace(/<[^>]*>/g, "").replace(/^"+|"+$/g, "").trim() || "Unknown sender";
  let date = _strField(o, ["date", "receivedAt", "received_at", "time"]) || _strField(pv, ["date"]) || _headerVal(o, "date");
  const epoch = _strField(o, ["internalDate", "timestamp", "epoch"]);
  const fmt = (ms) => new Date(Number(ms)).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  if (!date && /^\d{12,}$/.test(epoch)) date = fmt(epoch);
  else if (/^\d{12,}$/.test(date)) date = fmt(date);
  const snippetRaw = _strField(o, ["snippet", "previewText", "shortBody"]) || _strField(pv, ["body", "text", "snippet"]) || _strField(o, ["messageText"]);
  const snippet = snippetRaw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 140);
  return {
    id: _strField(o, ["messageId", "message_id", "id"]),
    threadId: _strField(o, ["threadId", "thread_id"]),
    sender, subject, date, snippet,
  };
}
function _looksEmail(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  const keys = Object.keys(o).join(" ").toLowerCase();
  return /(subject|sender|messageid|threadid|preview|snippet)/.test(keys);
}
function _collectEmails(node, out, depth) {
  if (!node || depth > 6 || out.length >= 25) return;
  if (Array.isArray(node)) {
    const objs = node.filter((x) => x && typeof x === "object");
    if (objs.length && objs.filter(_looksEmail).length >= Math.max(1, Math.ceil(objs.length / 2))) {
      for (const o of objs) { const e = _emailFromRaw(o); if (e) out.push(e); }
      return;
    }
    for (const x of node) _collectEmails(x, out, depth + 1);
    return;
  }
  if (typeof node === "object") for (const v of Object.values(node)) _collectEmails(v, out, depth + 1);
}
function extractEmails(rawText) {
  const data = _jsonFromText(rawText);
  if (data == null) return [];
  const out = [];
  _collectEmails(data, out, 0);
  return out.slice(0, 8);
}
function extractEmailBody(rawText) {
  const data = _jsonFromText(rawText);
  let best = "";
  const visit = (node, depth) => {
    if (!node || depth > 6 || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string" && /(messagetext|body|text|content|plain)/i.test(k) && v.length > best.length) best = v;
      else visit(v, depth + 1);
    }
  };
  if (data != null) visit(data, 0);
  const src = best || String(rawText || "");
  return src.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function _readIndex(t) {
  const m = t.match(/\b(?:read|open|play)\b[^.!?]*?\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|latest|newest|last|\d{1,2})(?:st|nd|rd|th)?\b/);
  if (m) {
    if (/latest|newest|last/.test(m[1])) return 0;
    const n = ORDINALS[m[1]] || parseInt(m[1], 10);
    return Number.isFinite(n) ? n - 1 : -1;
  }
  if (/\b(read|open)\s+(it|that|this)\b/.test(t)) return lastEmailList.length === 1 ? 0 : -1;
  return -1;
}

async function _groqSummarize(rawText, instruction) {
  const msgs = [
    { role: "system", content: SYS_PROMPT },
    { role: "user", content: instruction + "\n\nTool output:\n" + String(rawText).slice(0, 6000) },
  ];
  const msg = await groqOnce(msgs, []);
  const text = (msg.content || "").trim();
  if (!text) throw new Error("empty summary");
  return { text, via: lastGroqRoute + " · summary" };
}

async function _readEmailItem(item, idx) {
  const picks = _pickGmailTools(await _mcpTools());
  const head = `Email ${idx + 1} from ${item.sender} – ${item.subject}`;
  if (picks.read && item.id) {
    const rawOut = await Mcp.callTool(picks.read.full, _buildReadArgs(picks.read.schema, item));
    if (!MCP_ERR.test(rawOut)) {
      const body = extractEmailBody(rawOut);
      if (body) {
        return { text: `${head}:\n${body.slice(0, 3500)}`, speakText: `${head}. ${body.slice(0, 850)}`, via: picks.read.full };
      }
    }
  }
  // No direct read tool (or it failed): hand over to Groq with exact context.
  const lastUser = history[history.length - 1];
  if (lastUser && lastUser.role === "user") {
    lastUser.content += `\n(Context: this refers to email number ${idx + 1} from the list you just presented – from ${item.sender}, subject "${item.subject}"${item.id ? ", message id " + item.id : ""}. Use the available email tools to fetch the full message and read it out.)`;
  }
  return null;
}

/* Returns {text, speakText?, via?} – or null when Groq should take over. */
async function handleEmailIntent(raw) {
  const t = raw.toLowerCase();
  const mentionsEmail = EMAIL_WORD.test(t);

  // "Read the first/second/latest one" – against the last presented list
  const readIdx = _readIndex(t);
  if (readIdx >= 0 && (lastEmailList.length || mentionsEmail)) {
    if (!lastEmailList.length) {
      return { text: "I have not listed any emails yet, Sir. Ask me to show your latest emails first – afterwards simply say 'read the first one'." };
    }
    const item = lastEmailList[readIdx];
    if (!item) {
      return { text: `The list only has ${lastEmailList.length} email${lastEmailList.length === 1 ? "" : "s"}, Sir – please pick one of those numbers.` };
    }
    return await _readEmailItem(item, readIdx);
  }

  // Sending/composing goes to Groq + tools (it can use the send tool).
  if (mentionsEmail && /\b(send|write|compose|draft|reply|forward)\b/.test(t)) return null;

  const wantsList = mentionsEmail &&
    /(show|list|read|check|open|latest|recent|new|unread|my|any|what|get|fetch|see|do i have)/.test(t);
  if (!wantsList) return null;

  const tools = await _mcpTools();
  const picks = _pickGmailTools(tools);
  if (!picks.list) {
    if (!tools.length) {
      openPlugin("mcp");
      return { text: "No email account is connected yet, Sir – so I cannot fetch your emails. I have opened the MCP panel: connect Composio (Gmail) there, then simply ask 'Show my latest emails' again and I will read them to you." };
    }
    return null; // tools exist but no direct Gmail list tool (router): Groq + coaching
  }

  const rawOut = await Mcp.callTool(picks.list.full, _buildListArgs(picks.list.schema, raw));
  if (MCP_ERR.test(rawOut)) {
    return { text: "The Gmail tool reported a problem, Sir: " + rawOut.slice(0, 300) };
  }
  const items = extractEmails(rawOut);
  if (!items.length) {
    // Unstructured answer – let Groq turn the raw tool output into the list.
    return await _groqSummarize(rawOut,
      "List the emails from this tool output as a short numbered list (number, sender, subject, time). If there are none, say so briefly. Then offer to read one in full.");
  }
  lastEmailList = items;
  const lines = items.map((e, i) => `${i + 1}. ${e.sender} – ${e.subject}${e.date ? " (" + e.date + ")" : ""}`);
  const spoken = items.map((e, i) => `${i + 1}. From ${e.sender}: ${e.subject}.`);
  return {
    text: `Here are your latest emails, Sir:\n${lines.join("\n")}\nSay "read the first one" and I will read it to you in full.`,
    speakText: `Here are your latest emails, Sir. ${spoken.join(" ")} Shall I read one in full?`,
    via: picks.list.full,
  };
}

function timeoutSignal(ms) {
  // AbortSignal.timeout only exists in newer browsers – fallback without signal
  try { return typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined; }
  catch { return undefined; }
}

/* ------------------------------------------------ Local commands (EN) */
function runLocalCommand(raw) {
  const t = raw.toLowerCase().trim();

  let m = t.match(/weather(?:\s+in\s+([a-zäöüß-]+))?/);
  if (m) {
    const cityKey = Object.keys(CITIES).find((k) => CITIES[k].name.toLowerCase() === (m[1] || ""));
    if (cityKey) { state.city = cityKey; localStorage.setItem("jarvis_city", cityKey); }
    loadWeather();
    return `Loading the weather for ${CITIES[state.city].name}, Sir. The details are on the left of the dashboard.`;
  }
  m = t.match(/timer\s+(\d+)\s*(second|seconds|minute|minutes|hour|hours)?/);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2] || "minutes";
    const sec = unit.startsWith("second") ? n : unit.startsWith("hour") ? n * 3600 : n * 60;
    openPlugin("timer", { seconds: sec });
    return `Timer set to ${n} ${unit}, Sir.`;
  }
  m = t.match(/(?:calculate|compute|what is)\s+([\d\s+\-*/().]+)/) || t.match(/^([\d\s+\-*/().]+)$/);
  if (m && /[+\-*/]/.test(m[1])) {
    try {
      const expr = m[1].replace(/,/g, ".").replace(/[^0-9+\-*/(). ]/g, "");
      const val = Function('"use strict";return (' + expr + ")")();
      if (typeof val === "number" && isFinite(val)) return `The result is ${Math.round(val * 100) / 100}, Sir.`;
    } catch { /* fall through to Groq */ }
  }
  if (/what time|the time|clock/.test(t) && t.length < 40) {
    return `It is ${new Date().toLocaleTimeString("en-GB")}, Sir.`;
  }
  m = t.match(/(?:search|google)(?:\s+for)?\s+(.+)/);
  if (m) { openPlugin("search", { q: m[1] }); return `Searching for "${m[1]}", Sir.`; }
  const pluginCmds = {
    note: "notes", notes: "notes", todo: "todo", task: "todo", tasks: "todo",
    calculator: "calc",
    image: "image", picture: "image", translate: "translate",
    github: "github", crypto: "crypto", bitcoin: "crypto", news: "news",
    "world clock": "worldclock", light: "smart", lights: "smart", smart: "smart",
    pomodoro: "pomodoro", stopwatch: "stopwatch",
    // Only explicit MCP requests open the panel. Email questions are
    // handled above (handleEmailIntent) and must never land here.
    mcp: "mcp", composio: "mcp", connector: "mcp",
  };
  for (const [kw, id] of Object.entries(pluginCmds)) {
    if (t.includes(kw) && id) { openPlugin(id); return `The ${kw} plugin is open, Sir.`; }
  }
  if (/joke|funny/.test(t)) {
    const jokes = [
      "Why do programmers prefer dark mode? Because light attracts bugs.",
      "There are only 10 types of people: those who understand binary, and those who do not.",
      "A SQL query walks into a bar, sees two tables and asks: may I join you?",
    ];
    return jokes[Math.floor(Math.random() * jokes.length)];
  }
  if (/what can you do|abilities|help|commands/.test(t)) {
    return "I can show weather, run timers, a stopwatch and pomodoro, calculate, search the web, read Wikipedia and the news, track crypto, query GitHub, generate images, translate, and keep notes and tasks. Via MCP (for example Composio) I also fetch and read your emails aloud – ask \"Show my latest emails\", then \"Read the first one\". Every answer comes from Groq, my voice from the Pi.";
  }
  if (/\b(hello|hey|good morning|good afternoon|good evening)\b/.test(t) || t === "hi") return "Good day, Sir. How may I help?";
  if (/thank/.test(t)) return "You are most welcome, Sir.";
  if (/status|system/.test(t) && t.length < 40) return "All systems nominal, Sir. Device information, weather and the world clock are on the left.";

  return null; // -> Groq
}

/* ------------------------------------------------ Settings */
function fillVoiceOptions() {
  const sel = $("#setVoice");
  if (!sel) return;
  const voices = browserVoices();
  const gb = voices.filter((v) => v.lang && v.lang.toLowerCase().replace("_", "-").startsWith("en-gb"));
  const en = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("en") && !gb.includes(v));
  const rest = voices.filter((v) => !gb.includes(v) && !en.includes(v));
  const list = [...gb, ...en, ...rest];
  sel.innerHTML = '<option value="">Automatic (British English)</option>' +
    list.map((v) => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)} (${escapeHtml(v.lang)})</option>`).join("");
  sel.value = state.voice;
}

async function initSettings() {
  const sel = $("#setVoice");
  fillVoiceOptions();
  if (window.speechSynthesis) speechSynthesis.onvoiceschanged = fillVoiceOptions;
  $("#setTtsOn").checked = state.ttsOn;
  $("#setAutoSpeak").checked = state.autoSpeak;
  $("#setCity").value = state.city;
  $("#setGroqKey").value = state.groqKey;
  $("#setTtsUrl").value = state.ttsUrl;
  $("#setTtsToken").value = state.ttsToken;
  $("#setTtsVoice").value = state.ttsVoice;
  if (state.ttsServer && !state.ttsUrl) {
    ttsLog("Voicebox is configured centrally in Vercel – nothing to type. Just press 'Test voice'.");
  }
  $("#setPiMode").checked = state.pi;
  $("#btnTtsTest").onclick = () => testVoice();

  sel.onchange = () => { state.voice = sel.value; localStorage.setItem("jarvis_voice", sel.value); speak("Voice changed, Sir."); };
  $("#setTtsOn").onchange = (e) => { state.ttsOn = e.target.checked; localStorage.setItem("jarvis_tts", e.target.checked ? "1" : "0"); if (typeof voicePill === "function") voicePill(!state.ttsOn ? "off" : (state.ttsUrl || state.ttsServer) ? "pi" : "browser"); };
  $("#setAutoSpeak").onchange = (e) => { state.autoSpeak = e.target.checked; localStorage.setItem("jarvis_auto", e.target.checked ? "1" : "0"); };
  $("#setCity").onchange = (e) => { state.city = e.target.value; localStorage.setItem("jarvis_city", e.target.value); loadWeather(); };
  $("#setGroqKey").onchange = (e) => { state.groqKey = e.target.value.trim(); localStorage.setItem("jarvis_groq_key", state.groqKey); };
  $("#setTtsUrl").onchange = (e) => { state.ttsUrl = e.target.value.trim().replace(/\/$/, ""); localStorage.setItem("jarvis_tts_url", state.ttsUrl); ttsLog(state.ttsUrl ? "Voicebox URL set: " + state.ttsUrl : "Voicebox override cleared – central Vercel configuration applies."); };
  $("#setTtsToken").onchange = (e) => { state.ttsToken = e.target.value.trim(); localStorage.setItem("jarvis_tts_token", state.ttsToken); };
  $("#setTtsVoice").onchange = (e) => { state.ttsVoice = e.target.value || "en_GB-alan-medium"; localStorage.setItem("jarvis_tts_voice", state.ttsVoice); ttsLog("Pi voice set to " + state.ttsVoice + " (must be installed on the Pi)."); };
  $("#setPiMode").onchange = (e) => { state.pi = e.target.checked; localStorage.setItem("jarvis_pi", e.target.checked ? "1" : "0"); document.body.classList.toggle("pi", state.pi); };

  $("#btnSettings").onclick = async () => {
    $("#settingsModal").hidden = false;
    // AI status: Groq only
    const rows = [
      { ok: state.groqServerOk, name: "Groq (server key in Vercel)", note: state.groqServerOk ? "Active – every answer comes from Groq, nothing local." : "No server key found." },
      { ok: Boolean(state.groqKey), name: "Groq (your key in this browser)", note: state.groqKey ? "Stored as a fallback if the server route fails." : "Optional – get a free key at console.groq.com." },
    ];
    $("#llmList").innerHTML = rows.map((p) =>
      `<div>${p.ok ? "online" : "not set"} – ${escapeHtml(p.name)}<br><small class="muted">${escapeHtml(p.note)}</small></div>`).join("");
    $("#pillLLM").textContent = "● AI: " + (state.groqServerOk || state.groqKey ? "Groq" : "Groq (no key)");
    // MCP status
    try {
      const d = await Mcp.status();
      $("#mcpList").innerHTML = d.servers.map((s) =>
        `<div>${s.connected ? "online" : s.enabled ? "offline" : "off"} – ${escapeHtml(s.name)} – ${s.enabled ? s.tools + " tools" : "inactive"}${s.error ? `<br><small class="muted">${escapeHtml(s.error)}</small>` : ""}</div>`).join("")
        || '<span class="muted">No MCP servers. Add one in the MCP plugin, e.g. Composio.</span>';
    } catch { $("#mcpList").textContent = "MCP status unavailable."; }
  };
  $("#settingsClose").onclick = () => ($("#settingsModal").hidden = true);
}
