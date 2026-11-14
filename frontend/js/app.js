/* J.A.R.V.I.S – Core (Vercel/browser edition): boot, clock, device info,
   weather, news, crypto, orb. No local AI and no local backend:
   - AI answers come exclusively from Groq (via /api/chat or your own key)
   - Voice comes from the Pi Voicebox (Piper, British voice Alan) via
     /api/tts, with the browser voice as fallback
   - Vercel Functions (/api/*) are used when present (state.functions) */
const $ = (s) => document.querySelector(s);
const API = ""; // same origin (Vercel serves frontend + /api)

const CITIES = {
  london: { lat: 51.5074, lon: -0.1278, name: "London" },
  giesen: { lat: 52.15, lon: 9.95, name: "Giesen" },
  berlin: { lat: 52.52, lon: 13.405, name: "Berlin" },
  hamburg: { lat: 53.55, lon: 9.99, name: "Hamburg" },
  muenchen: { lat: 48.14, lon: 11.58, name: "Munich" },
  koeln: { lat: 50.94, lon: 6.96, name: "Cologne" },
  wien: { lat: 48.2, lon: 16.37, name: "Vienna" },
  zuerich: { lat: 47.37, lon: 8.54, name: "Zurich" },
};

/* One-time migration to v3 (English / Groq-only / British voice):
   reset the old German voice and drop obsolete local-provider settings. */
try {
  if (localStorage.getItem("jarvis_v3") !== "1") {
    localStorage.setItem("jarvis_tts_voice", "en_GB-alan-medium");
    localStorage.removeItem("jarvis_llm_order");
    localStorage.removeItem("jarvis_ollama_url");
    localStorage.removeItem("jarvis_ollama_model");
    localStorage.removeItem("jarvis_backend_url");
    localStorage.setItem("jarvis_v3", "1");
  }
} catch { /* private mode etc. */ }

const SESSION_START = Date.now();

const state = {
  city: localStorage.getItem("jarvis_city") || "giesen",
  voice: localStorage.getItem("jarvis_voice") || "",
  ttsOn: localStorage.getItem("jarvis_tts") !== "0",
  autoSpeak: localStorage.getItem("jarvis_auto") !== "0",
  // Vercel mode
  functions: false,           // /api/health reachable (Vercel Functions active)
  llmEnv: {},                 // which keys exist server-side (booleans only)
  // AI: Groq only. Your own browser key is a fallback; the server key wins.
  groqKey: localStorage.getItem("jarvis_groq_key") || "",
  groqServerOk: false,
  piAi: false,                // Pi AI fallback (Ollama aibox) configured in Vercel?
  // Pi "Voicebox" (Piper TTS on the Pi, public via Cloudflare tunnel):
  // JARVIS fetches WAV audio from there. Beats the browser voice.
  ttsUrl: (localStorage.getItem("jarvis_tts_url") || "").replace(/\/$/, ""),
  ttsToken: localStorage.getItem("jarvis_tts_token") || "",
  ttsVoice: localStorage.getItem("jarvis_tts_voice") || "en_GB-alan-medium",
  // Voicebox configured centrally in Vercel? (/api/health only reports
  // voicebox:true) – then speech runs through /api/tts and nothing needs
  // to be typed on this device. A local entry (ttsUrl) still wins.
  ttsServer: false,
  // Display
  pi: localStorage.getItem("jarvis_pi") === "1",  // low-power mode
  systemMs: 7000,
};

/* ------------------------------------------------------------- Boot */
async function boot() {
  const lines = [
    "Initialising core systems …",
    "Loading voice modules …",
    "Connecting to Groq …",
    "Connecting MCP servers and plugins …",
    "All systems operational.",
  ];
  const fill = $("#bootFill"), line = $("#bootLine");
  for (let i = 0; i < lines.length; i++) {
    line.textContent = lines[i];
    fill.style.width = ((i + 1) / lines.length) * 100 + "%";
    await new Promise((r) => setTimeout(r, 260));
  }
  $("#boot").classList.add("done");
  setTimeout(() => $("#boot").remove(), 800);
  if (state.autoSpeak) speak("J.A.R.V.I.S online, Sir. All systems operational. How may I help?");
}

/* ------------------------------------------------------------- Clock */
function tickClock() {
  const now = new Date();
  $("#clock").textContent = now.toLocaleTimeString("en-GB");
  $("#dateLine").textContent = now.toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const zones = [
    ["London", "Europe/London"], ["Berlin", "Europe/Berlin"],
    ["New York", "America/New_York"], ["Tokyo", "Asia/Tokyo"],
  ];
  $("#worldClock").innerHTML = zones.map(([n, z]) => {
    const t = new Date().toLocaleTimeString("en-GB", { timeZone: z, hour: "2-digit", minute: "2-digit" });
    return `<div class="kv"><span>${n}</span><b>${t}</b></div>`;
  }).join("");
}

