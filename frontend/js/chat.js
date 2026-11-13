/* J.A.R.V.I.S – Chat, Befehls-Parser (offline) + KI-Fallback-Kette */
/* Hinweis: $ , API, CITIES und state werden zentral in app.js definiert (wird zuerst geladen). */

const history = [
  { role: "system", content: "Du bist J.A.R.V.I.S, ein höflicher KI-Assistent. Antworte kurz auf Deutsch." },
];

function addMsg(who, text, provider) {
  const log = $("#chatLog");
  const div = document.createElement("div");
  div.className = "msg " + (who === "user" ? "user" : "jarvis");
  div.innerHTML = `<span class="who">${who === "user" ? "Sie" : "J.A.R.V.I.S"}</span>${escapeHtml(text)}` +
    (provider ? `<span class="prov">via ${provider}</span>` : "");
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function initChat() {
  const nPlugins = typeof PLUGINS !== "undefined" ? PLUGINS.length : 19;
  addMsg("jarvis", `Guten Tag, Sir. Ich bin J.A.R.V.I.S – komplett kostenlos betrieben: Edge TTS für die Stimme, Pollinations oder Ollama für die KI, dazu ${nPlugins} Plugins. Sprechen Sie mich per 🎙 an oder schreiben Sie einen Befehl.`, "system");
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

  // 2) KI über Backend (Ollama -> Pollinations -> Keys -> Demo)
  setOrb("speak", "Denke nach …");
  try {
    let data;
    if (state.backend) {
      const r = await fetch(API + "/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-10) }),
      });
      if (!r.ok) throw new Error("backend chat fail");
      data = await r.json();
    } else {
      // Direkt Pollinations aus dem Browser (kein Key)
      const prompt = encodeURIComponent(history.slice(-6).map((m) => m.role + ": " + m.content).join("\n"));
      const r = await fetch(`https://text.pollinations.ai/${prompt}?model=openai`);
      if (!r.ok) throw new Error("pollinations fail");
      data = { text: (await r.text()).trim(), provider: "pollinations (direkt)" };
    }
    history.push({ role: "assistant", content: data.text });
    addMsg("jarvis", data.text, data.provider);
    $("#pillLLM").className = "pill ok"; $("#pillLLM").textContent = "● KI: " + data.provider;
    speak(data.text);
  } catch {
    const fallback = "Entschuldigung, Sir – die KI ist gerade nicht erreichbar. Meine lokalen Befehle und Plugins funktionieren aber weiterhin. Tipp: Backend starten mit: python backend/server.py";
    addMsg("jarvis", fallback, "offline");
    speak(fallback);
  } finally {
    setOrb("idle", "Bereit, Sir.");
  }
}

