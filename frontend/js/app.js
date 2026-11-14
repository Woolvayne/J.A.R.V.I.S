/* J.A.R.V.I.S – Core (Vercel/Browser-Edition): Boot, Uhr, Geräte-Infos,
   Wetter, News, Krypto, Orb. Kein eigenes Backend nötig:
   - Vercel-Functions (/api/*) werden genutzt, wenn vorhanden (state.functions)
   - Wetter/Krypto laufen direkt aus dem Browser (CORS-fähige Gratis-APIs)
   - Optionales Pi-Backend nur noch für echte Pi-Systemwerte (Einstellungen) */
const $ = (s) => document.querySelector(s);
const API = ""; // gleiche Herkunft (Vercel serviert Frontend + /api)

const CITIES = {
  berlin: { lat: 52.52, lon: 13.405, name: "Berlin" },
  hamburg: { lat: 53.55, lon: 9.99, name: "Hamburg" },
  muenchen: { lat: 48.14, lon: 11.58, name: "München" },
  koeln: { lat: 50.94, lon: 6.96, name: "Köln" },
  giesen: { lat: 52.15, lon: 9.95, name: "Giesen" },
  wien: { lat: 48.2, lon: 16.37, name: "Wien" },
  zuerich: { lat: 47.37, lon: 8.54, name: "Zürich" },
};

const SESSION_START = Date.now();

const state = {
  city: localStorage.getItem("jarvis_city") || "berlin",
  voice: localStorage.getItem("jarvis_voice") || "",
  ttsOn: localStorage.getItem("jarvis_tts") !== "0",
  autoSpeak: localStorage.getItem("jarvis_auto") !== "0",
  // Vercel-Modus
  functions: false,           // /api/health erreichbar (Vercel-Functions aktiv)
  llmEnv: {},                 // welche Keys serverseitig gesetzt sind (nur bool)
  // KI (Browser)
  groqKey: localStorage.getItem("jarvis_groq_key") || "",
  llmOrder: localStorage.getItem("jarvis_llm_order") || "groq,ollama,pollinations",
  ollamaUrl: (localStorage.getItem("jarvis_ollama_url") || "http://localhost:11434").replace(/\/$/, ""),
  ollamaModel: localStorage.getItem("jarvis_ollama_model") || "qwen2.5:0.5b",
  ollamaOk: null,             // Cache der Ollama-Erreichbarkeit
  ollamaOkAt: 0,
  // Optionales Pi-Backend (Edge TTS + echte Pi-Werte), z. B. http://raspberrypi.local:8000
  backendUrl: (localStorage.getItem("jarvis_backend_url") || "").replace(/\/$/, ""),
  // Pi-"Voicebox" (Piper-TTS auf dem Pi, öffentlich per Cloudflare-Tunnel-URL,
  // NICHT nur LAN): JARVIS holt dort WAV-Audio. Hat Vorrang vor Browser-Stimme.
  ttsUrl: (localStorage.getItem("jarvis_tts_url") || "").replace(/\/$/, ""),
  ttsToken: localStorage.getItem("jarvis_tts_token") || "",
  ttsVoice: localStorage.getItem("jarvis_tts_voice") || "de_DE-thorsten-medium",
  // Anzeige
  pi: localStorage.getItem("jarvis_pi") === "1",  // Sparmodus manuell (für Pi-Browser)
  systemMs: 7000,
};

/* ------------------------------------------------------------- Boot */
async function boot() {
  const lines = [
    "Initialisiere Kernsysteme …",
    "Lade Sprachmodule (Browser-Stimme) …",
    "Verbinde KI (Groq / Ollama lokal) …",
    "Verbinde MCP-Server (z. B. Composio) & Plugins …",
    "Alle Systeme einsatzbereit.",
  ];
  const fill = $("#bootFill"), line = $("#bootLine");
  for (let i = 0; i < lines.length; i++) {
    line.textContent = lines[i];
    fill.style.width = ((i + 1) / lines.length) * 100 + "%";
    await new Promise((r) => setTimeout(r, 300));
  }
  $("#boot").classList.add("done");
  setTimeout(() => $("#boot").remove(), 800);
  if (state.autoSpeak) speak("J.A.R.V.I.S online, Sir. Alle Systeme einsatzbereit. Wie kann ich helfen?");
}