/* ------------------------------------------------------------- Gauges */
function drawGauge(id, pct) {
  const c = document.getElementById(id);
  if (!c) return;
  const ctx = c.getContext("2d");
  const cx = 45, cy = 45, r = 38;
  ctx.clearRect(0, 0, 90, 90);
  ctx.lineWidth = 7; ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(0,212,255,.15)";
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
  const p = Math.max(0, Math.min(100, pct)) / 100;
  ctx.strokeStyle = p > 85 ? "#ff4d6d" : p > 65 ? "#ffb020" : "#00d4ff";
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 0.75 + p * Math.PI * 1.5); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.font = "bold 15px sans-serif"; ctx.textAlign = "center";
  ctx.fillText(Math.round(pct) + "%", cx, cy + 5);
}

function _gaugeLabel(canvasId, text) {
  const label = document.querySelector(`#${canvasId}`)?.closest(".gauge")?.querySelector("label");
  if (label && label.childNodes[0]) label.childNodes[0].textContent = text + " ";
}

async function pollSystem() {
  // Browser device info (honestly only what the browser exposes)
  _gaugeLabel("gCpu", "CORES"); _gaugeLabel("gRam", "RAM"); _gaugeLabel("gDisk", "STORAGE");
  const title = $("#cardSystem").querySelector("h2");
  if (title && title.lastChild) title.lastChild.textContent = " System";
  const cores = navigator.hardwareConcurrency || 4;
  drawGauge("gCpu", Math.min(100, (cores / 8) * 100));
  $("#vCpu").textContent = cores + " cores";
  if (navigator.deviceMemory) {
    drawGauge("gRam", Math.min(100, (navigator.deviceMemory / 16) * 100));
    $("#vRam").textContent = "approx. " + navigator.deviceMemory + " GB";
  } else if (performance.memory) {
    const pct = (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100;
    drawGauge("gRam", pct);
    $("#vRam").textContent = Math.round(performance.memory.usedJSHeapSize / 1048576) + " MB JS";
  } else {
    drawGauge("gRam", 0); $("#vRam").textContent = "n/a";
  }
  try {
    const est = await navigator.storage.estimate();
    if (est && est.quota) {
      drawGauge("gDisk", (est.usage / est.quota) * 100);
      $("#vDisk").textContent = (est.usage / 1e9).toFixed(2) + "/" + (est.quota / 1e9).toFixed(1) + " GB";
    } else { drawGauge("gDisk", 0); $("#vDisk").textContent = "n/a"; }
  } catch { drawGauge("gDisk", 0); $("#vDisk").textContent = "n/a"; }
  const up = Math.floor((Date.now() - SESSION_START) / 1000);
  $("#vUptime").textContent = `${Math.floor(up / 3600)} h ${Math.floor((up % 3600) / 60)} min`;
  $("#vPlatform").textContent = (navigator.userAgentData?.platform || navigator.platform || "Browser") +
    (navigator.onLine ? " · online" : " · offline");
  const pill = $("#pillBackend");
  if (pill) {
    pill.className = state.functions ? "pill ok" : "pill warn";
    pill.textContent = state.functions ? "● Vercel online" : "● Browser only";
  }
}

/* ------------------------------------------------------------- Weather */
const WMO_LABELS = { 0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle", 55: "Drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 80: "Showers", 81: "Showers",
  82: "Violent showers", 95: "Thunderstorm", 96: "Thunderstorm + hail", 99: "Thunderstorm + hail" };

async function loadWeather() {
  const c = CITIES[state.city] || CITIES.giesen;
  const body = $("#weatherBody");
  body.innerHTML = '<p class="muted">Loading weather …</p>';
  try {
    // Directly from the browser via Open-Meteo (CORS-friendly, no key)
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`);
    if (!r.ok) throw new Error("weather");
    const cur = (await r.json()).current;
    body.innerHTML = `
      <div style="font-size:2.2rem;font-weight:800;color:#fff">${cur.temperature_2m}°C</div>
      <div>${WMO_LABELS[cur.weather_code] || "Weather code " + cur.weather_code} in ${c.name}</div>
      <div class="kv"><span>Feels like</span><b>${cur.apparent_temperature}°C</b></div>
      <div class="kv"><span>Humidity</span><b>${cur.relative_humidity_2m}%</b></div>
      <div class="kv"><span>Wind</span><b>${cur.wind_speed_10m} km/h</b></div>
      <p class="muted small">Source: Open-Meteo (free, direct from the browser)</p>`;
  } catch {
    body.innerHTML = '<p class="muted">Weather unavailable right now (network?).</p>';
  }
}

/* ------------------------------------------------------------- News */
async function loadNews() {
  const feed = $("#newsFeed").value;
  const body = $("#newsBody");
  body.innerHTML = '<p class="muted">Loading news …</p>';
  try {
    let items;
    if (state.functions) {
      const r = await fetch(`${API}/api/news?feed=${feed}`);
      if (!r.ok) throw new Error("proxy fail");
      items = (await r.json()).items;
    } else {
      const feeds = {
        bbc: "https://feeds.bbci.co.uk/news/rss.xml",
        guardian: "https://www.theguardian.com/world/rss",
        npr: "https://feeds.npr.org/1001/rss.xml",
        sky: "https://feeds.skynews.com/feeds/rss/home.xml",
      };
      const r = await fetch(feeds[feed]);
      const xml = await r.text();
      const doc = new DOMParser().parseFromString(xml, "text/xml");
      items = [...doc.querySelectorAll("item")].slice(0, 8).map((i) => ({
        title: i.querySelector("title")?.textContent || "",
        link: i.querySelector("link")?.textContent || "#",
        date: i.querySelector("pubDate")?.textContent || "",
      }));
    }
    body.innerHTML = items.map((n) =>
      `<div class="news-item"><a href="${n.link}" target="_blank" rel="noopener">${escapeHtml(n.title)}</a><small>${escapeHtml(n.date)}</small></div>`
    ).join("") || '<p class="muted">No entries.</p>';
  } catch {
    body.innerHTML = '<p class="muted">News feed unreachable. On Vercel, /api/news fetches it for you.</p>';
  }
}

/* ------------------------------------------------------------- Crypto */
async function loadCrypto() {
  const body = $("#cryptoBody");
  try {
    // CoinGecko directly from the browser (CORS-friendly, no key)
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=eur&include_24hr_change=true");
    if (!r.ok) throw new Error("coingecko");
    const d = await r.json();
    const rows = [["bitcoin", "Bitcoin"], ["ethereum", "Ethereum"], ["solana", "Solana"]];
    body.innerHTML = rows.map(([id, name]) => {
      const v = d[id];
      if (!v) return "";
      const chg = v.eur_24h_change;
      const cls = chg >= 0 ? "up" : "down";
      return `<div class="crypto-row"><span>${name}</span><b>${Number(v.eur).toLocaleString("en-GB")} € <span class="${cls}">${chg >= 0 ? "+" : "−"}${Math.abs(chg).toFixed(1)}%</span></b></div>`;
    }).join("") + '<p class="muted small">Source: CoinGecko (free, direct)</p>';
  } catch {
    body.innerHTML = '<p class="muted">Crypto prices unreachable (network or free rate limit).</p>';
  }
}

/* ------------------------------------------------------------- Orb */
const orb = $("#orb"), octx = orb.getContext("2d");
let orbMode = "idle", orbT = 0, orbFrame = 0;
function drawOrb() {
  if (document.hidden) { requestAnimationFrame(drawOrb); return; } // save battery while tab hidden
  orbFrame++;
  if (state.pi && orbFrame % 2 === 1) { requestAnimationFrame(drawOrb); return; } // low-power: ~30 FPS
  orbT += 0.02;
  const w = orb.width, h = orb.height, cx = w / 2, cy = h / 2;
  octx.clearRect(0, 0, w, h);
  const speed = orbMode === "speak" ? 0.05 : orbMode === "listen" ? 0.035 : 0.012;
  const baseR = orbMode === "speak" ? 92 : 84;
  for (let i = 0; i < 3; i++) {
    octx.beginPath();
    octx.strokeStyle = `rgba(0,212,255,${0.55 - i * 0.14})`;
    octx.lineWidth = 2;
    const r = baseR + i * 16 + Math.sin(orbT * 2 + i) * 3;
    octx.arc(cx, cy, r, orbT * (speed * 40 + i * 0.4), orbT * (speed * 40 + i * 0.4) + Math.PI * 1.5);
    octx.stroke();
  }
  const pulse = 1 + Math.sin(orbT * (orbMode === "speak" ? 6 : 2)) * (orbMode === "speak" ? 0.08 : 0.03);
  const g = octx.createRadialGradient(cx, cy, 5, cx, cy, 70 * pulse);
  g.addColorStop(0, "rgba(180,245,255,.95)");
  g.addColorStop(0.4, "rgba(0,212,255,.75)");
  g.addColorStop(1, "rgba(0,80,160,.05)");
  octx.fillStyle = g;
  octx.beginPath(); octx.arc(cx, cy, 70 * pulse, 0, Math.PI * 2); octx.fill();
  const particles = state.pi ? 8 : 24;
  octx.fillStyle = "rgba(77,232,255,.8)";
  for (let i = 0; i < particles; i++) {
    const a = orbT * speed * 30 + (i / particles) * Math.PI * 2;
    const r = 100 + Math.sin(orbT * 3 + i) * 8;
    octx.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2.5, 2.5);
  }
  requestAnimationFrame(drawOrb);
}
function setOrb(mode, text) {
  orbMode = mode;
  $("#orbStatus").textContent = text;
  $("#wave").classList.toggle("on", mode === "speak" || mode === "listen");
}

/* ------------------------------------------- Vercel detection + MCP pill */
// If the Composio Connect key exists server-side, JARVIS creates that MCP
// server automatically (header stays empty – /api/mcp injects the key).
// A placeholder key stored in the browser is cleaned up in the process.
function ensureComposioConnect(health) {
  try {
    if (!health || !health.composio_connect || typeof Mcp === "undefined") return;
    const url = "https://connect.composio.dev/mcp";
    const list = Mcp.loadServers();
    let changed = false;
    let found = list.find((s) => s.url === url || s.name === "composio-connect");
    if (found) {
      if (found.url !== url) { found.url = url; changed = true; }
      if (found.via !== "proxy") { found.via = "proxy"; changed = true; }
      const vals = Object.values(found.headers || {}).map(String);
      if (!vals.length || vals.some((v) => v.includes("YOUR_") || v.includes("DEIN"))) {
        if (vals.length) { found.headers = {}; changed = true; }
      }
    } else {
      list.push({ name: "composio-connect", url, headers: {}, via: "proxy", enabled: true });
      changed = true;
    }
    if (changed) Mcp.saveServers(list);
  } catch { /* MCP stays manually configurable */ }
}

async function fetchHealth() {
  if (state.pi) { document.body.classList.add("pi"); }
  try {
    const r = await fetch(API + "/api/health", { cache: "no-store" });
    if (!r.ok) throw new Error("no functions");
    const d = await r.json();
    state.functions = true;
    state.llmEnv = d.llm_env || {};
    state.groqServerOk = Boolean(d.llm_env && d.llm_env.groq);
    state.piAi = Boolean(d.pi_ai);
    state.ttsServer = Boolean(d.voicebox);
    ensureComposioConnect(d);
  } catch { /* static browser-only mode */ }
}

async function loadMcpPill() {
  const pill = $("#pillMCP");
  if (!pill || typeof Mcp === "undefined") return;
  try {
    const d = await Mcp.status();
    pill.textContent = `● MCP: ${d.tool_count} tools`;
    pill.className = d.tool_count ? "pill ok" : "pill warn";
    pill.title = d.servers.length
      ? d.servers.map((s) => `${s.name}: ${s.enabled ? s.tools + " tools" : "off"}`).join(" · ")
      : "No MCP servers – add one in the MCP plugin, e.g. Composio";
  } catch { pill.textContent = "● MCP: ?"; pill.className = "pill warn"; }
}

/* ------------------------------------------------------------- Init */
document.addEventListener("DOMContentLoaded", async () => {
  tickClock(); setInterval(tickClock, 5000);
  await fetchHealth();
  const llmPill = $("#pillLLM");
  if (llmPill) {
    llmPill.textContent = "● AI: Groq" + (state.groqServerOk || state.groqKey ? "" : " (no key)");
    llmPill.className = state.groqServerOk || state.groqKey ? "pill ok" : "pill warn";
  }
  if (typeof voicePill === "function") {
    voicePill(!state.ttsOn ? "off" : (state.ttsUrl || state.ttsServer) ? "pi" : "browser");
  }
  drawOrb();
  await pollSystem(); setInterval(pollSystem, state.systemMs);
  loadMcpPill();
  loadWeather(); loadNews(); loadCrypto();
  $("#btnWeather").onclick = loadWeather;
  $("#btnCrypto").onclick = loadCrypto;
  $("#newsFeed").onchange = loadNews;
  document.querySelectorAll(".quick button").forEach((b) =>
    b.addEventListener("click", () => handleUserText(b.dataset.cmd)));
  initSettings();
  initChat();
  initPlugins();
  boot();
});
