/* J.A.R.V.I.S – Chat ohne Backend: Befehls-Parser (offline) + Browser-KI.
 * KI-Reihenfolge (Einstellungen, Standard groq,ollama,pollinations):
 *   groq         – eigener Key im Browser (localStorage) ODER Vercel-Env (/api/chat)
 *   ollama       – lokales Mini-Modell (http://localhost:11434), inkl. MCP-Tools
 *   pollinations – keylos direkt aus dem Browser (keine Tools)
 *   demo         – regelbasiert offline
 * MCP-Tools (mcp.js) werden Groq & Ollama per Function-Calling gegeben;
 * der Tool-Loop (Modell -> tools/call -> Ergebnis -> Antwort) läuft hier. */
/* Hinweis: $ , API, CITIES, state, Mcp werden in app.js/mcp.js definiert. */

const history = [
  { role: "system", content: "Du bist J.A.R.V.I.S, ein höflicher KI-Assistent. Antworte kurz auf Deutsch." },
];
const SYS_PROMPT = "Du bist J.A.R.V.I.S (Just A Rather Very Intelligent System), ein höflicher, präziser KI-Assistent. Antworte auf Deutsch, kurz und klar, maximal 3-4 Sätze. Sprich den Nutzer mit 'Sir' an, wenn es passt. Keine Markdown-Tabellen, keine Emojis. Wenn dir Tools zur Verfügung stehen, nutze sie für aktuelle/faktische Informationen, statt zu raten.";

function addMsg(who, text, provider) {
  const log = $("#chatLog");
  const div = document.createElement("div");
  div.className = "msg " + (who === "user" ? "user" : "jarvis");
  div.innerHTML = `<span class="who">${who === "user" ? "Sie" : "J.A.R.V.I.S"}</span>${escapeHtml(text)}` +
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
  addMsg("jarvis", `Guten Tag, Sir. Ich bin J.A.R.V.I.S – jetzt komplett ohne eigenes Backend (Vercel): Browser-Stimme, Groq oder lokales Ollama als KI, dazu ${nPlugins} Plugins und echte MCP-Server (🔌, z. B. Composio). Sprechen Sie mich per 🎙 an oder schreiben Sie einen Befehl.`, "system");
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

  // 1) Lokale Befehle (offline, sofort)
  const local = runLocalCommand(text);
  if (local !== null) {
    history.push({ role: "assistant", content: local });
    addMsg("jarvis", local, "lokaler Befehl");
    speak(local);
    return;
  }

  // 2) KI im Browser (Groq/Ollama/Pollinations/Demo) inkl. MCP-Tool-Loop
  setOrb("speak", "Denke nach …");
  try {
    const data = await llmReply();
    history.push({ role: "assistant", content: data.text });
    const via = data.provider + (data.tools_used && data.tools_used.length ? " · 🔌 " + data.tools_used.join(", ") : "");
    addMsg("jarvis", data.text, via);
    if (data.tools_used && data.tools_used.length) loadMcpPill();
    $("#pillLLM").className = "pill ok"; $("#pillLLM").textContent = "● KI: " + data.provider;
    speak(data.text);
  } catch {
    const fallback = "Entschuldigung, Sir – die KI ist gerade nicht erreichbar. Lokale Befehle und Plugins funktionieren weiterhin. Tipp: Groq-Key in den ⚙ Einstellungen eintragen (kostenlos) oder Ollama lokal starten.";
    addMsg("jarvis", fallback, "offline");
    speak(fallback);
  } finally {
    setOrb("idle", "Bereit, Sir.");
  }
}

/* ------------------------------------------------------- KI-Engine (Browser) */
function chatMessages() {
  return [{ role: "system", content: SYS_PROMPT }, ...history.filter((h) => h.role !== "system").slice(-8)];
}

async function getMcpTools() {
  try { return typeof Mcp !== "undefined" ? await Mcp.openaiTools() : []; }
  catch { return []; }
}

