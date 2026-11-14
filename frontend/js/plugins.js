/* J.A.R.V.I.S – Plugin system
   Each plugin: { id, icon (monogram), name, desc, render(body, opts) }
   Add new plugins to PLUGINS below – see PLUGINS.md in the project root. */
/* Note: $, API and state are defined centrally in app.js (loaded first). */

const PLUGINS = [
  { id: "weather", icon: "WE", name: "Weather", desc: "Live weather via Open-Meteo (no key)",
    render(b) { b.innerHTML = `<p class="muted">Weather is shown live on the left. Change the location in Settings.</p><button class="btn" onclick="loadWeather();closePlugin()">Refresh</button>`; } },

  { id: "system", icon: "SY", name: "System", desc: "Device information from the browser",
    render(b) { b.innerHTML = `<p class="muted">On the left you see what this device reports: cores, memory and storage, plus session uptime and platform.</p>`; } },

  { id: "mcp", icon: "MC", name: "MCP", desc: "Connect real remote MCP servers (e.g. Composio) right in the browser",
    render(b) {
      b.innerHTML = `
        <p class="muted">Connect <b>real remote MCP servers</b> (Streamable HTTP) – for example <b>Composio</b>
        (Gmail, Drive, Sheets …). Groq uses their tools automatically.
        Server data stays in this browser only. Full guide: <code>MCP.md</code>.</p>
        <details class="guide"><summary>Composio: find your MCP URL (about 2 minutes)</summary>
          <ol class="steps">
            <li>Sign in at <b>composio.dev</b> (a free account is enough).</li>
            <li>Create an <b>MCP server / Tool Router</b> (menu "MCP" or "Tool Router" – the label varies slightly).</li>
            <li>Pick your <b>toolkits</b> (e.g. Gmail, Google Drive, Sheets) and connect your accounts via OAuth ("Connect").</li>
            <li>Composio then shows the <b>MCP URL</b> – copy it. It looks like:<br>
              <code>https://backend.composio.dev/v3/mcp/YOUR_SERVER_ID?user_id=YOUR_USER_ID</code></li>
            <li>Your <b>API key</b> (<code>ak_…</code>) lives in Composio under <b>Settings → API Keys</b>.</li>
            <li>Tap <b>"+ Composio template"</b> below, paste the URL and put your key into the header field
              (<code>{"x-api-key": "ak_…"}</code>), then <b>"Save &amp; connect"</b>. The status above will show the tool count.</li>
          </ol>
          <p class="muted small" style="padding:0 12px 10px">Alternative "Composio Connect": URL <code>https://connect.composio.dev/mcp</code>, header <code>{"x-consumer-api-key": "ck_…"}</code> (a different key type). <b>In this deployment the Connect key is already stored securely in the Vercel env</b> – tap <b>"+ Composio Connect"</b>, leave the header as <code>{}</code> and save; the server is even created automatically on start and the proxy injects the key.</p>
        </details>
        <details class="guide"><summary>Adding any MCP server – how it works</summary>
          <ol class="steps">
            <li><b>Concepts:</b> J.A.R.V.I.S is the <b>MCP client (host)</b> – it is already built in. "Adding" means registering an <b>MCP server</b> whose tools Groq may then use. No separate client to install.</li>
            <li>Tap <b>"+ Custom server"</b> (or use the Composio template above).</li>
            <li>Give it a <b>name</b> (e.g. <code>composio</code>) and paste the provider's <b>MCP URL</b> (must be <code>https://</code>, Streamable HTTP).</li>
            <li>Add <b>headers</b> as JSON if the provider needs a key, e.g. <code>{"x-api-key": "ak_…"}</code> or <code>{"Authorization": "Bearer …"}</code> – otherwise <code>{}</code>.</li>
            <li>Keep the route on <b>"Vercel proxy"</b> (recommended – avoids CORS). Only servers that allow browser access themselves work "direct".</li>
            <li><b>"Save &amp; connect"</b> – the status above shows the number of tools found. Try one directly under "Test a tool".</li>
            <li>Then simply ask in the <b>chat</b> ("Show my latest emails") – Groq calls the MCP tools automatically. Toggle servers with the "on" checkbox, edit or delete them on the right.</li>
            <li class="muted">Limit: a browser cannot start local stdio servers (<code>npx …</code>/<code>uvx …</code>) – remote HTTP servers only.</li>
          </ol>
        </details>
        <div id="mcpServers"><p class="muted">Connecting …</p></div>
        <div class="row"><button class="btn" id="mcpReload">Reconnect</button>
        <button class="btn ghost" id="mcpPresetComposio">+ Composio template</button>
        <button class="btn ghost" id="mcpPresetConnect">+ Composio Connect</button>
        <button class="btn ghost" id="mcpPresetCustom">+ Custom server</button></div>
        <div id="mcpEdit"></div>
        <h4 style="margin:14px 0 6px">Test a tool</h4>
        <div class="row"><select id="mcpToolSel" style="flex:1;background:#04101f;color:#fff;border:1px solid var(--line);border-radius:10px;padding:10px"><option value="">– Choose a tool –</option></select></div>
        <div class="row"><textarea id="mcpArgs" rows="3" style="flex:1;background:#04101f;color:#fff;border:1px solid var(--line);border-radius:10px;padding:10px" placeholder='Arguments as JSON, e.g. {}'></textarea></div>
        <div class="row"><button class="btn" id="mcpCall">Run tool</button></div>
        <div class="result" id="mcpOut">Ready. Afterwards just ask in the chat – e.g. "Show my latest emails" (with Composio Gmail).</div>`;

      const draw = async (force) => {
        $("#mcpServers").innerHTML = '<p class="muted">Connecting …</p>';
        try {
          if (force) await Mcp.refresh();
          const d = await Mcp.status();
          const list = Mcp.loadServers();
          $("#mcpServers").innerHTML =
            (list.length ? list.map((s, i) => {
              const st = d.servers.find((x) => x.name === s.name) || {};
              return `<div class="kv"><span>${st.connected ? "online" : s.enabled ? "offline" : "off"} – <b>${escapeHtml(s.name)}</b>
                <small class="muted">${escapeHtml(s.url || "")}${st.error ? " – " + escapeHtml(st.error) : ""}</small></span>
                <span><label class="muted small"><input type="checkbox" data-mcp-toggle="${i}" ${s.enabled ? "checked" : ""}> on</label>
                <button class="btn ghost" data-mcp-edit="${i}" aria-label="Edit">Edit</button>
                <button class="btn ghost" data-mcp-del="${i}" aria-label="Delete">Delete</button></span></div>`;
            }).join("") : '<p class="muted">No servers yet. Create a Composio template below.</p>') +
            `<p class="muted small">Total: ${d.tool_count} tools available</p>`;
          $("#mcpToolSel").innerHTML = '<option value="">– Choose a tool –</option>' +
            d.tools.map((t) => `<option value="${escapeHtml(t.name)}" title="${escapeHtml(t.description)}">${escapeHtml(t.name)}</option>`).join("");
          b.querySelectorAll("[data-mcp-toggle]").forEach((el) => el.onchange = () => {
            const l = Mcp.loadServers(); l[+el.dataset.mcpToggle].enabled = el.checked; Mcp.saveServers(l); draw(true);
          });
          b.querySelectorAll("[data-mcp-del]").forEach((el) => el.onclick = () => {
            const l = Mcp.loadServers(); l.splice(+el.dataset.mcpDel, 1); Mcp.saveServers(l); draw(true);
          });
          b.querySelectorAll("[data-mcp-edit]").forEach((el) => el.onclick = () => editForm(+el.dataset.mcpEdit));
          if (typeof loadMcpPill === "function") loadMcpPill();
        } catch (e) {
          $("#mcpServers").innerHTML = '<p class="muted">MCP client error: ' + escapeHtml(String(e.message || e)) + "</p>";
        }
      };

      const editForm = (idx, preset) => {
        const l = Mcp.loadServers();
        const s = preset || l[idx] || { name: "", url: "", headers: {}, via: "proxy", enabled: true };
        $("#mcpEdit").innerHTML = `
          <div class="row"><input id="meName" placeholder="Name (e.g. composio)" value="${escapeHtml(s.name || "")}">
          <select id="meVia" style="background:#04101f;color:#fff;border:1px solid var(--line);border-radius:10px;padding:10px">
            <option value="proxy" ${s.via === "proxy" ? "selected" : ""}>Route: Vercel proxy (recommended)</option>
            <option value="auto" ${s.via === "auto" ? "selected" : ""}>Route: auto (direct, then proxy)</option>
            <option value="direct" ${s.via === "direct" ? "selected" : ""}>Route: direct (CORS only)</option>
          </select></div>
          <div class="row"><input id="meUrl" placeholder="MCP URL (https://…)" value="${escapeHtml(s.url || "")}"></div>
          <div class="row"><textarea id="meHeaders" rows="2" style="flex:1;background:#04101f;color:#fff;border:1px solid var(--line);border-radius:10px;padding:10px" placeholder='Headers as JSON, e.g. {"x-api-key":"ak_…"}'>${escapeHtml(JSON.stringify(s.headers || {}))}</textarea></div>
          ${preset && preset.hint ? `<p class="muted small">${escapeHtml(preset.hint)}</p>` : ""}
          <div class="row"><button class="btn" id="meSave">Save &amp; connect</button>
          <button class="btn ghost" id="meCancel">Cancel</button></div>`;
        $("#meCancel").onclick = () => ($("#mcpEdit").innerHTML = "");
        $("#meSave").onclick = () => {
          let headers = {};
          try { headers = JSON.parse($("#meHeaders").value.trim() || "{}"); }
          catch { $("#mcpOut").textContent = "Headers are not valid JSON."; return; }
          const entry = {
            name: ($("#meName").value.trim() || "server").replace(/\s+/g, "-"),
            url: $("#meUrl").value.trim(),
            headers, via: $("#meVia").value, enabled: true,
          };
          if (!entry.url) { $("#mcpOut").textContent = "Please enter an MCP URL."; return; }
          const list2 = Mcp.loadServers();
          if (idx != null && !preset) list2[idx] = entry; else list2.push(entry);
          Mcp.saveServers(list2);
          $("#mcpEdit").innerHTML = "";
          draw(true);
        };
      };

      $("#mcpReload").onclick = () => draw(true);
      $("#mcpPresetComposio").onclick = () => editForm(null, { ...Mcp.presets.composio });
      $("#mcpPresetConnect").onclick = () => editForm(null, { ...Mcp.presets.composioConnect });
      $("#mcpPresetCustom").onclick = () => editForm(null, { name: "", url: "https://", headers: {}, via: "proxy", enabled: true });
      $("#mcpCall").onclick = async () => {
        const name = $("#mcpToolSel").value;
        if (!name) { $("#mcpOut").textContent = "Please choose a tool first, Sir."; return; }
        let args = {};
        try { args = JSON.parse($("#mcpArgs").value.trim() || "{}"); }
        catch { $("#mcpOut").textContent = "Arguments are not valid JSON."; return; }
        $("#mcpOut").textContent = "Running " + name + " …";
        $("#mcpOut").textContent = await Mcp.callTool(name, args);
      };
      draw(false);
    } },

  { id: "notes", icon: "NO", name: "Notes", desc: "Quick notes (stored locally)",
    render(b) {
      b.innerHTML = `<div class="row"><input id="noteIn" placeholder="New note …"><button class="btn" id="noteAdd">Add</button></div><div id="noteList"></div>`;
      const key = "jarvis_notes";
      const get = () => JSON.parse(localStorage.getItem(key) || "[]");
      const draw = () => {
        $("#noteList").innerHTML = get().map((n, i) =>
          `<div class="todo-item"><span style="flex:1">${escapeHtml(n)}</span><button class="btn ghost" data-del="${i}">Delete</button></div>`).join("") || '<p class="muted">No notes yet.</p>';
        b.querySelectorAll("[data-del]").forEach((x) => x.onclick = () => { const a = get(); a.splice(+x.dataset.del, 1); localStorage.setItem(key, JSON.stringify(a)); draw(); });
      };
      $("#noteAdd").onclick = () => { const v = $("#noteIn").value.trim(); if (!v) return; const a = get(); a.unshift(v); localStorage.setItem(key, JSON.stringify(a)); $("#noteIn").value = ""; draw(); };
      draw();
    } },

  { id: "todo", icon: "TO", name: "Tasks", desc: "Task list with checkboxes",
    render(b) {
      b.innerHTML = `<div class="row"><input id="todoIn" placeholder="New task …"><button class="btn" id="todoAdd">Add</button></div><div id="todoList"></div>`;
      const key = "jarvis_todos";
      const get = () => JSON.parse(localStorage.getItem(key) || "[]");
      const draw = () => {
        $("#todoList").innerHTML = get().map((t, i) =>
          `<div class="todo-item"><input type="checkbox" data-tog="${i}" ${t.done ? "checked" : ""}><span style="flex:1;${t.done ? "text-decoration:line-through;color:var(--muted)" : ""}">${escapeHtml(t.text)}</span><button class="btn ghost" data-del="${i}">Delete</button></div>`).join("") || '<p class="muted">No tasks. Most productive, Sir.</p>';
        b.querySelectorAll("[data-tog]").forEach((x) => x.onchange = () => { const a = get(); a[+x.dataset.tog].done = x.checked; localStorage.setItem(key, JSON.stringify(a)); draw(); });
        b.querySelectorAll("[data-del]").forEach((x) => x.onclick = () => { const a = get(); a.splice(+x.dataset.del, 1); localStorage.setItem(key, JSON.stringify(a)); draw(); });
      };
      $("#todoAdd").onclick = () => { const v = $("#todoIn").value.trim(); if (!v) return; const a = get(); a.push({ text: v, done: false }); localStorage.setItem(key, JSON.stringify(a)); $("#todoIn").value = ""; draw(); };
      draw();
    } },

  { id: "calc", icon: "CA", name: "Calculator", desc: "Pocket calculator",
    render(b) {
      b.innerHTML = `<div class="row"><input id="calcIn" placeholder="e.g. 12*8+5"><button class="btn" id="calcGo">=</button></div><div class="result" id="calcOut">Ready.</div>`;
      const go = () => {
        try {
          const expr = $("#calcIn").value.replace(/,/g, ".").replace(/[^0-9+\-*/(). ]/g, "");
          const v = Function('"use strict";return (' + expr + ")")();
          $("#calcOut").textContent = expr + " = " + (Math.round(v * 10000) / 10000);
        } catch { $("#calcOut").textContent = "Invalid expression, Sir."; }
      };
      $("#calcGo").onclick = go;
      $("#calcIn").onkeydown = (e) => e.key === "Enter" && go();
    } },

  { id: "timer", icon: "TI", name: "Timer", desc: "Countdown with a spoken signal",
    render(b, opts = {}) {
      b.innerHTML = `<div class="timer-big" id="timerBig">05:00</div>
        <div class="row"><input id="timerMin" type="number" min="1" value="5" placeholder="Minutes"><button class="btn" id="timerStart">Start</button><button class="btn ghost" id="timerStop">Stop</button></div>`;
      let left = opts.seconds || 300, iv = null;
      const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      const draw = () => ($("#timerBig").textContent = fmt(left));
      const stop = () => { clearInterval(iv); iv = null; };
      $("#timerStart").onclick = () => {
        stop(); left = parseInt($("#timerMin").value || "5", 10) * 60; draw();
        iv = setInterval(() => { left--; draw(); if (left <= 0) { stop(); speak("Sir, your time is up."); addMsg("jarvis", "Timer finished, Sir.", "timer"); } }, 1000);
      };
      $("#timerStop").onclick = stop;
      draw();
    } },

  { id: "stopwatch", icon: "SW", name: "Stopwatch", desc: "Stopwatch with laps",
    render(b) {
      b.innerHTML = `<div class="timer-big" id="swBig">00:00.0</div><div class="row"><button class="btn" id="swToggle">Start</button><button class="btn ghost" id="swLap">Lap</button><button class="btn ghost" id="swReset">Reset</button></div><div id="swLaps"></div>`;
      let t0 = 0, elapsed = 0, iv = null;
      const fmt = (ms) => { const s = ms / 1000; return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}.${Math.floor((ms % 1000) / 100)}`; };
      const draw = () => ($("#swBig").textContent = fmt(elapsed + (t0 ? Date.now() - t0 : 0)));
      $("#swToggle").onclick = (e) => {
        if (iv) { clearInterval(iv); iv = null; elapsed += Date.now() - t0; t0 = 0; e.target.textContent = "Start"; }
        else { t0 = Date.now(); iv = setInterval(draw, 50); e.target.textContent = "Pause"; }
      };
      $("#swLap").onclick = () => { const d = document.createElement("div"); d.className = "kv"; d.innerHTML = `<span>Lap</span><b>${fmt(elapsed + (t0 ? Date.now() - t0 : 0))}</b>`; $("#swLaps").prepend(d); };
      $("#swReset").onclick = () => { clearInterval(iv); iv = null; t0 = 0; elapsed = 0; $("#swLaps").innerHTML = ""; draw(); };
      draw();
    } },

  { id: "search", icon: "SE", name: "Search", desc: "Web search (DuckDuckGo, no key)",
    render(b, opts = {}) {
      b.innerHTML = `<div class="row"><input id="sQ" placeholder="Search term …" value="${escapeHtml(opts.q || "")}"><button class="btn" id="sGo">Search</button></div><div class="result" id="sOut">Ready.</div>`;
      const go = async () => {
        const q = $("#sQ").value.trim(); if (!q) return;
        $("#sOut").textContent = "Searching …";
        try {
          const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1`);
          const d = await r.json();
          const abs = d.AbstractText || "No direct hit. I will open the search in a new tab.";
          $("#sOut").innerHTML = `${escapeHtml(abs)}<br><br><a href="https://duckduckgo.com/?q=${encodeURIComponent(q)}" target="_blank" rel="noopener">Continue on DuckDuckGo</a>`;
        } catch { $("#sOut").innerHTML = `<a href="https://duckduckgo.com/?q=${encodeURIComponent(q)}" target="_blank" rel="noopener">Search on DuckDuckGo</a>`; }
      };
      $("#sGo").onclick = go;
      $("#sQ").onkeydown = (e) => e.key === "Enter" && go();
      if (opts.q) go();
    } },

  { id: "wiki", icon: "WI", name: "Wikipedia", desc: "Article search (free)",
    render(b) {
      b.innerHTML = `<div class="row"><input id="wQ" placeholder="Term …"><button class="btn" id="wGo">Search</button></div><div class="result" id="wOut">Ready.</div>`;
      const go = async () => {
        const q = $("#wQ").value.trim(); if (!q) return;
        $("#wOut").textContent = "Loading …";
        try {
          const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q.replace(/ /g, "_"))}`);
          if (!r.ok) throw new Error("nf");
          const d = await r.json();
          $("#wOut").innerHTML = `<b>${escapeHtml(d.title)}</b><br>${escapeHtml(d.extract || "")}<br><br><a href="${d.content_urls?.desktop?.page || "#"}" target="_blank" rel="noopener">Open the Wikipedia article</a>`;
        } catch { $("#wOut").textContent = "Article not found, Sir. Try another term."; }
      };
      $("#wGo").onclick = go;
      $("#wQ").onkeydown = (e) => e.key === "Enter" && go();
    } },

  { id: "news", icon: "NE", name: "News", desc: "RSS headlines (Vercel function / direct)",
    render(b) { b.innerHTML = `<p class="muted">The latest headlines are in the news panel on the right. Pick the feed at its top.</p><button class="btn" onclick="loadNews();closePlugin()">Reload</button>`; } },

  { id: "crypto", icon: "CR", name: "Crypto", desc: "BTC / ETH / SOL (CoinGecko)",
    render(b) { b.innerHTML = `<p class="muted">Prices are in the crypto panel on the right (CoinGecko, direct from the browser).</p><button class="btn" onclick="loadCrypto();closePlugin()">Reload</button>`; } },

  { id: "github", icon: "GH", name: "GitHub", desc: "Profiles and repos (public API)",
    render(b) {
      b.innerHTML = `<div class="row"><input id="gU" placeholder="GitHub username …"><button class="btn" id="gGo">Load</button></div><div class="result" id="gOut">Ready.</div>`;
      const go = async () => {
        const u = $("#gU").value.trim(); if (!u) return;
        $("#gOut").textContent = "Loading …";
        try {
          const [ur, rr] = await Promise.all([
            fetch(`https://api.github.com/users/${encodeURIComponent(u)}`),
            fetch(`https://api.github.com/users/${encodeURIComponent(u)}/repos?sort=updated&per_page=5`),
          ]);
          const user = await ur.json(), repos = await rr.json();
          if (user.message) throw new Error(user.message);
          $("#gOut").innerHTML = `<b>${escapeHtml(user.name || user.login)}</b> · ${user.public_repos} repos · ${user.followers} followers<br>${escapeHtml(user.bio || "")}<br><br>` +
            (Array.isArray(repos) ? repos.map((x) => `${x.stargazers_count} stars · <a href="${x.html_url}" target="_blank" rel="noopener">${escapeHtml(x.name)}</a>`).join("<br>") : "");
        } catch { $("#gOut").textContent = "User not found, Sir."; }
      };
      $("#gGo").onclick = go;
      $("#gU").onkeydown = (e) => e.key === "Enter" && go();
    } },

  { id: "image", icon: "IM", name: "Image AI", desc: "Generate images (Pollinations, no key)",
    render(b) {
      b.innerHTML = `<div class="row"><input id="iP" placeholder="Describe the image …"><button class="btn" id="iGo">Generate</button></div><div id="iOut"><p class="muted">Example: "Arc reactor, futuristic, dark blue"</p></div>`;
      const go = () => {
        const p = $("#iP").value.trim(); if (!p) return;
        const seed = Math.floor(Math.random() * 99999);
        $("#iOut").innerHTML = `<p class="muted">Generating image …</p><img class="gen" src="https://image.pollinations.ai/prompt/${encodeURIComponent(p)}?width=768&height=512&seed=${seed}&nologo=true" alt="Generated image">`;
      };
      $("#iGo").onclick = go;
      $("#iP").onkeydown = (e) => e.key === "Enter" && go();
    } },

  { id: "translate", icon: "TR", name: "Translator", desc: "EN to DE (MyMemory, free)",
    render(b) {
      b.innerHTML = `<div class="row"><input id="tIn" placeholder="English text …"><button class="btn" id="tGo">Translate</button></div><div class="result" id="tOut">Ready.</div>`;
      const go = async () => {
        const q = $("#tIn").value.trim(); if (!q) return;
        $("#tOut").textContent = "Translating …";
        try {
          const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=en|de`);
          const d = await r.json();
          $("#tOut").textContent = d.responseData?.translatedText || "No translation received.";
        } catch { $("#tOut").textContent = "Translator unreachable."; }
      };
      $("#tGo").onclick = go;
      $("#tIn").onkeydown = (e) => e.key === "Enter" && go();
    } },

  { id: "worldclock", icon: "WC", name: "World clock", desc: "Time zones at a glance",
    render(b) { b.innerHTML = `<p class="muted">The world clock is in the left panel and updates continuously.</p>`; } },

  { id: "pomodoro", icon: "PO", name: "Pomodoro", desc: "Focus timer 25/5",
    render(b) {
      b.innerHTML = `<div class="timer-big" id="pBig">25:00</div><div class="row"><button class="btn" id="pStart">Start focus</button><button class="btn ghost" id="pBreak">Break 5 min</button></div><p class="muted" id="pInfo">25 minutes of focus, then a 5 minute break. Good luck, Sir.</p>`;
      let iv = null;
      const run = (sec, label) => {
        clearInterval(iv);
        const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
        $("#pBig").textContent = fmt(sec); $("#pInfo").textContent = label;
        iv = setInterval(() => { sec--; $("#pBig").textContent = fmt(sec); if (sec <= 0) { clearInterval(iv); speak(label.startsWith("Focus") ? "Focus complete, Sir. Time for a break." : "Break over, Sir."); } }, 1000);
      };
      $("#pStart").onclick = () => run(25 * 60, "Focus running …");
      $("#pBreak").onclick = () => run(5 * 60, "Break running …");
    } },

  { id: "smart", icon: "SL", name: "Smart Light", desc: "Light demo (local, no hardware)",
    render(b) {
      b.innerHTML = `<div class="row"><button class="btn" id="lOn">On</button><button class="btn ghost" id="lOff">Off</button><input type="color" id="lColor" value="#38c8f0"></div><div id="lPreview" style="height:90px;border-radius:12px;background:#38c8f0"></div><p class="muted small">Demo: for real smart home (Philips Hue etc.) plug the local API in here – the plugin principle stays the same.</p>`;
      const prev = $("#lPreview");
      $("#lOn").onclick = () => { prev.style.opacity = 1; speak("Lights on, Sir."); };
      $("#lOff").onclick = () => { prev.style.opacity = .08; speak("Lights off, Sir."); };
      $("#lColor").oninput = (e) => { prev.style.background = e.target.value; };
    } },

  { id: "media", icon: "ME", name: "Media", desc: "YouTube search",
    render(b) {
      b.innerHTML = `<div class="row"><input id="mQ" placeholder="Search a video …"><button class="btn" id="mGo">Search</button></div><div id="mOut"><p class="muted">Searches YouTube and links the results.</p></div>`;
      const go = () => {
        const q = $("#mQ").value.trim(); if (!q) return;
        $("#mOut").innerHTML = `<a class="btn" href="https://www.youtube.com/results?search_query=${encodeURIComponent(q)}" target="_blank" rel="noopener">Watch "${escapeHtml(q)}" on YouTube</a>`;
      };
      $("#mGo").onclick = go;
      $("#mQ").onkeydown = (e) => e.key === "Enter" && go();
    } },
];

function initPlugins() {
  $("#pluginCount").textContent = PLUGINS.length + " active";
  $("#pluginGrid").innerHTML = PLUGINS.map((p) =>
    `<button class="plugin" data-id="${p.id}" title="${p.desc}"><span class="ic">${p.icon}</span><span class="nm">${p.name}</span></button>`).join("");
  document.querySelectorAll(".plugin").forEach((el) =>
    el.addEventListener("click", () => openPlugin(el.dataset.id)));
  $("#pluginClose").onclick = closePlugin;
  $("#pluginModal").addEventListener("click", (e) => { if (e.target.id === "pluginModal") closePlugin(); });
}

function openPlugin(id, opts) {
  const p = PLUGINS.find((x) => x.id === id);
  if (!p) return;
  $("#pluginTitle").textContent = p.name;
  $("#pluginModal").hidden = false;
  p.render($("#pluginBody"), opts || {});
}
function closePlugin() { $("#pluginModal").hidden = true; }
