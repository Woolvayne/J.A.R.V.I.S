/* J.A.R.V.I.S – Chat: small deterministic commands (UI actions) + Groq.
 * AI policy: Groq ONLY. No local model, no keyless fallback, no demo
 * answers. Route: the server key in the Vercel env (/api/chat) first,
 * your own browser key second. MCP tools (mcp.js) are handed to Groq
 * via function calling; the tool loop runs here in the browser. */
/* Note: $, API, CITIES, state, Mcp are defined in app.js/mcp.js. */

const history = [];
const SYS_PROMPT = "You are J.A.R.V.I.S (Just A Rather Very Intelligent System), a polite, precise British AI butler. Always answer in British English, briefly and clearly, in at most 3-4 sentences. Address the user as 'Sir' where fitting. No emojis, no markdown tables. If tools are available, use them for current or factual information instead of guessing.";

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
  addMsg("jarvis", `Good day, Sir. I am J.A.R.V.I.S – running entirely on Vercel: Groq is my only AI, my voice is the British Pi voice, and ${nPlugins} plugins plus real MCP servers (for example Composio) are at your disposal. Tap the orb to speak, or type a command below.`, "system");
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

  // 1) Deterministic UI commands (timer, weather panel, calculator …).
  //    These are interface actions, not AI – every real answer is Groq.
  const local = runLocalCommand(text);
  if (local !== null) {
    history.push({ role: "assistant", content: local });
    addMsg("jarvis", local, "command");
    speak(local);
    return;
  }

  // 2) Groq (with MCP tool loop)
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
  return [{ role: "system", content: SYS_PROMPT }, ...history.slice(-8)];
}

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

/* Generic tool loop: the model may call MCP tools (max. 3 rounds) */
async function toolLoop(callOnce, msgs, tools) {
  const used = [];
  const m = [...msgs];
  for (let round = 0; round < 4; round++) {
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
  const out = await toolLoop(groqOnce, chatMessages(), tools);
  if (!out.text) throw new Error("Groq returned an empty answer");
  return { ...out, provider: lastGroqRoute };
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
    mcp: "mcp", composio: "mcp", connector: "mcp", tools: "mcp",
    gmail: "mcp", mail: "mcp", email: "mcp", emails: "mcp",
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
    return "I can show weather, run timers, a stopwatch and pomodoro, calculate, search the web, read Wikipedia and the news, track crypto, query GitHub, generate images, translate, and keep notes and tasks. Via MCP (for example Composio) real tools join in – Gmail, Drive, Sheets and more. Every answer comes from Groq, my voice from the Pi.";
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