async function groqOnce(msgs, tools) {
  const payload = { model: "llama-3.3-70b-versatile", messages: msgs, max_tokens: 700, temperature: 0.7 };
  if (tools && tools.length) { payload.tools = tools; payload.tool_choice = "auto"; }
  if (state.groqKey) {
    // Direkt zu Groq mit eigenem Key (bleibt nur in diesem Browser)
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + state.groqKey, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error("Groq HTTP " + r.status);
    return (await r.json()).choices[0].message;
  }
  if (state.functions) {
    // Über Vercel-Function (Key liegt serverseitig in der Env)
    const r = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: msgs, provider: "groq", tools }),
    });
    if (!r.ok) throw new Error("Vercel-Proxy HTTP " + r.status);
    return (await r.json()).choices[0].message;
  }
  throw new Error("Kein Groq-Key: in ⚙ Einstellungen eintragen oder GROQ_API_KEY in Vercel setzen");
}

function timeoutSignal(ms) {
  // AbortSignal.timeout gibt es erst in neueren Browsern – Fallback ohne Signal
  try { return typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined; }
  catch { return undefined; }
}

async function ollamaAvailable(force) {
  if (!force && state.ollamaOk !== null && Date.now() - state.ollamaOkAt < 30000) return state.ollamaOk;
  try {
    const r = await fetch(state.ollamaUrl + "/api/tags", { signal: timeoutSignal(2500) });
    state.ollamaOk = r.ok;
  } catch { state.ollamaOk = false; }
  state.ollamaOkAt = Date.now();
  return state.ollamaOk;
}

async function ollamaOnce(msgs, tools) {
  const payload = { model: state.ollamaModel, messages: msgs, stream: false };
  if (tools && tools.length) payload.tools = tools;
  const r = await fetch(state.ollamaUrl + "/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload), signal: timeoutSignal(120000),
  });
  if (!r.ok) throw new Error("Ollama HTTP " + r.status);
  return (await r.json()).message || {};
}

/* Generischer Tool-Loop: Modell darf MCP-Tools aufrufen (max. 3 Runden) */
async function toolLoop(callOnce, msgs, tools, isOllama) {
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
      if (isOllama) m.push({ role: "tool", content: String(result).slice(0, 6000) });
      else m.push({ role: "tool", tool_call_id: tc.id || fn.name, content: String(result).slice(0, 6000) });
    }
  }
  return { text: "Die Tool-Aufrufe haben zu viele Runden benötigt, Sir.", tools_used: used };
}

async function llmReply() {
  const tools = await getMcpTools();
  const order = state.llmOrder.split(",").map((s) => s.trim()).filter(Boolean);
  for (const pid of order) {
    try {
      if (pid === "groq") {
        const out = await toolLoop(groqOnce, chatMessages(), tools, false);
        if (out.text) return { ...out, provider: state.groqKey ? "groq" : "groq (Vercel)" };
      } else if (pid === "ollama") {
        if (!(await ollamaAvailable(false))) throw new Error("Ollama nicht erreichbar");
        const out = await toolLoop(ollamaOnce, chatMessages(), tools, true);
        if (out.text) return { ...out, provider: "ollama lokal" };
      } else if (pid === "pollinations") {
        const prompt = encodeURIComponent(chatMessages().slice(-6).map((m) => m.role + ": " + m.content).join("\n"));
        const r = await fetch(`https://text.pollinations.ai/${prompt}?model=openai`);
        if (!r.ok) throw new Error("pollinations fail");
        const text = (await r.text()).trim();
        if (text) return { text, provider: "pollinations", tools_used: [] };
      }
    } catch { /* nächster Anbieter */ }
  }
  return { text: demoReply(), provider: "demo", tools_used: [] };
}

