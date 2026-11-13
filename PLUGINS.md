# 🧩 J.A.R.V.I.S – Eigenes Plugin bauen

Plugins leben in **`frontend/js/plugins.js`** in der Liste `PLUGINS`.
Ein Plugin ist ein einziges Objekt – kein Build, kein Framework:

```js
{ id: "meinplugin", icon: "🚀", name: "Mein Plugin", desc: "Was es tut (Tooltip)",
  render(body, opts) {
    // body = Inhalt des Plugin-Fensters (HTMLElement)
    // opts = optionale Parameter, z. B. vom Sprachbefehl übergeben
    body.innerHTML = `<p>Hallo, Sir.</p>`;
  } },
```

Danach erscheint es automatisch im Plugin-Grid des Dashboards (inkl. Zähler).

## Per Sprach-/Textbefehl öffnen

In `frontend/js/chat.js` in `runLocalCommand()` ein Stichwort ergänzen:

```js
const pluginCmds = {
  // ...
  rakete: "meinplugin",
};
```

Dann öffnet „Öffne Rakete“ dein Plugin. Parameter übergeben geht so:

```js
openPlugin("meinplugin", { q: "irgendwas" });  // in render() als opts.q verfügbar
```

## Nützliche Helfer (global verfügbar)

| Helfer | Zweck |
|---|---|
| `$(sel)` | `document.querySelector` (aus `app.js`) |
| `escapeHtml(s)` | XSS-sicheres Einfügen von Text |
| `speak(text)` | Text per Edge TTS vorlesen |
| `addMsg("jarvis", text, provider)` | Nachricht in den Chat schreiben |
| `setOrb("speak"\|"listen"\|"idle", text)` | Orb-Zustand/Statuszeile setzen |
| `state` | `{ city, voice, ttsOn, autoSpeak, backend }` |
| `API` | Basis-URL des Backends (`""` = gleicher Host) |

## Kostenlose APIs ohne Key (Ideen)

- **Wetter:** Open-Meteo (`api.open-meteo.com`) – auch direkt aus dem Browser (CORS ok)
- **Suche:** DuckDuckGo Instant Answers (`api.duckduckgo.com`)
- **Wissen:** Wikipedia REST (`de.wikipedia.org/api/rest_v1/...`)
- **Bilder:** Pollinations (`image.pollinations.ai/prompt/...`)
- **Übersetzung:** MyMemory (`api.mymemory.translated.net`)
- **GitHub:** Öffentliche REST-API (`api.github.com`)
- **Eigene Daten:** Neue Route in `backend/server.py` ergänzen (FastAPI), z. B. `/api/meinding`

> CORS-Tipp: APIs ohne CORS-Freigabe einfach über das Backend proxien –
> Vorbild sind `/api/news`, `/api/weather` und `/api/crypto` in `backend/server.py`.

## Beispiel: Münzwurf-Plugin

```js
{ id: "coin", icon: "🪙", name: "Münze", desc: "Kopf oder Zahl",
  render(b) {
    b.innerHTML = `<div class="timer-big" id="coinOut">🪙</div>
      <div class="row"><button class="btn" id="coinGo">Werfen</button></div>`;
    $("#coinGo").onclick = () => {
      const r = Math.random() < 0.5 ? "Kopf" : "Zahl";
      $("#coinOut").textContent = r;
      speak(r + ", Sir.");
    };
  } },
```

In `PLUGINS` einfügen, Seite neu laden, fertig. 🎉
