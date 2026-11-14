/* J.A.R.V.I.S – Stimme ohne Backend:
 * Standard: Browser-Stimme (speechSynthesis, kostenlos, offline im Browser).
 * Optional: Edge TTS, wenn in den Einstellungen eine Pi-Backend-URL gesetzt
 * ist (dort läuft weiter backend/tts.py). STT: Web Speech API (de-DE).
 *
 * iOS/Safari-Besonderheiten, die hier behandelt werden:
 * - Sprachausgabe darf erst nach einer Nutzer-Geste starten -> die erste
 *   Berührung "entsperrt" die Stimme (unlockSpeech); eine vorher angefragte
 *   Begrüßung wird danach nachgeholt.
 * - Lange Texte werden in kurze Sätze zerlegt – Safari verschluckt sonst
 *   gern lange Utterances.
 * - Mikrofon: Tippen auf den pulsierenden Orb (oder 🎙) fragt zuerst per
 *   getUserMedia die Mikrofon-Freigabe ab und startet dann die
 *   Spracherkennung. Das erkannte Wort landet im Eingabefeld (dort auch
 *   per Tastatur korrigierbar) und wird dann gesendet. Tippen geht immer.
 */
/* Hinweis: $ , API und state werden zentral in app.js definiert. */

let speechUnlocked = false;
let deferredSpeech = "";
let speechRunId = 0;
let audioEl = null;
const _utteranceRefs = []; // Safari sammelt sonst gern aktive Utterances ein (GC-Bug)
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

// Kleine Diagnose: letzte TTS-Ereignisse (wird in den ⚙ Einstellungen gezeigt)
const ttsEvents = [];
function ttsLog(msg) {
  const line = new Date().toLocaleTimeString("de-DE") + " " + msg;
  ttsEvents.unshift(line);
  if (ttsEvents.length > 6) ttsEvents.pop();
  try { console.log("[TTS]", msg); } catch { /* egal */ }
  const el = document.querySelector("#ttsStatus");
  if (el) el.innerHTML = ttsEvents.map((e) => escapeHtml(e)).join("<br>");
}

// Fehlertext eines TTS-Servers lesbar machen (z. B. "Voicebox HTTP 401:
// Token fehlt/falsch") – sonst sähe man nur ein nichtssagendes "HTTP 502".
async function ttsHttpError(r, label) {
  let detail = "";
  try {
    const t = await r.text();
    try { const j = JSON.parse(t); detail = [j.error, j.detail].filter(Boolean).join(" – "); }
    catch { detail = t.slice(0, 120); }
  } catch { /* egal */ }
  return new Error(label + " HTTP " + r.status + (detail ? ": " + detail : ""));
}