function demoReply() {
  const last = (history[history.length - 1]?.content || "").toLowerCase();
  if (/witz|lustig/.test(last)) return "Warum mögen Programmierer den Dunkelmodus? Weil Licht Bugs anzieht.";
  if (/wer bist|was bist/.test(last)) return "Ich bin J.A.R.V.I.S – jetzt als reines Vercel-Dashboard ohne eigenes Backend, mit MCP-Anbindung (z. B. Composio) und optional lokalem Ollama.";
  if (/mcp|composio|tool/.test(last)) return "Meine MCP-Server verwaltest du im 🔌 MCP-Plugin: Composio-URL eintragen, verbinden, fertig. Die KI nutzt die Tools dann automatisch.";
  if (/hilfe|was kannst/.test(last)) return "Frag mich etwas oder nutze Befehle wie 'Wetter in Berlin', 'Timer 5 Minuten', 'Rechne 12*8'. Für echte KI: Groq-Key in den Einstellungen (kostenlos) – MCP-Tools (Composio & Co.) inklusive.";
  return "Verstanden, Sir. (Demo-Modus – für echte KI-Antworten kostenlosen Groq-Key in den ⚙ Einstellungen eintragen oder Ollama lokal starten.)";
}

/* ------------------------------------------------ Lokale Befehle (DE) */
function runLocalCommand(raw) {
  const t = raw.toLowerCase().trim();

  let m = t.match(/wetter(?:\s+in\s+(\w+))?/);
  if (m) {
    const cityKey = Object.keys(CITIES).find((k) => CITIES[k].name.toLowerCase() === (m[1] || ""));
    if (cityKey) { state.city = cityKey; localStorage.setItem("jarvis_city", cityKey); }
    loadWeather();
    return `Wetter für ${CITIES[state.city].name} wird geladen, Sir. Details stehen links im Dashboard.`;
  }
  m = t.match(/timer\s+(\d+)\s*(sekunde|minute|minuten|stunden)?/);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2] || "minute";
    const sec = unit.startsWith("sek") ? n : unit.startsWith("std") || unit.startsWith("stunde") ? n * 3600 : n * 60;
    openPlugin("timer", { seconds: sec });
    return `Timer auf ${n} ${unit} gesetzt, Sir.`;
  }
  m = t.match(/(?:rechne|berechne)\s+([\d\s+\-*/().]+)/) || t.match(/^([\d\s+\-*/().]+)$/);
  if (m && /[+\-*/]/.test(m[1])) {
    try {
      const expr = m[1].replace(/,/g, ".").replace(/[^0-9+\-*/(). ]/g, "");
      const val = Function('"use strict";return (' + expr + ")")();
      if (typeof val === "number" && isFinite(val)) return `Das Ergebnis lautet ${Math.round(val * 100) / 100}, Sir.`;
    } catch { /* weiter zur KI */ }
  }
  if (/wie spät|uhrzeit/.test(t)) {
    return `Es ist ${new Date().toLocaleTimeString("de-DE")} Uhr, Sir.`;
  }
  m = t.match(/(?:suche|such|google)\s+(?:nach\s+)?(.+)/);
  if (m) { openPlugin("search", { q: m[1] }); return `Ich suche nach „${m[1]}“, Sir.`; }
  const pluginCmds = {
    notiz: "notes", notizen: "notes", todo: "todo", aufgaben: "todo",
    rechner: "calc", taschenrechner: "calc", datei: "files", dateien: "files",
    bild: "image", witz: null, übersetz: "translate", übersetzen: "translate",
    github: "github", krypto: "crypto", nachrichten: "news", uhr: "worldclock",
    licht: "smart", smart: "smart", pomodoro: "pomodoro", stoppuhr: "stopwatch",
    mcp: "mcp", composio: "mcp", connector: "mcp", werkzeuge: "mcp", tools: "mcp",
    gmail: "mcp", mail: "mcp", mails: "mcp",
  };
  for (const [kw, id] of Object.entries(pluginCmds)) {
    if (t.includes(kw) && id) { openPlugin(id); return `Plugin „${kw}“ geöffnet, Sir.`; }
  }
  if (/witz|lustig/.test(t)) {
    const jokes = [
      "Warum mögen Programmierer den Dunkelmodus? Weil Licht Bugs anzieht.",
      "Es gibt nur 10 Arten von Menschen: die, die Binär verstehen, und die, die es nicht tun.",
      "Ein SQL-Query geht in eine Bar, sieht zwei Tabellen und fragt: „Darf ich mich joinen?“",
    ];
    return jokes[Math.floor(Math.random() * jokes.length)];
  }
  if (/was kannst|fähigkeiten|hilfe|befehle/.test(t)) {
    return "Ich kann: Wetter, Timer/Stoppuhr/Pomodoro, rechnen, Websuche, Wikipedia, Nachrichten, Krypto, GitHub, Bilder, übersetzen, Notizen/Todos. Per MCP (🔌, z. B. Composio) kommen echte Tools dazu – Gmail, Drive, Sheets u. v. m. Die KI (Groq gratis oder Ollama lokal) nutzt sie automatisch.";
  }
  if (/\b(hallo|hey|servus|moin)\b|guten tag/.test(t) || t === "hi") return "Guten Tag, Sir. Wie kann ich helfen?";
  if (/danke/.test(t)) return "Sehr gern, Sir.";
  if (/status|system/.test(t)) return "Alle Systeme nominal, Sir. Links siehst du Geräte-Infos, Wetter und Weltuhr.";

  return null; // -> KI
}

