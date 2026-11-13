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

let currentAudio = null;
let speechUnlocked = false;
let deferredSpeech = "";
let speechRunId = 0;

/* ------------------------------------------------------- TTS (Ausgabe) */
async function speak(text) {
  if (!state.ttsOn || !text) return;
  const clean = text.replace(/[*_`#>]/g, "").slice(0, 900);
  // iOS blockt Audio ohne vorherige Nutzer-Geste: merken und beim ersten
  // Tippen/Klicken nachholen statt tonlos zu verpuffen.
  if (!speechUnlocked) { deferredSpeech = clean; return; }
  setOrb("speak", "J.A.R.V.I.S spricht …");
  try {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    if (state.backendUrl) {
      // Optionales Pi-Backend mit Edge TTS (bessere Stimme)
      const r = await fetch(state.backendUrl + "/api/tts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, voice: state.voice || "de-DE-ConradNeural" }),
      });
      if (!r.ok) throw new Error("tts fail");
      const url = URL.createObjectURL(await r.blob());
      currentAudio = new Audio(url);
      await new Promise((res, rej) => { currentAudio.onended = res; currentAudio.onerror = rej; currentAudio.play().catch(rej); });
      URL.revokeObjectURL(url);
    } else {
      await speakBrowser(clean);
    }
  } catch {
    await speakBrowser(clean).catch(() => {});
  } finally {
    setOrb("idle", "Bereit, Sir.");
  }
}

function stopSpeaking() {
  speechRunId++;
  try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch { /* egal */ }
  if (currentAudio) { try { currentAudio.pause(); } catch { /* egal */ } currentAudio = null; }
}

// Erste Nutzer-Geste entsperrt Audio auf iOS (Pflicht in Safari).
function unlockSpeech() {
  if (speechUnlocked) return;
  speechUnlocked = true;
  try {
    if (window.speechSynthesis) {
      speechSynthesis.resume();
      browserVoices(); // Stimmen schon mal laden (kommen auf iOS async)
      const pending = deferredSpeech;
      deferredSpeech = "";
      if (pending && state.ttsOn) { speak(pending); return; }
      if (!state.backendUrl) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        speechSynthesis.speak(u); // stummes "Aufwecken" der Engine
      }
    }
  } catch { /* Stimme ist optional */ }
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
      if (!window.speechSynthesis) { resolve(); return; }
      speechSynthesis.cancel();
      speechSynthesis.resume();
      const chunks = splitSpeechText(text);
      let idx = 0;
      const next = () => {
        if (run !== speechRunId || idx >= chunks.length) { resolve(); return; }
        const chunk = chunks[idx++];
        const u = new SpeechSynthesisUtterance(chunk);
        const voices = browserVoices();
        const langOf = (v) => String(v.lang || "").replace("_", "-").toLowerCase();
        const chosen = voices.find((v) => v.name === state.voice)
          || voices.find((v) => langOf(v) === "de-de")
          || voices.find((v) => langOf(v).startsWith("de"));
        if (chosen) { u.voice = chosen; u.lang = chosen.lang; } else { u.lang = "de-DE"; }
        u.rate = 0.98; u.pitch = 0.9;
        let done = false;
        const finish = () => { if (!done) { done = true; setTimeout(next, 40); } };
        u.onend = finish; u.onerror = finish;
        speechSynthesis.speak(u);
        // Sicherheitsnetz, falls Safari kein onend liefert
        setTimeout(finish, Math.min(12000, 1200 + chunk.length * 110));
      };
      setTimeout(next, 60); // kurz warten – Safari mag speak() direkt nach cancel() nicht
    } catch { resolve(); }
  });
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
