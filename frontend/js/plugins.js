/* J.A.R.V.I.S – Plugin-System
   Jedes Plugin: { id, icon, name, desc, render(body, opts) }
   Neue Plugins einfach unten in PLUGINS ergänzen – siehe PLUGINS.md im Projekt-Root. */
/* Hinweis: $ , API und state werden zentral in app.js definiert (wird zuerst geladen). */

const PLUGINS = [
  { id: "weather", icon: "🌤", name: "Wetter", desc: "Live-Wetter via Open-Meteo (kein Key)",
    render(b) { b.innerHTML = `<p class="muted">Wetter wird links live angezeigt. Stadt in den Einstellungen änderbar.</p><button class="btn" onclick="loadWeather();closePlugin()">Aktualisieren</button>`; } },

  { id: "system", icon: "🖥", name: "System", desc: "Geräte-Infos (Browser) oder Pi-Werte (optionales Backend)",
    render(b) { b.innerHTML = `<p class="muted">Links siehst du Infos zu diesem Gerät (Kerne, RAM, Speicher). Für echte Pi-Werte (CPU/RAM/Temperatur) in den ⚙ Einstellungen die optionale Pi-Backend-URL eintragen.</p>`; } },

  { id: "mcp", icon: "🔌", name: "MCP", desc: "Echte Remote-MCP-Server (z. B. Composio) direkt im Browser verbinden",
    render(b) {
      b.innerHTML = `
        <p class="muted">Verbinde <b>echte Remote-MCP-Server</b> (Streamable HTTP) – z. B. <b>Composio</b>
        (Gmail, Drive, Sheets …). Die KI (Groq/Ollama) nutzt ihre Tools automatisch.
        Serverdaten bleiben nur in diesem Browser. Ausführlich: <code>MCP.md</code>.</p>
        <details class="guide"><summary>📖 Composio: MCP-URL herausfinden (≈ 2 Min)</summary>
          <ol class="steps">
            <li>Auf <b>composio.dev</b> einloggen (kostenloser Account genügt).</li>
            <li>Im Dashboard einen <b>MCP-Server / Tool Router</b> anlegen (Menü „MCP“ bzw. „Tool Router“ – die Bezeichnung variiert leicht).</li>
            <li><b>Toolkits</b> auswählen (z. B. Gmail, Google Drive, Sheets) und deine Accounts per OAuth verbinden („Connect“).</li>
            <li>Composio zeigt danach die <b>MCP-URL</b> an – kopieren. Sie sieht so aus:<br>
              <code>https://backend.composio.dev/v3/mcp/DEINE_SERVER_ID?user_id=DEINE_USER_ID</code></li>
            <li>Deinen <b>API-Key</b> (<code>ak_…</code>) findest du in Composio unter <b>Settings → API Keys</b>.</li>
            <li>Unten auf <b>„+ Composio-Vorlage“</b> tippen, URL einfügen und im Header-Feld
              <code>{"x-api-key": "ak_…"}</code> mit deinem Key ausfüllen → <b>„Speichern &amp; verbinden“</b>. Fertig – oben erscheint ✅ mit der Tool-Anzahl.</li>
          </ol>
          <p class="muted small" style="padding:0 12px 10px">Alternative „Composio Connect“: URL <code>https://connect.composio.dev/mcp</code>, Header <code>{"x-consumer-api-key": "ck_…"}</code> (anderer Key-Typ!). <b>In diesem Deployment ist der Connect-Key bereits sicher in der Vercel-Env hinterlegt</b> – unten <b>„+ Composio Connect“</b> tippen, Header <code>{}</code> lassen und speichern; der Server wird beim Start sogar automatisch angelegt und der Proxy trägt den Key ein.</p>
        </details>
        <details class="guide"><summary>➕ MCP-Server hinzufügen – so geht's generell</summary>
          <ol class="steps">
            <li><b>Begriffe:</b> J.A.R.V.I.S ist der <b>MCP-Client (Host)</b> – er ist schon eingebaut. „Hinzufügen“ heißt hier: einen <b>MCP-Server</b> eintragen, dessen Tools die KI dann nutzen darf. Einen separaten Client musst du nicht installieren.</li>
            <li>Auf <b>„+ Eigener Server“</b> tippen (oder die Composio-Vorlage oben nutzen).</li>
            <li><b>Name</b> vergeben (z. B. <code>composio</code>), die <b>MCP-URL</b> des Anbieters einfügen (muss <code>https://</code> sein, Streamable HTTP).</li>
            <li><b>Header</b> als JSON eintragen, falls der Anbieter einen Key verlangt, z. B. <code>{"x-api-key": "ak_…"}</code> oder <code>{"Authorization": "Bearer …"}</code> – sonst <code>{}</code>.</li>
            <li><b>Weg: „Vercel-Proxy“</b> lassen (empfohlen – umgeht CORS). Nur Server, die Browser-Zugriffe selbst erlauben, gehen „direkt“.</li>
            <li><b>„Speichern &amp; verbinden“</b> → Status oben: ✅ = verbunden, daneben die Anzahl der gefundenen Tools. Mit <b>„Tool testen“</b> unten kannst du ein Tool direkt ausprobieren.</li>
            <li>Danach einfach im <b>Chat</b> fragen („Zeig meine letzten E-Mails“) – Groq/Ollama ruft die MCP-Tools automatisch auf. Mit der Checkbox „an“ schaltest du Server einzeln an/aus, ✎ bearbeiten, ✕ löschen.</li>
            <li class="muted">Grenze: Lokale stdio-Server (<code>npx …</code>/<code>uvx …</code>) kann ein Browser nicht starten – nur Remote-HTTP-Server. Für stdio gibt es optional das Pi-Backend (siehe MCP.md).</li>
          </ol>
        </details>
        <div id="mcpServers"><p class="muted">Verbinde …</p></div>
        <div class="row"><button class="btn" id="mcpReload">↻ Neu verbinden</button>
        <button class="btn ghost" id="mcpPresetComposio">+ Composio-Vorlage</button>
        <button class="btn ghost" id="mcpPresetConnect">+ Composio Connect</button>
        <button class="btn ghost" id="mcpPresetCustom">+ Eigener Server</button></div>
        <div id="mcpEdit"></div>
        <h4 style="margin:14px 0 6px">Tool testen</h4>
        <div class="row"><select id="mcpToolSel" style="flex:1;background:#04101f;color:#fff;border:1px solid var(--line);border-radius:10px;padding:10px"><option value="">– Tool wählen –</option></select></div>
        <div class="row"><textarea id="mcpArgs" rows="3" style="flex:1;background:#04101f;color:#fff;border:1px solid var(--line);border-radius:10px;padding:10px" placeholder='Argumente als JSON, z. B. {}'></textarea></div>
        <div class="row"><button class="btn" id="mcpCall">Tool ausführen</button></div>
        <div class="result" id="mcpOut">Bereit. Danach einfach im Chat fragen – z. B. „Zeig meine letzten E-Mails“ (mit Composio-Gmail).</div>`;

      const draw = async (force) => {
        $("#mcpServers").innerHTML = '<p class="muted">Verbinde …</p>';
        try {
          if (force) await Mcp.refresh();
          const d = await Mcp.status();
          const list = Mcp.loadServers();
          $("#mcpServers").innerHTML =
            (list.length ? list.map((s, i) => {
              const st = d.servers.find((x) => x.name === s.name) || {};
              return `<div class="kv"><span>${st.connected ? "✅" : s.enabled ? "❌" : "⚪"} <b>${escapeHtml(s.name)}</b>
                <small class="muted">${escapeHtml(s.url || "")}${st.error ? " – " + escapeHtml(st.error) : ""}</small></span>
                <span><label class="muted small"><input type="checkbox" data-mcp-toggle="${i}" ${s.enabled ? "checked" : ""}> an</label>
                <button class="btn ghost" data-mcp-edit="${i}">✎</button>
                <button class="btn ghost" data-mcp-del="${i}">✕</button></span></div>`;
            }).join("") : '<p class="muted">Noch keine Server. Lege unten eine Composio-Vorlage an.</p>') +
            `<p class="muted small">Gesamt: ${d.tool_count} Tools verfügbar</p>`;
          $("#mcpToolSel").innerHTML = '<option value="">– Tool wählen –</option>' +
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
          $("#mcpServers").innerHTML = '<p class="muted">MCP-Client-Fehler: ' + escapeHtml(String(e.message || e)) + "</p>";
        }
      };

      const editForm = (idx, preset) => {
        const l = Mcp.loadServers();
        const s = preset || l[idx] || { name: "", url: "", headers: {}, via: "proxy", enabled: true };
        $("#mcpEdit").innerHTML = `
          <div class="row"><input id="meName" placeholder="Name (z. B. composio)" value="${escapeHtml(s.name || "")}">
          <select id="meVia" style="background:#04101f;color:#fff;border:1px solid var(--line);border-radius:10px;padding:10px">
            <option value="proxy" ${s.via === "proxy" ? "selected" : ""}>Weg: Vercel-Proxy (empfohlen)</option>
            <option value="auto" ${s.via === "auto" ? "selected" : ""}>Weg: auto (direkt → Proxy)</option>
            <option value="direct" ${s.via === "direct" ? "selected" : ""}>Weg: direkt (nur mit CORS)</option>
          </select></div>
          <div class="row"><input id="meUrl" placeholder="MCP-URL (https://…)" value="${escapeHtml(s.url || "")}"></div>
          <div class="row"><textarea id="meHeaders" rows="2" style="flex:1;background:#04101f;color:#fff;border:1px solid var(--line);border-radius:10px;padding:10px" placeholder='Header als JSON, z. B. {"x-api-key":"ak_…"}'>${escapeHtml(JSON.stringify(s.headers || {}))}</textarea></div>
          ${preset && preset.hint ? `<p class="muted small">${escapeHtml(preset.hint)}</p>` : ""}
          <div class="row"><button class="btn" id="meSave">Speichern & verbinden</button>
          <button class="btn ghost" id="meCancel">Abbrechen</button></div>`;
        $("#meCancel").onclick = () => ($("#mcpEdit").innerHTML = "");
        $("#meSave").onclick = () => {
          let headers = {};
          try { headers = JSON.parse($("#meHeaders").value.trim() || "{}"); }
          catch { $("#mcpOut").textContent = "Header sind kein gültiges JSON."; return; }
          const entry = {
            name: ($("#meName").value.trim() || "server").replace(/\s+/g, "-"),
            url: $("#meUrl").value.trim(),
            headers, via: $("#meVia").value, enabled: true,
          };
          if (!entry.url) { $("#mcpOut").textContent = "Bitte eine MCP-URL eintragen."; return; }
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
        if (!name) { $("#mcpOut").textContent = "Bitte zuerst ein Tool wählen, Sir."; return; }
        let args = {};
        try { args = JSON.parse($("#mcpArgs").value.trim() || "{}"); }
        catch { $("#mcpOut").textContent = "Argumente sind kein gültiges JSON."; return; }
        $("#mcpOut").textContent = "Führe " + name + " aus …";
        $("#mcpOut").textContent = await Mcp.callTool(name, args);
      };
      draw(false);
    } },

  { id: "notes", icon: "📝", name: "Notizen", desc: "Schnellnotizen (lokal gespeichert)",
    render(b) {
      b.innerHTML = `<div class="row"><input id="noteIn" placeholder="Neue Notiz …"><button class="btn" id="noteAdd">Hinzufügen</button></div><div id="noteList"></div>`;
      const key = "jarvis_notes";
      const get = () => JSON.parse(localStorage.getItem(key) || "[]");
      const draw = () => {
        $("#noteList").innerHTML = get().map((n, i) =>
          `<div class="todo-item"><span style="flex:1">${escapeHtml(n)}</span><button class="btn ghost" data-del="${i}">✕</button></div>`).join("") || '<p class="muted">Noch keine Notizen.</p>';
        b.querySelectorAll("[data-del]").forEach((x) => x.onclick = () => { const a = get(); a.splice(+x.dataset.del, 1); localStorage.setItem(key, JSON.stringify(a)); draw(); });
      };
      $("#noteAdd").onclick = () => { const v = $("#noteIn").value.trim(); if (!v) return; const a = get(); a.unshift(v); localStorage.setItem(key, JSON.stringify(a)); $("#noteIn").value = ""; draw(); };
      draw();
    } },

  { id: "todo", icon: "✅", name: "Todos", desc: "Aufgabenliste mit Checkboxen",
    render(b) {
      b.innerHTML = `<div class="row"><input id="todoIn" placeholder="Neue Aufgabe …"><button class="btn" id="todoAdd">+</button></div><div id="todoList"></div>`;
      const key = "jarvis_todos";
      const get = () => JSON.parse(localStorage.getItem(key) || "[]");
      const draw = () => {
        $("#todoList").innerHTML = get().map((t, i) =>
          `<div class="todo-item"><input type="checkbox" data-tog="${i}" ${t.done ? "checked" : ""}><span style="flex:1;${t.done ? "text-decoration:line-through;color:var(--muted)" : ""}">${escapeHtml(t.text)}</span><button class="btn ghost" data-del="${i}">✕</button></div>`).join("") || '<p class="muted">Keine Aufgaben. Sehr produktiv, Sir.</p>';
        b.querySelectorAll("[data-tog]").forEach((x) => x.onchange = () => { const a = get(); a[+x.dataset.tog].done = x.checked; localStorage.setItem(key, JSON.stringify(a)); draw(); });
        b.querySelectorAll("[data-del]").forEach((x) => x.onclick = () => { const a = get(); a.splice(+x.dataset.del, 1); localStorage.setItem(key, JSON.stringify(a)); draw(); });
      };
      $("#todoAdd").onclick = () => { const v = $("#todoIn").value.trim(); if (!v) return; const a = get(); a.push({ text: v, done: false }); localStorage.setItem(key, JSON.stringify(a)); $("#todoIn").value = ""; draw(); };
      draw();
    } },

  { id: "calc", icon: "🧮", name: "Rechner", desc: "Taschenrechner",
    render(b) {
      b.innerHTML = `<div class="row"><input id="calcIn" placeholder="z. B. 12*8+5"><button class="btn" id="calcGo">=</button></div><div class="result" id="calcOut">Bereit.</div>`;
      const go = () => {
        try {
          const expr = $("#calcIn").value.replace(/,/g, ".").replace(/[^0-9+\-*/(). ]/g, "");
          const v = Function('"use strict";return (' + expr + ")")();
          $("#calcOut").textContent = expr + " = " + (Math.round(v * 10000) / 10000);
        } catch { $("#calcOut").textContent = "Ungültiger Ausdruck, Sir."; }
      };
      $("#calcGo").onclick = go;
      $("#calcIn").onkeydown = (e) => e.key === "Enter" && go();
    } },

  { id: "timer", icon: "⏱", name: "Timer", desc: "Countdown mit Signal",
    render(b, opts = {}) {
      b.innerHTML = `<div class="timer-big" id="timerBig">05:00</div>
        <div class="row"><input id="timerMin" type="number" min="1" value="5" placeholder="Minuten"><button class="btn" id="timerStart">Start</button><button class="btn ghost" id="timerStop">Stopp</button></div>`;
      let left = opts.seconds || 300, iv = null;
      const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      const draw = () => ($("#timerBig").textContent = fmt(left));
      const stop = () => { clearInterval(iv); iv = null; };
      $("#timerStart").onclick = () => {
        stop(); left = parseInt($("#timerMin").value || "5", 10) * 60; draw();
        iv = setInterval(() => { left--; draw(); if (left <= 0) { stop(); speak("Sir, die Zeit ist um."); addMsg("jarvis", "⏱ Timer abgelaufen, Sir.", "timer"); } }, 1000);
      };
      $("#timerStop").onclick = stop;
      draw();
    } },

  { id: "stopwatch", icon: "⏲", name: "Stoppuhr", desc: "Stoppuhr mit Runden",
    render(b) {
      b.innerHTML = `<div class="timer-big" id="swBig">00:00.0</div><div class="row"><button class="btn" id="swToggle">Start</button><button class="btn ghost" id="swLap">Runde</button><button class="btn ghost" id="swReset">Reset</button></div><div id="swLaps"></div>`;
      let t0 = 0, elapsed = 0, iv = null;
      const fmt = (ms) => { const s = ms / 1000; return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}.${Math.floor((ms % 1000) / 100)}`; };
      const draw = () => ($("#swBig").textContent = fmt(elapsed + (t0 ? Date.now() - t0 : 0)));
      $("#swToggle").onclick = (e) => {
        if (iv) { clearInterval(iv); iv = null; elapsed += Date.now() - t0; t0 = 0; e.target.textContent = "Start"; }
        else { t0 = Date.now(); iv = setInterval(draw, 50); e.target.textContent = "Pause"; }
      };
      $("#swLap").onclick = () => { const d = document.createElement("div"); d.className = "kv"; d.innerHTML = `<span>Runde</span><b>${fmt(elapsed + (t0 ? Date.now() - t0 : 0))}</b>`; $("#swLaps").prepend(d); };
      $("#swReset").onclick = () => { clearInterval(iv); iv = null; t0 = 0; elapsed = 0; $("#swLaps").innerHTML = ""; draw(); };
      draw();
    } },

  { id: "search", icon: "🔍", name: "Suche", desc: "Websuche (DuckDuckGo, kein Key)",
    render(b, opts = {}) {
      b.innerHTML = `<div class="row"><input id="sQ" placeholder="Suchbegriff …" value="${escapeHtml(opts.q || "")}"><button class="btn" id="sGo">Suchen</button></div><div class="result" id="sOut">Bereit.</div>`;
      const go = async () => {
        const q = $("#sQ").value.trim(); if (!q) return;
        $("#sOut").textContent = "Suche läuft …";
        try {
          const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1`);
          const d = await r.json();
          const abs = d.AbstractText || "Kein Direkt-Treffer. Ich öffne die Suche in einem neuen Tab.";
          $("#sOut").innerHTML = `${escapeHtml(abs)}<br><br><a href="https://duckduckgo.com/?q=${encodeURIComponent(q)}" target="_blank" rel="noopener">→ Auf DuckDuckGo weiter suchen</a>`;
        } catch { $("#sOut").innerHTML = `<a href="https://duckduckgo.com/?q=${encodeURIComponent(q)}" target="_blank" rel="noopener">Auf DuckDuckGo suchen</a>`; }
      };
      $("#sGo").onclick = go;
      $("#sQ").onkeydown = (e) => e.key === "Enter" && go();
      if (opts.q) go();
    } },

  { id: "wiki", icon: "📚", name: "Wikipedia", desc: "Artikel-Suche (kostenlos)",
    render(b) {
      b.innerHTML = `<div class="row"><input id="wQ" placeholder="Begriff …"><button class="btn" id="wGo">Suchen</button></div><div class="result" id="wOut">Bereit.</div>`;
      const go = async () => {
        const q = $("#wQ").value.trim(); if (!q) return;
        $("#wOut").textContent = "Lade …";
        try {
          const r = await fetch(`https://de.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q.replace(/ /g, "_"))}`);
          if (!r.ok) throw new Error("nf");
          const d = await r.json();
          $("#wOut").innerHTML = `<b>${escapeHtml(d.title)}</b><br>${escapeHtml(d.extract || "")}<br><br><a href="${d.content_urls?.desktop?.page || "#"}" target="_blank" rel="noopener">→ Wikipedia-Artikel</a>`;
        } catch { $("#wOut").textContent = "Artikel nicht gefunden, Sir. Anderen Begriff versuchen."; }
      };
      $("#wGo").onclick = go;
      $("#wQ").onkeydown = (e) => e.key === "Enter" && go();
    } },

  { id: "news", icon: "📰", name: "News", desc: "RSS-Nachrichten (Vercel-Function / direkt)",
    render(b) { b.innerHTML = `<p class="muted">Die aktuellen Schlagzeilen stehen rechts im News-Panel. Feed oben wählbar.</p><button class="btn" onclick="loadNews();closePlugin()">Neu laden</button>`; } },

  { id: "crypto", icon: "₿", name: "Krypto", desc: "BTC / ETH / SOL (CoinGecko)",
    render(b) { b.innerHTML = `<p class="muted">Kurse stehen rechts im Krypto-Panel (CoinGecko direkt aus dem Browser).</p><button class="btn" onclick="loadCrypto();closePlugin()">Neu laden</button>`; } },

  { id: "github", icon: "🐙", name: "GitHub", desc: "Profile & Repos (öffentliche API)",
    render(b) {
      b.innerHTML = `<div class="row"><input id="gU" placeholder="GitHub-Benutzername …"><button class="btn" id="gGo">Laden</button></div><div class="result" id="gOut">Bereit.</div>`;
      const go = async () => {
        const u = $("#gU").value.trim(); if (!u) return;
        $("#gOut").textContent = "Lade …";
        try {
          const [ur, rr] = await Promise.all([
            fetch(`https://api.github.com/users/${encodeURIComponent(u)}`),
            fetch(`https://api.github.com/users/${encodeURIComponent(u)}/repos?sort=updated&per_page=5`),
          ]);
          const user = await ur.json(), repos = await rr.json();
          if (user.message) throw new Error(user.message);
          $("#gOut").innerHTML = `<b>${escapeHtml(user.name || user.login)}</b> · ${user.public_repos} Repos · ${user.followers} Follower<br>${escapeHtml(user.bio || "")}<br><br>` +
            (Array.isArray(repos) ? repos.map((x) => `★ ${x.stargazers_count} <a href="${x.html_url}" target="_blank" rel="noopener">${escapeHtml(x.name)}</a>`).join("<br>") : "");
        } catch { $("#gOut").textContent = "Benutzer nicht gefunden, Sir."; }
      };
      $("#gGo").onclick = go;
      $("#gU").onkeydown = (e) => e.key === "Enter" && go();
    } },

  { id: "image", icon: "🎨", name: "Bild-KI", desc: "Bilder generieren (Pollinations, kein Key)",
    render(b) {
      b.innerHTML = `<div class="row"><input id="iP" placeholder="Bildbeschreibung …"><button class="btn" id="iGo">Generieren</button></div><div id="iOut"><p class="muted">Beispiel: „Arc Reactor, futuristisch, dunkelblau“</p></div>`;
      const go = () => {
        const p = $("#iP").value.trim(); if (!p) return;
        const seed = Math.floor(Math.random() * 99999);
        $("#iOut").innerHTML = `<p class="muted">Generiere Bild …</p><img class="gen" src="https://image.pollinations.ai/prompt/${encodeURIComponent(p)}?width=768&height=512&seed=${seed}&nologo=true" alt="Generiertes Bild">`;
      };
      $("#iGo").onclick = go;
      $("#iP").onkeydown = (e) => e.key === "Enter" && go();
    } },

  { id: "translate", icon: "🌐", name: "Übersetzer", desc: "DE ↔ EN (MyMemory, kostenlos)",
    render(b) {
      b.innerHTML = `<div class="row"><input id="tIn" placeholder="Text …"><button class="btn" id="tGo">Übersetzen</button></div><div class="result" id="tOut">Bereit.</div>`;
      const go = async () => {
        const q = $("#tIn").value.trim(); if (!q) return;
        $("#tOut").textContent = "Übersetze …";
        try {
          const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=de|en`);
          const d = await r.json();
          $("#tOut").textContent = d.responseData?.translatedText || "Keine Übersetzung erhalten.";
        } catch { $("#tOut").textContent = "Übersetzer nicht erreichbar."; }
      };
      $("#tGo").onclick = go;
      $("#tIn").onkeydown = (e) => e.key === "Enter" && go();
    } },

  { id: "files", icon: "📁", name: "Dateien", desc: "Projekt-Dateimanager (Backend)",
    render(b) {
      b.innerHTML = `<div class="row"><button class="btn ghost" id="fUp">↑ Ordner hoch</button><b id="fPath" style="align-self:center">.</b></div><div id="fList"><p class="muted">Lade …</p></div>`;
      let cur = ".";
      const draw = async () => {
        $("#fPath").textContent = cur;
        try {
          if (!state.backendUrl) throw new Error("kein Backend");
          const r = await fetch(`${state.backendUrl}/api/files?path=${encodeURIComponent(cur)}`);
          if (!r.ok) throw new Error("nf");
          const d = await r.json();
          $("#fList").innerHTML = d.items.map((i) =>
            `<div class="file-item" data-p="${escapeHtml(i.name)}" data-t="${i.type}"><span>${i.type === "dir" ? "📁" : "📄"} ${escapeHtml(i.name)}</span><small class="muted">${i.size != null ? (i.size / 1024).toFixed(1) + " KB" : ""}</small></div>`).join("") || '<p class="muted">Leer.</p>';
          b.querySelectorAll(".file-item").forEach((el) => el.onclick = () => { if (el.dataset.t === "dir") { cur = cur === "." ? el.dataset.p : cur + "/" + el.dataset.p; draw(); } });
        } catch { $("#fList").innerHTML = '<p class="muted">Der Dateimanager braucht das optionale Pi-Backend (⚙ Einstellungen: Backend-URL, z. B. http://raspberrypi.local:8000). Ohne Backend ist er deaktiviert – auf Vercel gibt es bewusst keinen Dateizugriff.</p>'; }
      };
      $("#fUp").onclick = () => { cur = cur.includes("/") ? cur.split("/").slice(0, -1).join("/") || "." : "."; draw(); };
      draw();
    } },

  { id: "worldclock", icon: "🕐", name: "Weltuhr", desc: "Zeitzonen im Blick",
    render(b) { b.innerHTML = `<p class="muted">Die Weltuhr steht links im Panel und aktualisiert sich jede Sekunde.</p>`; } },

  { id: "pomodoro", icon: "🍅", name: "Pomodoro", desc: "Fokus-Timer 25/5",
    render(b) {
      b.innerHTML = `<div class="timer-big" id="pBig">25:00</div><div class="row"><button class="btn" id="pStart">Fokus starten</button><button class="btn ghost" id="pBreak">Pause 5 Min</button></div><p class="muted" id="pInfo">25 Min Fokus, dann 5 Min Pause. Viel Erfolg, Sir.</p>`;
      let iv = null;
      const run = (sec, label) => {
        clearInterval(iv);
        const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
        $("#pBig").textContent = fmt(sec); $("#pInfo").textContent = label;
        iv = setInterval(() => { sec--; $("#pBig").textContent = fmt(sec); if (sec <= 0) { clearInterval(iv); speak(label.includes("Fokus") ? "Fokus abgeschlossen, Sir. Zeit für eine Pause." : "Pause vorbei, Sir."); } }, 1000);
      };
      $("#pStart").onclick = () => run(25 * 60, "Fokus läuft …");
      $("#pBreak").onclick = () => run(5 * 60, "Pause läuft …");
    } },

  { id: "smart", icon: "💡", name: "Smart Light", desc: "Licht-Demo (lokal, ohne Hardware)",
    render(b) {
      b.innerHTML = `<div class="row"><button class="btn" id="lOn">An</button><button class="btn ghost" id="lOff">Aus</button><input type="color" id="lColor" value="#00d4ff"></div><div id="lPreview" style="height:90px;border-radius:12px;background:#00d4ff;box-shadow:0 0 30px #00d4ff"></div><p class="muted small">Demo: Für echtes Smart Home (Philips Hue etc.) hier die lokale API eintragen – das Plugin-Prinzip bleibt gleich.</p>`;
      const prev = $("#lPreview");
      $("#lOn").onclick = () => { prev.style.opacity = 1; speak("Licht an, Sir."); };
      $("#lOff").onclick = () => { prev.style.opacity = .08; speak("Licht aus, Sir."); };
      $("#lColor").oninput = (e) => { prev.style.background = e.target.value; prev.style.boxShadow = `0 0 30px ${e.target.value}`; };
    } },

  { id: "media", icon: "🎬", name: "Media", desc: "YouTube-Suche (Embed)",
    render(b) {
      b.innerHTML = `<div class="row"><input id="mQ" placeholder="Video suchen …"><button class="btn" id="mGo">Suchen</button></div><div id="mOut"><p class="muted">Sucht auf YouTube und bettet das erste Ergebnis ein.</p></div>`;
      const go = () => {
        const q = $("#mQ").value.trim(); if (!q) return;
        $("#mOut").innerHTML = `<a class="btn" href="https://www.youtube.com/results?search_query=${encodeURIComponent(q)}" target="_blank" rel="noopener">▶ „${escapeHtml(q)}“ auf YouTube ansehen</a>`;
      };
      $("#mGo").onclick = go;
      $("#mQ").onkeydown = (e) => e.key === "Enter" && go();
    } },
];

function initPlugins() {
  $("#pluginCount").textContent = PLUGINS.length + " aktiv";
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
  $("#pluginTitle").textContent = `${p.icon} ${p.name}`;
  $("#pluginModal").hidden = false;
  p.render($("#pluginBody"), opts || {});
}
function closePlugin() { $("#pluginModal").hidden = true; }