/* ------------------------------------------------ Einstellungen */
function fillVoiceOptions() {
  const sel = $("#setVoice");
  if (!sel) return;
  if (state.backendUrl) {
    // Edge-TTS-Stimmen des optionalen Pi-Backends
    fetch(state.backendUrl + "/api/voices").then((r) => r.json()).then((d) => {
      sel.innerHTML = d.voices.map((v) => `<option value="${v.id}">${v.label} (Edge TTS)</option>`).join("");
      sel.value = state.voice || d.default;
    }).catch(() => { sel.innerHTML = '<option value="de-DE-ConradNeural">Conrad (Edge TTS)</option>'; });
    return;
  }
  const voices = browserVoices();
  const de = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("de"));
  const rest = voices.filter((v) => !(v.lang && v.lang.toLowerCase().startsWith("de")));
  const list = [...de, ...rest];
  sel.innerHTML = '<option value="">Automatisch (Deutsch)</option>' +
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
  $("#setLlmOrder").value = state.llmOrder;
  $("#setOllamaUrl").value = state.ollamaUrl;
  $("#setOllamaModel").value = state.ollamaModel;
  $("#setBackendUrl").value = state.backendUrl;
  $("#setTtsUrl").value = state.ttsUrl;
  $("#setTtsToken").value = state.ttsToken;
  $("#setTtsVoice").value = state.ttsVoice;
  $("#setPiMode").checked = state.pi;
  $("#btnTtsTest").onclick = () => testVoice();

  sel.onchange = () => { state.voice = sel.value; localStorage.setItem("jarvis_voice", sel.value); speak("Stimme geändert, Sir."); };
  $("#setTtsOn").onchange = (e) => { state.ttsOn = e.target.checked; localStorage.setItem("jarvis_tts", e.target.checked ? "1" : "0"); };
  $("#setAutoSpeak").onchange = (e) => { state.autoSpeak = e.target.checked; localStorage.setItem("jarvis_auto", e.target.checked ? "1" : "0"); };
  $("#setCity").onchange = (e) => { state.city = e.target.value; localStorage.setItem("jarvis_city", e.target.value); loadWeather(); };
  $("#setGroqKey").onchange = (e) => { state.groqKey = e.target.value.trim(); localStorage.setItem("jarvis_groq_key", state.groqKey); };
  $("#setLlmOrder").onchange = (e) => { state.llmOrder = e.target.value; localStorage.setItem("jarvis_llm_order", state.llmOrder); };
  $("#setOllamaUrl").onchange = (e) => { state.ollamaUrl = e.target.value.trim().replace(/\/$/, "") || "http://localhost:11434"; localStorage.setItem("jarvis_ollama_url", state.ollamaUrl); state.ollamaOk = null; };
  $("#setOllamaModel").onchange = (e) => { state.ollamaModel = e.target.value.trim() || "qwen2.5:0.5b"; localStorage.setItem("jarvis_ollama_model", state.ollamaModel); };
  $("#setBackendUrl").onchange = (e) => { state.backendUrl = e.target.value.trim().replace(/\/$/, ""); localStorage.setItem("jarvis_backend_url", state.backendUrl); fillVoiceOptions(); pollSystem(); };
  $("#setTtsUrl").onchange = (e) => { state.ttsUrl = e.target.value.trim().replace(/\/$/, ""); localStorage.setItem("jarvis_tts_url", state.ttsUrl); ttsLog(state.ttsUrl ? "Voicebox-URL gesetzt: " + state.ttsUrl : "Voicebox aus – Browser-Stimme aktiv."); };
  $("#setTtsToken").onchange = (e) => { state.ttsToken = e.target.value.trim(); localStorage.setItem("jarvis_tts_token", state.ttsToken); };
  $("#setTtsVoice").onchange = (e) => { state.ttsVoice = e.target.value.trim() || "de_DE-thorsten-medium"; localStorage.setItem("jarvis_tts_voice", state.ttsVoice); };
  $("#setPiMode").onchange = (e) => { state.pi = e.target.checked; localStorage.setItem("jarvis_pi", e.target.checked ? "1" : "0"); document.body.classList.toggle("pi", state.pi); };

  $("#btnSettings").onclick = async () => {
    $("#settingsModal").hidden = false;
    // KI-Status (ohne Backend berechenbar)
    const ollamaOk = await ollamaAvailable(true);
    const rows = [
      { ok: Boolean(state.groqKey) || Boolean(state.llmEnv.groq), name: "Groq (Free Tier) ⭐", note: state.groqKey ? "Eigener Key im Browser gespeichert" : state.llmEnv.groq ? "Key serverseitig in Vercel-Env" : "Key fehlt – kostenlos auf console.groq.com holen und links eintragen" },
      { ok: ollamaOk, name: "Ollama lokal (Mini-Modell)", note: `${state.ollamaUrl} · Modell ${state.ollamaModel} · inkl. MCP-Tools (CORS: OLLAMA_ORIGINS setzen, siehe MCP.md)` },
      { ok: true, name: "Pollinations (kein Key)", note: "Keyloser Fallback, keine MCP-Tools" },
      { ok: true, name: "Demo-Modus (offline)", note: "Regelbasiert, immer verfügbar" },
    ];
    $("#llmList").innerHTML = rows.map((p) =>
      `<div>${p.ok ? "✅" : "⚪"} ${escapeHtml(p.name)}<br><small class="muted">${escapeHtml(p.note)}</small></div>`).join("");
    $("#pillLLM").textContent = "● KI: " + (state.groqKey || state.llmEnv.groq ? "groq" : ollamaOk ? "ollama" : "demo");
    // MCP-Status
    try {
      const d = await Mcp.status();
      $("#mcpList").innerHTML = d.servers.map((s) =>
        `<div>${s.connected ? "✅" : s.enabled ? "❌" : "⚪"} ${escapeHtml(s.name)} – ${s.enabled ? s.tools + " Tools" : "inaktiv"}${s.error ? `<br><small class="muted">${escapeHtml(s.error)}</small>` : ""}</div>`).join("")
        || '<span class="muted">Keine MCP-Server. Im 🔌 MCP-Plugin z. B. Composio hinzufügen.</span>';
    } catch { $("#mcpList").textContent = "MCP-Status nicht verfügbar."; }
  };
  $("#settingsClose").onclick = () => ($("#settingsModal").hidden = true);
}