/* ------------------------------------------------------- TTS (Ausgabe) */
async function speak(text) {
  if (!state.ttsOn || !text) return;
  const clean = text.replace(/[*_`#>]/g, "").slice(0, 900);
  // iOS blockt Audio ohne vorherige Nutzer-Geste: merken und beim ersten
  // Tippen/Klicken nachholen statt tonlos zu verpuffen.
  if (!speechUnlocked) { deferredSpeech = clean; ttsLog("Warte auf erste Berührung (iOS-Sperre) …"); return; }
  setOrb("speak", "J.A.R.V.I.S spricht …");
  let audioBlocked = false;
  try {
    if (state.ttsUrl) {
      // 1. Wahl: Pi-Voicebox (Piper) – URL z. B. per Cloudflare Tunnel öffentlich
      const r = await fetch(state.ttsUrl + "/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(state.ttsToken ? { "X-Voice-Token": state.ttsToken } : {}) },
        body: JSON.stringify({ text: clean, voice: state.ttsVoice || undefined }),
      });
      if (!r.ok) throw await ttsHttpError(r, "voicebox");
      await playAudioBlob(await r.blob());
      ttsLog("Voicebox (Pi) hat gesprochen.");
    } else if (state.ttsServer) {
      // 1b. Wahl: Voicebox zentral in Vercel eingetragen – Token bleibt
      // serverseitig, der Browser ruft nur /api/tts (kein Eintippen nötig)
      const r = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, voice: state.ttsVoice || undefined }),
      });
      if (!r.ok) throw await ttsHttpError(r, "voicebox (Vercel)");
      await playAudioBlob(await r.blob());
      ttsLog("Voicebox (Pi, via Vercel) hat gesprochen.");
    } else if (state.backendUrl) {
      // 2. Wahl: optionales Pi-Backend mit Edge TTS (bessere Stimme)
      const r = await fetch(state.backendUrl + "/api/tts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, voice: state.voice || "de-DE-ConradNeural" }),
      });
      if (!r.ok) throw new Error("tts fail");
      await playAudioBlob(await r.blob());
      ttsLog("Edge TTS (Pi-Backend) hat gesprochen.");
    } else {
      // 3. Wahl: Browser-Stimme (Safari/iOS)
      await speakBrowser(clean);
    }
  } catch (e) {
    if (e && e.message === "audio-blocked") { audioBlocked = true; return; } // Audio kommt beim nächsten Tippen – keine Zweitstimme
    ttsLog("Server-Stimme fehlgeschlagen (" + String(e.message || e) + ") – nutze Browser-Stimme.");
    await speakBrowser(clean).catch(() => {});
  } finally {
    setOrb("idle", audioBlocked ? "Einmal tippen – dann lese ich die Antwort vor." : "Bereit, Sir.");
  }
}

function getAudioEl() {
  if (!audioEl) { audioEl = new Audio(); audioEl.preload = "auto"; }
  return audioEl;
}

let pendingAudioBlob = null; // Audio, das iOS erst beim nächsten Tippen erlaubt

async function playAudioBlob(blob, isRetry) {
  const el = getAudioEl();
  const url = URL.createObjectURL(blob);
  el.src = url;
  el.volume = 1;
  ttsLog("Audio erhalten (" + Math.round(blob.size / 1024) + " KB) – spiele ab …");
  try { el.load(); } catch { /* egal */ }
  const ended = new Promise((res) => { el.onended = res; el.onerror = res; });
  try {
    await el.play(); // auf iOS ok, weil das Element beim 1. Tippen "geprimed" wurde
    ttsLog("Wiedergabe läuft" + (isRetry ? " (nach Tippen)" : "") + " …");
    await ended;
    ttsLog("Wiedergabe fertig.");
  } catch (e) {
    // iOS verweigert play() ohne frische Nutzer-Geste (kommt vor, wenn der
    // Pi ein paar Sekunden zum Generieren brauchte). Nicht aufgeben und
    // NICHT zusätzlich die Browser-Stimme starten (sonst Doppel-Ausgabe),
    // sondern dasselbe Audio beim nächsten Tippen sofort abspielen.
    pendingAudioBlob = blob;
    ttsLog("iOS blockiert den Ton noch (" + String((e && e.name) || e) + ") – bitte einmal kurz tippen, dann spreche ich.");
    setOrb("idle", "Einmal tippen – dann lese ich die Antwort vor.");
    throw new Error("audio-blocked");
  } finally { URL.revokeObjectURL(url); }
}

// Nächstes Tippen spielt ein von iOS blockiertes Audio nach (innerhalb der Geste).
document.addEventListener("pointerdown", () => {
  if (!pendingAudioBlob) return;
  const blob = pendingAudioBlob;
  pendingAudioBlob = null;
  playAudioBlob(blob, true).catch(() => {});
}, { capture: true });

function stopSpeaking() {
  speechRunId++;
  try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch { /* egal */ }
  if (audioEl) { try { audioEl.pause(); } catch { /* egal */ } }
}

// Erste Nutzer-Geste entsperrt Audio auf iOS (Pflicht in Safari).
// WICHTIG: kein Leerzeichen-/Stumm-Satz mehr an speechSynthesis – der kann in
// Safari die Warteschlange blockieren, sodass danach gar nichts mehr kommt.
function unlockSpeech() {
  if (speechUnlocked) return;
  speechUnlocked = true;
  try {
    // HTML-Audio-Element mit stillem WAV "primen", damit Server-Stimmen
    // (Voicebox/Edge) später auch ohne direkten Klick abspielen dürfen.
    const el = getAudioEl();
    el.src = SILENT_WAV;
    // Nur pausieren, wenn noch das Stille-WAV geladen ist – läuft inzwischen
    // schon echtes Voicebox-Audio, darf das Prime-Promise es nicht stoppen.
    el.play().then(() => { if (el.src === SILENT_WAV) { el.pause(); el.currentTime = 0; } }).catch(() => {});
  } catch { /* egal */ }
  try {
    if (window.speechSynthesis) {
      speechSynthesis.resume();
      browserVoices(); // Stimmen schon mal laden (kommen auf iOS async)
    }
  } catch { /* Stimme ist optional */ }
  const pending = deferredSpeech;
  deferredSpeech = "";
  if (pending && state.ttsOn) speak(pending); // nachgeholte Antwort/Begrüßung
  if (typeof fillVoiceOptions === "function") fillVoiceOptions();
}
["pointerdown", "touchend", "keydown"].forEach((ev) =>
  document.addEventListener(ev, unlockSpeech, { capture: true, passive: true }));

function browserVoices() {
  try { return speechSynthesis.getVoices(); } catch { return []; }
}
if (window.speechSynthesis && speechSynthesis.addEventListener) {
  try { speechSynthesis.addEventListener("voiceschanged", () => { if (typeof fillVoiceOptions === "function") fillVoiceOptions(); }); } catch { /* egal */ }
}

function splitSpeechText(text) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  const sentences = flat.match(/[^.!?…]+[.!?…]*\s*/g) || [flat];
  const chunks = [];
  for (let s of sentences) {
    s = s.trim();
    while (s.length > 180) {
      let cut = s.lastIndexOf(" ", 180);
      if (cut < 60) cut = 180;
      chunks.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (s) chunks.push(s);
  }
  return chunks.filter(Boolean);
}

function speakBrowser(text) {
  return new Promise((resolve) => {
    const run = ++speechRunId;
    try {
      if (!window.speechSynthesis) { ttsLog("speechSynthesis fehlt in diesem Browser."); resolve(); return; }
      // Safari-Bug: cancel() direkt vor speak() lässt die Ausgabe oft komplett
      // ausfallen – deshalb nur abbrechen, wenn wirklich etwas läuft/anhängt.
      if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
      speechSynthesis.resume();
      const chunks = splitSpeechText(text);
      if (!chunks.length) { resolve(); return; }
      ttsLog("Browser-Stimme: " + chunks.length + " Satz-Teile, " + browserVoices().length + " Stimmen geladen.");
      let idx = 0;
      const next = () => {
        if (run !== speechRunId || idx >= chunks.length) { resolve(); return; }
        const chunk = chunks[idx++];
        const u = new SpeechSynthesisUtterance(chunk);
        _utteranceRefs.push(u); // Referenz halten (Safari-GC-Bug)
        const voices = browserVoices();
        const langOf = (v) => String(v.lang || "").replace("_", "-").toLowerCase();
        const chosen = voices.find((v) => v.name === state.voice)
          || voices.find((v) => langOf(v) === "de-de")
          || voices.find((v) => langOf(v).startsWith("de"));
        if (chosen) { u.voice = chosen; u.lang = chosen.lang; } else { u.lang = "de-DE"; }
        u.rate = 0.98; u.pitch = 0.9;
        let done = false, started = false;
        const cleanup = () => { const i = _utteranceRefs.indexOf(u); if (i >= 0) _utteranceRefs.splice(i, 1); };
        const finish = () => { if (!done) { done = true; cleanup(); setTimeout(next, 40); } };
        u.onstart = () => { started = true; ttsLog("Ausgabe läuft: „" + chunk.slice(0, 40) + "…“"); };
        u.onend = finish;
        u.onerror = (e) => { ttsLog("Utterance-Fehler: " + (e.error || "?")); finish(); };
        speechSynthesis.speak(u);
        // Watchdog: Kommt kein onstart und die Engine meldet nichts aktiv,
        // hat Safari die Ausgabe geschluckt (passiert ohne "frische"
        // Nutzer-Geste). Dann Text merken – er wird beim nächsten Tippen
        // sofort (innerhalb der Geste) gesprochen.
        setTimeout(() => {
          if (!done && !started && run === speechRunId && !speechSynthesis.speaking && !speechSynthesis.pending) {
            ttsLog("Safari hat die Ausgabe blockiert – Text wird beim nächsten Tippen gesprochen.");
            deferredSpeech = chunks.slice(idx - 1).join(" ");
            speechUnlocked = false; // nächste Berührung löst unlockSpeech erneut aus
            cleanup();
            setOrb("idle", "Tippe kurz, damit ich die Antwort vorlese.");
            resolve();
          }
        }, 900);
        // Sicherheitsnetz, falls Safari kein onend liefert
        setTimeout(finish, Math.min(12000, 1200 + chunk.length * 110));
      };
      setTimeout(next, 60);
    } catch (e) { ttsLog("speakBrowser-Fehler: " + String(e.message || e)); resolve(); }
  });
}

// Test-Knopf in den Einstellungen: spricht direkt im Klick (Nutzer-Geste),
// dadurch sieht man sofort, ob die Ausgabe grundsätzlich geht. Vorher ein
// kurzer Verbindungs-Selbsttest, damit im Status steht, WO es hakt:
// Pi-Tunnel nicht erreichbar? Token abgelehnt? Oder erst iOS-Wiedergabe?
async function testVoice() {
  unlockSpeech();
  const engine = state.ttsUrl ? "Pi-Voicebox" : state.ttsServer ? "Pi-Voicebox (via Vercel)" : state.backendUrl ? "Edge TTS (Pi)" : "Browser-Stimme";
  ttsLog("Test gestartet (" + engine + ", " + browserVoices().length + " Browser-Stimmen).");
  try {
    if (state.ttsServer && !state.ttsUrl) {
      const r = await fetch("/api/tts");
      const d = await r.json();
      if (!d.configured) ttsLog("Selbsttest: Voicebox ist in Vercel NICHT eingetragen.");
      else if (!d.upstream_reachable) ttsLog("Selbsttest: Pi über Cloudflare-Tunnel NICHT erreichbar – läuft der Tunnel auf dem Pi noch?");
      else if (!d.token_accepted) ttsLog("Selbsttest: Pi erreichbar, aber TOKEN ABGELEHNT (HTTP " + (d.upstream_tts_status || 401) + ") – auf dem Pi: sudo systemctl restart voicebox (lädt das Token neu), danach hier erneut testen.");
      else ttsLog("Selbsttest OK: Pi erreichbar, Token akzeptiert, " + (d.audio_bytes || "?") + " Byte Audio erzeugt. Jetzt kommt der Hörtest …");
    } else if (state.ttsUrl) {
      const r = await fetch(state.ttsUrl + "/health");
      const d = await r.json();
      ttsLog(r.ok ? "Selbsttest: Voicebox erreichbar, Stimmen: " + ((d.voices || []).join(", ") || "?") : "Selbsttest: Voicebox meldet HTTP " + r.status);
    }
  } catch (e) { ttsLog("Selbsttest fehlgeschlagen: " + String(e.message || e)); }
  speak("J.A.R.V.I.S Sprachausgabe-Test. Wenn du mich hörst, funktioniert die Stimme, Sir.");
}

/* ------------------------------------------------ STT (Spracheingabe) */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null, listening = false, micStarting = false, voiceSubmitted = false;

// Fragt die Mikrofon-Freigabe aktiv ab (Browser-Dialog), bevor erkannt wird.
async function requestMicPermission() {
  if (!window.isSecureContext) throw new Error("insecure");
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop()); // nur Freigabe holen, Aufnahme macht die Erkennung
  }
}

async function toggleMic() {
  unlockSpeech();
  const input = $("#chatInput");
  if (listening && recognition) { try { recognition.stop(); } catch { /* egal */ } return; }
  if (micStarting) return;

  if (!SR) {
    // Kein SpeechRecognition (manche Safari-Versionen): Tippen + iOS-Diktat der Tastatur gehen immer.
    addMsg("jarvis", "Dieser Browser unterstützt keine direkte Spracheingabe, Sir. Du kannst deine Frage einfach unten eintippen – oder auf der iOS-Tastatur das Mikrofon-Symbol nutzen.", "system");
    if (input) input.focus();
    return;
  }

  micStarting = true;
  voiceSubmitted = false;
  setOrb("listen", "Mikrofon-Freigabe wird angefragt …");
  try {
    stopSpeaking(); // nicht gleichzeitig sprechen und zuhören
    await requestMicPermission();
  } catch {
    micStarting = false;
    setOrb("idle", "Bereit, Sir.");
    addMsg("jarvis", "Ich darf das Mikrofon nicht nutzen, Sir. Bitte in Safari den Mikrofon-Zugriff für diese Seite erlauben (Adressleiste → Website-Einstellungen). Alternativ: Frage einfach unten eintippen.", "system");
    if (input) input.focus();
    return;
  }

  try {
    recognition = new SR();
    recognition.lang = "de-DE";
    recognition.interimResults = true;   // Live-Text im Eingabefeld zeigen
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      micStarting = false;
      listening = true;
      const btn = $("#btnMic"); if (btn) btn.classList.add("listening");
      setOrb("listen", "Ich höre zu – sprich jetzt …");
    };
    recognition.onend = () => {
      listening = false;
      micStarting = false;
      const btn = $("#btnMic"); if (btn) btn.classList.remove("listening");
      if (!voiceSubmitted) setOrb("idle", "Bereit, Sir.");
    };
    recognition.onerror = (e) => {
      const hints = {
        "not-allowed": "Mikrofon-Zugriff verweigert. Bitte in Safari für diese Seite erlauben – oder die Frage unten eintippen.",
        "service-not-allowed": "Der Sprachdienst ist auf diesem Gerät nicht erlaubt. Bitte Frage unten eintippen oder das iOS-Tastatur-Mikrofon nutzen.",
        "no-speech": "Ich habe nichts gehört, Sir. Tippe auf den Orb und sprich bitte noch einmal – oder tippe die Frage ein.",
        "audio-capture": "Kein Mikrofon gefunden, Sir. Bitte Frage unten eintippen.",
        network: "Die Spracherkennung braucht Internet. Bitte Verbindung prüfen oder die Frage eintippen.",
      };
      addMsg("jarvis", "Mikrofon: " + (hints[e.error] || ("Fehler (" + e.error + "). Bitte Frage unten eintippen.")), "system");
    };
    recognition.onresult = (e) => {
      let finalText = "", interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      const shown = (finalText || interim).trim();
      if (input && shown) input.value = shown; // sichtbar + per Tastatur änderbar
      if (finalText.trim() && !voiceSubmitted) {
        voiceSubmitted = true;
        setOrb("listen", "Frage erkannt – du kannst sie unten noch kurz korrigieren …");
        // Kurze Korrektur-Chance (Tippen), dann wird der Feldinhalt gesendet.
        setTimeout(() => {
          const text = input ? input.value.trim() : finalText.trim();
          if (input) input.value = "";
          try { if (recognition) recognition.stop(); } catch { /* egal */ }
          if (text) handleUserText(text);
        }, 900);
      }
    };
    recognition.start();
  } catch {
    micStarting = false;
    setOrb("idle", "Bereit, Sir.");
    addMsg("jarvis", "Die Spracheingabe konnte nicht starten, Sir. Bitte Frage einfach unten eintippen.", "system");
    if (input) input.focus();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const mic = $("#btnMic");
  if (mic) mic.addEventListener("click", toggleMic);
  // Pulsierender Orb = großer Mikrofon-Knopf (besonders auf iPad praktisch)
  const orbEl = $("#orb");
  if (orbEl) {
    orbEl.addEventListener("click", toggleMic);
    orbEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleMic(); }
    });
  }
  // Eingabefeld bleibt immer tippbar; auf iPad ins Sichtfeld holen, wenn die Tastatur aufgeht
  const input = $("#chatInput");
  if (input) input.addEventListener("focus", () =>
    setTimeout(() => { try { input.scrollIntoView({ block: "nearest" }); } catch { /* egal */ } }, 250));
});