/* ------------------------------------------------ Lokale Befehle (DE) */
function runLocalCommand(raw) {
  const t = raw.toLowerCase().trim();

  // Wetter
  let m = t.match(/wetter(?:\s+in\s+(\w+))?/);
  if (m) {
    const cityKey = Object.keys(CITIES).find((k) => CITIES[k].name.toLowerCase() === (m[1] || ""));
    if (cityKey) { state.city = cityKey; localStorage.setItem("jarvis_city", cityKey); }
    loadWeather();
    return `Wetter für ${CITIES[state.city].name} wird geladen, Sir. Details stehen links im Dashboard.`;
  }
  // Timer
  m = t.match(/timer\s+(\d+)\s*(sekunde|minute|minuten|stunden)?/);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2] || "minute";
    const sec = unit.startsWith("sek") ? n : unit.startsWith("std") || unit.startsWith("stunde") ? n * 3600 : n * 60;
    openPlugin("timer", { seconds: sec });
    return `Timer auf ${n} ${unit} gesetzt, Sir.`;
  }
  // Rechnen
  m = t.match(/(?:rechne|berechne)\s+([\d\s+\-*/().]+)/) || t.match(/^([\d\s+\-*/().]+)$/);
  if (m && /[+\-*/]/.test(m[1])) {
    try {
      const expr = m[1].replace(/,/g, ".").replace(/[^0-9+\-*/(). ]/g, "");
      const val = Function('"use strict";return (' + expr + ")")();
      if (typeof val === "number" && isFinite(val)) return `Das Ergebnis lautet ${Math.round(val * 100) / 100}, Sir.`;
    } catch { /* weiter zur KI */ }
  }
  // Uhrzeit
  if (/wie spät|uhrzeit|zeit/.test(t)) {
    const now = new Date();
    return `Es ist ${now.toLocaleTimeString("de-DE")} Uhr, Sir.`;
  }
  // Suche
  m = t.match(/(?:suche|such|google)\s+(?:nach\s+)?(.+)/);
  if (m) { openPlugin("search", { q: m[1] }); return `Ich suche nach „${m[1]}“, Sir.`; }
  // Plugin öffnen
  const pluginCmds = {
    notiz: "notes", notizen: "notes", todo: "todo", aufgaben: "todo",
    rechner: "calc", taschenrechner: "calc", datei: "files", dateien: "files",
    bild: "image", witz: null, übersetz: "translate", übersetzen: "translate",
    github: "github", krypto: "crypto", nachrichten: "news", uhr: "worldclock",
    licht: "smart", smart: "smart", pomodoro: "pomodoro", stoppuhr: "stopwatch",
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
    return "Ich kann: Wetter anzeigen, Timer und Stoppuhr, rechnen, im Web suchen, Wikipedia, Nachrichten, Krypto-Kurse, GitHub, Bilder generieren, übersetzen, Dateien durchsuchen, Notizen und Todos, Pomodoro und Smart-Light-Demo. Oder stellen Sie mir eine beliebige Frage – die KI antwortet kostenlos über Pollinations oder lokal über Ollama.";
  }
  if (/\b(hallo|hey|servus|moin)\b|guten tag/.test(t) || t === "hi") return "Guten Tag, Sir. Wie kann ich helfen?";
  if (/danke/.test(t)) return "Sehr gern, Sir.";
  if (/status|system/.test(t)) return "Alle Systeme nominal, Sir. CPU, Speicher und Festplatte werden links live überwacht.";

  return null; // -> KI
}

/* ------------------------------------------------ Einstellungen */
async function initSettings() {
  // Stimmen laden
  const sel = $("#setVoice");
  const fallbackVoices = [
    { id: "de-DE-ConradNeural", label: "Conrad – Deutsch (männlich, JARVIS)" },
    { id: "de-DE-KatjaNeural", label: "Katja – Deutsch (weiblich)" },
    { id: "en-GB-RyanNeural", label: "Ryan – Englisch UK (männlich)" },
    { id: "en-US-GuyNeural", label: "Guy – Englisch US (männlich)" },
  ];
  try {
    const r = await fetch(API + "/api/voices");
    const d = await r.json();
    sel.innerHTML = d.voices.map((v) => `<option value="${v.id}">${v.label}</option>`).join("");
  } catch {
    sel.innerHTML = fallbackVoices.map((v) => `<option value="${v.id}">${v.label}</option>`).join("");
  }
  sel.value = state.voice;
  $("#setTtsOn").checked = state.ttsOn;
  $("#setAutoSpeak").checked = state.autoSpeak;
  $("#setCity").value = state.city;

  sel.onchange = () => { state.voice = sel.value; localStorage.setItem("jarvis_voice", sel.value); speak("Stimme geändert, Sir."); };
  $("#setTtsOn").onchange = (e) => { state.ttsOn = e.target.checked; localStorage.setItem("jarvis_tts", e.target.checked ? "1" : "0"); };
  $("#setAutoSpeak").onchange = (e) => { state.autoSpeak = e.target.checked; localStorage.setItem("jarvis_auto", e.target.checked ? "1" : "0"); };
  $("#setCity").onchange = (e) => { state.city = e.target.value; localStorage.setItem("jarvis_city", e.target.value); loadWeather(); };

  $("#btnSettings").onclick = async () => {
    $("#settingsModal").hidden = false;
    try {
      const r = await fetch(API + "/api/llm/status");
      const d = await r.json();
      $("#llmList").innerHTML = d.providers.map((p) =>
        `<div>${p.available ? "✅" : "⚪"} ${p.name}${p.key_needed ? " (Key in .env)" : ""}</div>`).join("");
      $("#pillLLM").textContent = "● KI: " + (d.providers.find((p) => p.available)?.name || "Demo");
    } catch {
      $("#llmList").textContent = "Backend offline – Pollinations direkt + Demo-Modus aktiv.";
    }
  };
  $("#settingsClose").onclick = () => ($("#settingsModal").hidden = true);
}
