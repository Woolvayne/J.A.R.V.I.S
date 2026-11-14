# J.A.R.V.I.S – Build your own plugin

Plugins live in `frontend/js/plugins.js`. Each plugin is a small object
in the `PLUGINS` array — the grid, the modal window and the voice
command (“open calculator” …) come for free.

## Minimal example

```js
{ id: "coin", icon: "CO", name: "Coin flip", desc: "Heads or tails",
  render(b) {
    b.innerHTML = `<div class="timer-big" id="coinOut">?</div>
      <div class="row"><button class="btn" id="coinFlip">Flip</button></div>`;
    $("#coinFlip").onclick = () => {
      const r = Math.random() < 0.5 ? "Heads" : "Tails";
      $("#coinOut").textContent = r; speak(r + ", Sir.");
    };
  } },
```

Paste it into `PLUGINS`, reload the page, done.

## Fields

| Field | Meaning |
|---|---|
| `id` | Unique ID; also the voice command (“open **coin**”) and chat alias target |
| `icon` | 1–2 letter monogram shown as a tile (no emojis) |
| `name` | Display name in the grid and modal title |
| `desc` | Tooltip; shown in descriptions |
| `render(body, opts)` | Builds the UI into `body` (the modal content element) |

## Helpers available inside `render`

- `$(sel)` – querySelector shorthand (scoped care: modal content is unique on the page)
- `speak("…")` – read something aloud (Pi voice, browser fallback)
- `addMsg("jarvis", "…", "via …")` – add a chat message
- `closePlugin()` – close the modal
- `API`, `state` – current deployment state (base path and runtime settings)
- `escapeHtml(x)` – always escape user/provider text before `innerHTML`

## Building blocks (CSS classes already styled)

`row` (input + button row), `btn` / `btn ghost`, `result` (output box),
`kv` (label/value lines), `timer-big`, `todo-item`, `muted` / `small`,
`details.guide` + `ol.steps` for walkthroughs, `img.gen` for images.

## Rules of the house

- **No emojis** in the UI; use the monogram tile and plain text.
- English only; address the user as “Sir” in spoken confirmations.
- Free services only; keys belong in Settings/localStorage or Vercel
  env — never hard-code secrets.
- Escape external text (`escapeHtml`) — plugin HTML is injected.
- Keep it light: it must stay snappy on a Pi 3B+ browser and iPad.
