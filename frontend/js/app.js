/* J.A.R.V.I.S – Core: Boot, Uhr, System, Wetter, News, Krypto, Orb */
const $ = (s) => document.querySelector(s);
const API = ""; // gleicher Host (Backend serviert Frontend)

const CITIES = {
  berlin: { lat: 52.52, lon: 13.405, name: "Berlin" },
  hamburg: { lat: 53.55, lon: 9.99, name: "Hamburg" },
  muenchen: { lat: 48.14, lon: 11.58, name: "München" },
  koeln: { lat: 50.94, lon: 6.96, name: "Köln" },
  giesen: { lat: 52.15, lon: 9.95, name: "Giesen" },
  wien: { lat: 48.2, lon: 16.37, name: "Wien" },
  zuerich: { lat: 47.37, lon: 8.54, name: "Zürich" },
};

const state = {
  city: localStorage.getItem("jarvis_city") || "berlin",
  voice: localStorage.getItem("jarvis_voice") || "de-DE-ConradNeural",
  ttsOn: localStorage.getItem("jarvis_tts") !== "0",
  autoSpeak: localStorage.getItem("jarvis_auto") !== "0",
  backend: false,
};

/* ------------------------------------------------------------- Boot */
async function boot() {
  const lines = [
    "Initialisiere Kernsysteme …",
    "Lade neuronale Sprachmodule (Edge TTS) …",
    "Verbinde Cloud-KI (Groq / Gemini – kostenlos) …",
    "Verbinde MCP-Server & Plugins …",
    "Alle Systeme einsatzbereit.",
  ];
  const fill = $("#bootFill"), line = $("#bootLine");
  for (let i = 0; i < lines.length; i++) {
    line.textContent = lines[i];
    fill.style.width = ((i + 1) / lines.length) * 100 + "%";
    await new Promise((r) => setTimeout(r, 320));
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
  // Weltuhr
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

async function pollSystem() {
  try {
    const r = await fetch(API + "/api/system");
    if (!r.ok) throw new Error("no backend");
    const d = await r.json();
    state.backend = true;
    $("#pillBackend").className = "pill ok"; $("#pillBackend").textContent = "● Backend online";
    drawGauge("gCpu", d.cpu_percent); $("#vCpu").textContent = d.cpu_percent + "%";
    drawGauge("gRam", d.ram_percent); $("#vRam").textContent = d.ram_used_gb + "/" + d.ram_total_gb + " GB";
    drawGauge("gDisk", d.disk_percent); $("#vDisk").textContent = d.disk_used_gb + "/" + d.disk_total_gb + " GB";
    const h = Math.floor(d.uptime_s / 3600), m = Math.floor((d.uptime_s % 3600) / 60);
    $("#vUptime").textContent = `${h} Std ${m} Min`;
    $("#vPlatform").textContent = d.platform + (d.cpu_temp_c ? ` · 🌡 ${d.cpu_temp_c}°C` : "");
  } catch {
    state.backend = false;
    $("#pillBackend").className = "pill warn"; $("#pillBackend").textContent = "● Demo (ohne Backend)";
    // Demo-Werte, damit die UI auch als statische Datei lebt
    const cpu = 8 + Math.random() * 18, ram = 32 + Math.random() * 12, disk = 54;
    drawGauge("gCpu", cpu); $("#vCpu").textContent = Math.round(cpu) + "%";
    drawGauge("gRam", ram); $("#vRam").textContent = Math.round(ram) + "%";
    drawGauge("gDisk", disk); $("#vDisk").textContent = disk + "%";
    $("#vUptime").textContent = "—"; $("#vPlatform").textContent = "Browser-Demo";
  }
}

/* ------------------------------------------------------------- Wetter */
async function loadWeather() {
  const c = CITIES[state.city] || CITIES.berlin;
  const body = $("#weatherBody");
  body.innerHTML = '<p class="muted">Lade Wetter …</p>';
  try {
    let d;
    if (state.backend) {
      const r = await fetch(`${API}/api/weather?lat=${c.lat}&lon=${c.lon}&name=${encodeURIComponent(c.name)}`);
      if (!r.ok) throw new Error("proxy fail");
      d = await r.json();
    } else {
      // Direkt über Open-Meteo (CORS-fähig), falls kein Backend läuft
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=Europe/Berlin`);
      const j = await r.json();
      const cur = j.current;
      d = { city: c.name, temp: cur.temperature_2m, feels: cur.apparent_temperature, humidity: cur.relative_humidity_2m, wind: cur.wind_speed_10m, label: "Wettercode " + cur.weather_code };
    }
    body.innerHTML = `
      <div style="font-size:2.2rem;font-weight:800;color:#fff">${d.temp}°C</div>
      <div>${d.label} in ${d.city}</div>
      <div class="kv"><span>Gefühlt</span><b>${d.feels}°C</b></div>
      <div class="kv"><span>Luftfeuchte</span><b>${d.humidity}%</b></div>
      <div class="kv"><span>Wind</span><b>${d.wind} km/h</b></div>
      <p class="muted small">Quelle: Open-Meteo (kostenlos, kein Key)</p>`;
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
    if (state.backend) {
      const r = await fetch(`${API}/api/news?feed=${feed}`);
      if (!r.ok) throw new Error("proxy fail");
      items = (await r.json()).items;
    } else {
      // Fallback: RSS direkt parsen (CORS kann scheitern – dann ehrliche Meldung)
      const feeds = {
        tagesschau: "https://www.tagesschau.de/xml/rss_2_0",
        bbc: "https://feeds.bbci.co.uk/news/rss.xml",
        heise: "https://www.heise.de/rss/heise.rdf",
        spiegel: "https://www.spiegel.de/schlagzeilen/topsstories.rss",
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
      `<div class="news-item"><a href="${n.link}" target="_blank" rel="noopener">${n.title}</a><small>${n.date}</small></div>`
    ).join("") || '<p class="muted">Keine Einträge.</p>';
  } catch {
    body.innerHTML = '<p class="muted">News-Feed nicht erreichbar. Backend starten für den Proxy.</p>';
  }
}

/* ------------------------------------------------------------- Krypto */
async function loadCrypto() {
  const body = $("#cryptoBody");
  try {
    const r = await fetch(`${API}/api/crypto`);
    if (!r.ok) throw new Error("no backend");
    const d = await r.json();
    const rows = [["bitcoin", "Bitcoin ₿"], ["ethereum", "Ethereum Ξ"], ["solana", "Solana ◎"]];
    body.innerHTML = rows.map(([id, name]) => {
      const v = d[id];
      if (!v) return "";
      const chg = v.eur_24h_change;
      const cls = chg >= 0 ? "up" : "down";
      return `<div class="crypto-row"><span>${name}</span><b>${Number(v.eur).toLocaleString("de-DE")} € <span class="${cls}">${chg >= 0 ? "▲" : "▼"} ${Math.abs(chg).toFixed(1)}%</span></b></div>`;
    }).join("") + '<p class="muted small">Quelle: CoinGecko (kostenlos)</p>';
  } catch {
    body.innerHTML = '<p class="muted">Krypto-Kurse brauchen das Backend (CoinGecko-Proxy).</p>';
  }
}

/* ------------------------------------------------------------- Orb */
const orb = $("#orb"), octx = orb.getContext("2d");
let orbMode = "idle", orbT = 0, orbFrame = 0;
function drawOrb() {
  orbFrame++;
  if (state.pi && orbFrame % 2 === 1) { requestAnimationFrame(drawOrb); return; } // Pi: ~30 FPS sparen
  orbT += 0.02;
  const w = orb.width, h = orb.height, cx = w / 2, cy = h / 2;
  octx.clearRect(0, 0, w, h);
  const speed = orbMode === "speak" ? 0.05 : orbMode === "listen" ? 0.035 : 0.012;
  const baseR = orbMode === "speak" ? 92 : 84;
  // Ringe
  for (let i = 0; i < 3; i++) {
    octx.beginPath();
    octx.strokeStyle = `rgba(0,212,255,${0.55 - i * 0.14})`;
    octx.lineWidth = 2;
    const r = baseR + i * 16 + Math.sin(orbT * 2 + i) * 3;
    octx.arc(cx, cy, r, orbT * (speed * 40 + i * 0.4), orbT * (speed * 40 + i * 0.4) + Math.PI * 1.5);
    octx.stroke();
  }
  // Kern
  const pulse = 1 + Math.sin(orbT * (orbMode === "speak" ? 6 : 2)) * (orbMode === "speak" ? 0.08 : 0.03);
  const g = octx.createRadialGradient(cx, cy, 5, cx, cy, 70 * pulse);
  g.addColorStop(0, "rgba(180,245,255,.95)");
  g.addColorStop(0.4, "rgba(0,212,255,.75)");
  g.addColorStop(1, "rgba(0,80,160,.05)");
  octx.fillStyle = g;
  octx.beginPath(); octx.arc(cx, cy, 70 * pulse, 0, Math.PI * 2); octx.fill();
  // Partikel (Pi: weniger)
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

/* ------------------------------------------------- Backend / Pi / MCP */
async function fetchHealth() {
  try {
    const r = await fetch(API + "/api/health");
    if (!r.ok) throw new Error("no backend");
    const d = await r.json();
    state.backend = true;
    if (d.pi_mode) {
      state.pi = true;
      state.systemMs = 7000; // Pi 3B+ schonen: seltener pollen
      document.body.classList.add("pi");
      const pill = $("#pillBackend");
      if (pill) pill.title = "Raspberry Pi erkannt: " + (d.pi_model || d.machine || "");
    }
  } catch { /* Demo-Modus ohne Backend */ }
}

async function loadMcpPill() {
  const pill = $("#pillMCP");
  if (!pill) return;
  if (!state.backend) { pill.textContent = "● MCP: Demo"; pill.className = "pill warn"; return; }
  try {
    const r = await fetch(API + "/api/mcp/status");
    const d = await r.json();
    if (!d.enabled) { pill.textContent = "● MCP: aus"; pill.className = "pill warn"; return; }
    pill.textContent = `● MCP: ${d.tool_count} Tools`;
    pill.className = d.tool_count ? "pill ok" : "pill warn";
    pill.title = d.servers.map((s) => `${s.name}: ${s.enabled ? s.tools + " Tools" : "inaktiv"}`).join(" · ");
  } catch { pill.textContent = "● MCP: ?"; pill.className = "pill warn"; }
}

/* ------------------------------------------------------------- Init */
document.addEventListener("DOMContentLoaded", async () => {
  tickClock(); setInterval(tickClock, 1000);
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