/* ------------------------------------------------------------- Uhr */
function tickClock() {
  const now = new Date();
  $("#clock").textContent = now.toLocaleTimeString("de-DE");
  $("#dateLine").textContent = now.toLocaleDateString("de-DE", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const zones = [
    ["Berlin", "Europe/Berlin"], ["London", "Europe/London"],
    ["New York", "America/New_York"], ["Tokio", "Asia/Tokyo"],
  ];
  $("#worldClock").innerHTML = zones.map(([n, z]) => {
    const t = new Date().toLocaleTimeString("de-DE", { timeZone: z, hour: "2-digit", minute: "2-digit" });
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

let _deviceMode = null; // "pi" | "device"
async function pollSystem() {
  // 1) Optionales Pi-Backend gesetzt? Dann echte Pi-Werte anzeigen.
  if (state.backendUrl) {
    try {
      const r = await fetch(state.backendUrl + "/api/system");
      if (!r.ok) throw new Error("pi backend");
      const d = await r.json();
      if (_deviceMode !== "pi") {
        _deviceMode = "pi";
        _gaugeLabel("gCpu", "CPU"); _gaugeLabel("gRam", "RAM"); _gaugeLabel("gDisk", "Disk");
        $("#cardSystem").querySelector("h2").lastChild.textContent = " System (Pi)";
      }
      drawGauge("gCpu", d.cpu_percent); $("#vCpu").textContent = Math.round(d.cpu_percent) + "%";
      drawGauge("gRam", d.ram_percent); $("#vRam").textContent = d.ram_used_gb + "/" + d.ram_total_gb + " GB";
      drawGauge("gDisk", d.disk_percent); $("#vDisk").textContent = d.disk_used_gb + "/" + d.disk_total_gb + " GB";
      const h = Math.floor(d.uptime_s / 3600), m = Math.floor((d.uptime_s % 3600) / 60);
      $("#vUptime").textContent = `${h} Std ${m} Min`;
      $("#vPlatform").textContent = "Pi" + (d.cpu_temp_c ? ` · 🌡 ${d.cpu_temp_c}°C` : "");
      return;
    } catch { /* fällt auf Geräte-Infos zurück */ }
  }
  // 2) Browser-Geräteinfos (ohne Backend ehrlich das, was der Browser hergibt)
  if (_deviceMode !== "device") {
    _deviceMode = "device";
    _gaugeLabel("gCpu", "KERNE"); _gaugeLabel("gRam", "RAM"); _gaugeLabel("gDisk", "SPEICHER");
    $("#cardSystem").querySelector("h2").lastChild.textContent = " Gerät";
  }
  const cores = navigator.hardwareConcurrency || 4;
  drawGauge("gCpu", Math.min(100, (cores / 8) * 100));
  $("#vCpu").textContent = cores + " Kerne";
  if (navigator.deviceMemory) {
    drawGauge("gRam", Math.min(100, (navigator.deviceMemory / 16) * 100));
    $("#vRam").textContent = "ca. " + navigator.deviceMemory + " GB";
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
  $("#vUptime").textContent = `${Math.floor(up / 3600)} Std ${Math.floor((up % 3600) / 60)} Min`;
  $("#vPlatform").textContent = (navigator.userAgentData?.platform || navigator.platform || "Browser") +
    (navigator.onLine ? " · online" : " · offline");
  const pill = $("#pillBackend");
  if (pill) {
    pill.className = state.functions ? "pill ok" : "pill warn";
    pill.textContent = state.functions ? "● Vercel online" : "● Nur Browser";
  }
}

/* ------------------------------------------------------------- Wetter */
const WMO_LABELS = { 0: "Klar ☀️", 1: "Überwiegend klar", 2: "Teils bewölkt", 3: "Bedeckt",
  45: "Nebel", 48: "Reifnebel", 51: "Leichter Niesel", 53: "Niesel", 55: "Niesel",
  61: "Leichter Regen", 63: "Regen", 65: "Starker Regen", 66: "Gefr. Regen", 67: "Gefr. Regen",
  71: "Leichter Schnee", 73: "Schnee", 75: "Starker Schnee", 80: "Schauer", 81: "Schauer",
  82: "Starke Schauer", 95: "Gewitter", 96: "Gewitter + Hagel", 99: "Gewitter + Hagel" };

async function loadWeather() {
  const c = CITIES[state.city] || CITIES.berlin;
  const body = $("#weatherBody");
  body.innerHTML = '<p class="muted">Lade Wetter …</p>';
  try {
    // Direkt über Open-Meteo aus dem Browser (CORS-fähig, kein Key, kein Backend)
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=Europe/Berlin`);
    if (!r.ok) throw new Error("wetter");
    const cur = (await r.json()).current;
    body.innerHTML = `
      <div style="font-size:2.2rem;font-weight:800;color:#fff">${cur.temperature_2m}°C</div>
      <div>${WMO_LABELS[cur.weather_code] || "Wettercode " + cur.weather_code} in ${c.name}</div>
      <div class="kv"><span>Gefühlt</span><b>${cur.apparent_temperature}°C</b></div>
      <div class="kv"><span>Luftfeuchte</span><b>${cur.relative_humidity_2m}%</b></div>
      <div class="kv"><span>Wind</span><b>${cur.wind_speed_10m} km/h</b></div>
      <p class="muted small">Quelle: Open-Meteo (kostenlos, direkt aus dem Browser)</p>`;
  } catch {
    body.innerHTML = '<p class="muted">Wetter derzeit nicht erreichbar (Netzwerk?).</p>';
  }
}

/* ------------------------------------------------------------- News */
async function loadNews() {
  const feed = $("#newsFeed").value;
  const body = $("#newsBody");
  body.innerHTML = '<p class="muted">Lade News …</p>';
  try {
    let items;
    if (state.functions) {
      const r = await fetch(`${API}/api/news?feed=${feed}`);
      if (!r.ok) throw new Error("proxy fail");
      items = (await r.json()).items;
    } else {
      const feeds = {
        tagesschau: "https://www.tagesschau.de/xml/rss_2_0",
        bbc: "https://feeds.bbci.co.uk/news/rss.xml",
        heise: "https://www.heise.de/rss/heise.rdf",
        spiegel: "https://www.spiegel.de/schlagzeilen/tops/index.rss",
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
    ).join("") || '<p class="muted">Keine Einträge.</p>';
  } catch {
    body.innerHTML = '<p class="muted">News-Feed nicht erreichbar. Auf Vercel übernimmt /api/news den Abruf.</p>';
  }
}

/* ------------------------------------------------------------- Krypto */
async function loadCrypto() {
  const body = $("#cryptoBody");
  try {
    // CoinGecko direkt aus dem Browser (CORS-fähig, kein Key)
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=eur&include_24hr_change=true");
    if (!r.ok) throw new Error("coingecko");
    const d = await r.json();
    const rows = [["bitcoin", "Bitcoin ₿"], ["ethereum", "Ethereum Ξ"], ["solana", "Solana ◎"]];
    body.innerHTML = rows.map(([id, name]) => {
      const v = d[id];
      if (!v) return "";
      const chg = v.eur_24h_change;
      const cls = chg >= 0 ? "up" : "down";
      return `<div class="crypto-row"><span>${name}</span><b>${Number(v.eur).toLocaleString("de-DE")} € <span class="${cls}">${chg >= 0 ? "▲" : "▼"} ${Math.abs(chg).toFixed(1)}%</span></b></div>`;
    }).join("") + '<p class="muted small">Quelle: CoinGecko (kostenlos, direkt)</p>';
  } catch {
    body.innerHTML = '<p class="muted">Krypto-Kurse nicht erreichbar (Netzwerk oder Gratis-Ratenlimit).</p>';
  }
}

/* ------------------------------------------------------------- Orb */
const orb = $("#orb"), octx = orb.getContext("2d");
let orbMode = "idle", orbT = 0, orbFrame = 0;
function drawOrb() {
  if (document.hidden) { requestAnimationFrame(drawOrb); return; } // Safari/iPad: Akku sparen, wenn Tab unsichtbar
  orbFrame++;
  if (state.pi && orbFrame % 2 === 1) { requestAnimationFrame(drawOrb); return; } // Sparmodus: ~30 FPS
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

/* ------------------------------------------- Vercel-Erkennung + MCP-Pille */
// Ist der Composio-Connect-Key in der Vercel-Env hinterlegt, legt JARVIS den
// MCP-Server automatisch an (Header bleibt leer – /api/mcp trägt den Key
// serverseitig ein). Ein Platzhalter-Key im Browser wird dabei bereinigt.
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
      if (!vals.length || vals.some((v) => v.includes("DEIN"))) {
        if (vals.length) { found.headers = {}; changed = true; }
      }
    } else {
      list.push({ name: "composio-connect", url, headers: {}, via: "proxy", enabled: true });
      changed = true;
    }
    if (changed) Mcp.saveServers(list);
  } catch { /* MCP bleibt manuell konfigurierbar */ }
}

async function fetchHealth() {
  if (state.pi) { document.body.classList.add("pi"); }
  try {
    const r = await fetch(API + "/api/health");
    if (!r.ok) throw new Error("no functions");
    const d = await r.json();
    state.functions = true;
    state.llmEnv = d.llm_env || {};
    ensureComposioConnect(d);
  } catch { /* reiner Browser-Modus (statisch) */ }
}

async function loadMcpPill() {
  const pill = $("#pillMCP");
  if (!pill || typeof Mcp === "undefined") return;
  try {
    const d = await Mcp.status();
    pill.textContent = `● MCP: ${d.tool_count} Tools`;
    pill.className = d.tool_count ? "pill ok" : "pill warn";
    pill.title = d.servers.length
      ? d.servers.map((s) => `${s.name}: ${s.enabled ? s.tools + " Tools" : "inaktiv"}`).join(" · ")
      : "Keine MCP-Server – im MCP-Plugin (🔌) hinzufügen, z. B. Composio";
  } catch { pill.textContent = "● MCP: ?"; pill.className = "pill warn"; }
}

/* ------------------------------------------------------------- Init */
document.addEventListener("DOMContentLoaded", async () => {
  tickClock(); setInterval(tickClock, 5000);
  await fetchHealth();
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
