/* J.A.R.V.I.S – Voice:
 * Output: Pi Voicebox (Piper, British voice Alan) via Cloudflare/Vercel,
 *         browser voice (en-GB) as fallback. Input: Web Speech API (en-GB).
 *
 * iOS/Safari specifics handled here:
 * - Speech may only start after a user gesture -> the first touch unlocks
 *   audio (unlockSpeech); anything requested earlier is played afterwards.
 * - The voice test speaks FIRST (inside the tap) and runs its connection
 *   check afterwards – a 10-second check must not eat the tap permission,
 *   otherwise Safari silently swallows the test audio and replays it on
 *   some later tap.
 * - A newer answer always supersedes older, not-yet-played audio.
 * - Long texts are split into short sentences (Safari drops long ones).
 * - Microphone: tapping the pulsing orb (or the mic button) asks for the
 *   mic permission first, then starts recognition. The transcript lands
 *   in the input field (editable) and is sent from there. Typing works
 *   at any time. */
/* Note: $, API and state are defined centrally in app.js. */

let speechUnlocked = false;
let deferredSpeech = "";
let speechRunId = 0;
let audioEl = null;
const _utteranceRefs = []; // Safari GC would otherwise collect live utterances
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

// Small diagnostic log (shown in Settings)
const ttsEvents = [];
function ttsLog(msg) {
  const line = new Date().toLocaleTimeString("en-GB") + " " + msg;
  ttsEvents.unshift(line);
  if (ttsEvents.length > 7) ttsEvents.pop();
  try { console.log("[TTS]", msg); } catch { /* ignore */ }
  const el = document.querySelector("#ttsStatus");
  if (el) el.innerHTML = ttsEvents.map((e) => escapeHtml(e)).join("<br>");
}

// Reflect the active speech route in the top-bar pill (Pi Alan / browser).
function voicePill(mode) {
  const p = document.querySelector("#pillTTS");
  if (!p) return;
  if (mode === "pi") { p.textContent = "● Voice: Pi (Alan)"; p.className = "pill ok"; }
  else if (mode === "off") { p.textContent = "● Voice: off"; p.className = "pill warn"; }
  else { p.textContent = "● Voice: browser"; p.className = "pill warn"; }
}

// Make a TTS server error readable (e.g. "Voicebox HTTP 401: token ...")
async function ttsHttpError(r, label) {
  let detail = "";
  try {
    const t = await r.text();
    try { const j = JSON.parse(t); detail = [j.error, j.detail].filter(Boolean).join(" – "); }
    catch { detail = t.slice(0, 120); }
  } catch { /* ignore */ }
  return new Error(label + " HTTP " + r.status + (detail ? ": " + detail : ""));
}

/* ------------------------------------------------------- TTS (output) */
async function speak(text) {
  if (!state.ttsOn || !text) return;
  const clean = String(text).replace(/[*_`#>]/g, "").slice(0, 900);
  pendingAudioBlob = null; // a newer answer supersedes any older pending audio
  // iOS blocks audio without a prior gesture: remember and play on first tap
  if (!speechUnlocked) { deferredSpeech = clean; ttsLog("Waiting for first tap (iOS audio lock) …"); return; }
  setOrb("speak", "J.A.R.V.I.S is speaking …");
  let audioBlocked = false;
  try {
    if (state.ttsUrl) {
      // First choice: Pi Voicebox directly (URL set in Settings)
      const r = await fetch(state.ttsUrl + "/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(state.ttsToken ? { "X-Voice-Token": state.ttsToken } : {}) },
        body: JSON.stringify({ text: clean, voice: state.ttsVoice || undefined }),
      });
      if (!r.ok) throw await ttsHttpError(r, "Voicebox");
      await playAudioBlob(await r.blob());
      voicePill("pi");
      ttsLog("Pi Voicebox has spoken.");
    } else if (state.ttsServer) {
      // Voicebox configured centrally in Vercel – the token stays on the
      // server, the browser only calls /api/tts (nothing to type anywhere)
      const r = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, voice: state.ttsVoice || undefined }),
      });
      if (!r.ok) throw await ttsHttpError(r, "Voicebox (via Vercel)");
      await playAudioBlob(await r.blob());
      voicePill("pi");
      ttsLog("Pi Voicebox (via Vercel) has spoken.");
    } else {
      // Fallback: browser voice (en-GB)
      voicePill("browser");
      await speakBrowser(clean);
    }
  } catch (e) {
    if (e && e.message === "audio-blocked") { audioBlocked = true; return; } // plays on next tap – no second voice
    ttsLog("Server voice failed (" + String(e.message || e) + ") – using browser voice.");
    voicePill("browser");
    await speakBrowser(clean).catch(() => {});
  } finally {
    setOrb("idle", audioBlocked ? "Tap once – then I will read the answer aloud." : "Ready, Sir.");
  }
}

function getAudioEl() {
  if (!audioEl) { audioEl = new Audio(); audioEl.preload = "auto"; }
  return audioEl;
}

let pendingAudioBlob = null; // audio iOS only allows after the next tap

async function playAudioBlob(blob, isRetry) {
  const el = getAudioEl();
  const url = URL.createObjectURL(blob);
  el.src = url;
  el.volume = 1;
  ttsLog("Audio received (" + Math.round(blob.size / 1024) + " KB) – playing …");
  try { el.load(); } catch { /* ignore */ }
  const ended = new Promise((res) => { el.onended = res; el.onerror = res; });
  try {
    await el.play(); // allowed on iOS because the element was primed on first tap
    ttsLog("Playback running" + (isRetry ? " (after tap)" : "") + " …");
    await ended;
    ttsLog("Playback finished.");
  } catch (e) {
    // iOS refused play() without a fresh gesture (happens when the Pi took
    // a few seconds to generate). Keep THIS audio and play it on next tap;
    // do not start the browser voice on top of it.
    pendingAudioBlob = blob;
    ttsLog("iOS is still blocking the sound (" + String((e && e.name) || e) + ") – tap once, then I will speak.");
    setOrb("idle", "Tap once – then I will read the answer aloud.");
    throw new Error("audio-blocked");
  } finally { URL.revokeObjectURL(url); }
}

// The next tap plays audio that iOS had blocked (inside the gesture).
document.addEventListener("pointerdown", () => {
  if (!pendingAudioBlob) return;
  const blob = pendingAudioBlob;
  pendingAudioBlob = null;
  playAudioBlob(blob, true).catch(() => {});
}, { capture: true });

function stopSpeaking() {
  speechRunId++;
  try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch { /* ignore */ }
  if (audioEl) { try { audioEl.pause(); } catch { /* ignore */ } }
}

// The first user gesture unlocks audio on iOS (required by Safari).
// IMPORTANT: no blank "wake-up" utterance to speechSynthesis any more –
// on Safari that could jam the queue so nothing ever came out.
function unlockSpeech() {
  if (speechUnlocked) return;
  speechUnlocked = true;
  try {
    // Prime the HTML audio element with a silent WAV so server voices
    // (Voicebox) may also play later without a direct tap.
    const el = getAudioEl();
    el.src = SILENT_WAV;
    // Only pause if the silent WAV is still loaded – if real Voicebox
    // audio is already running, the prime promise must not stop it.
    el.play().then(() => { if (el.src === SILENT_WAV) { el.pause(); el.currentTime = 0; } }).catch(() => {});
  } catch { /* ignore */ }
  try {
    if (window.speechSynthesis) {
      speechSynthesis.resume();
      browserVoices(); // preload voices (arrive asynchronously on iOS)
    }
  } catch { /* voice is optional */ }
  const pending = deferredSpeech;
  deferredSpeech = "";
  if (pending && state.ttsOn) speak(pending); // deferred greeting/answer
  if (typeof fillVoiceOptions === "function") fillVoiceOptions();
}
["pointerdown", "touchend", "keydown"].forEach((ev) =>
  document.addEventListener(ev, unlockSpeech, { capture: true, passive: true }));

function browserVoices() {
  try { return speechSynthesis.getVoices(); } catch { return []; }
}
if (window.speechSynthesis && speechSynthesis.addEventListener) {
  try { speechSynthesis.addEventListener("voiceschanged", () => { if (typeof fillVoiceOptions === "function") fillVoiceOptions(); }); } catch { /* ignore */ }
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
      if (!window.speechSynthesis) { ttsLog("speechSynthesis is not available in this browser."); resolve(); return; }
      // Safari bug: cancel() right before speak() often drops the output
      // entirely – only cancel when something is actually running/queued.
      if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
      speechSynthesis.resume();
      const chunks = splitSpeechText(text);
      if (!chunks.length) { resolve(); return; }
      ttsLog("Browser voice: " + chunks.length + " sentence parts, " + browserVoices().length + " voices loaded.");
      let idx = 0;
      const next = () => {
        if (run !== speechRunId || idx >= chunks.length) { resolve(); return; }
        const chunk = chunks[idx++];
        const u = new SpeechSynthesisUtterance(chunk);
        _utteranceRefs.push(u); // keep a reference (Safari GC bug)
        const voices = browserVoices();
        const langOf = (v) => String(v.lang || "").replace("_", "-").toLowerCase();
        const chosen = voices.find((v) => v.name === state.voice)
          || voices.find((v) => langOf(v) === "en-gb")
          || voices.find((v) => langOf(v).startsWith("en"));
        if (chosen) { u.voice = chosen; u.lang = chosen.lang; } else { u.lang = "en-GB"; }
        u.rate = 1.0; u.pitch = 0.85;
        let done = false, started = false;
        const cleanup = () => { const i = _utteranceRefs.indexOf(u); if (i >= 0) _utteranceRefs.splice(i, 1); };
        const finish = () => { if (!done) { done = true; cleanup(); setTimeout(next, 40); } };
        u.onstart = () => { started = true; ttsLog("Speaking: \"" + chunk.slice(0, 40) + "…\""); };
        u.onend = finish;
        u.onerror = (e) => { ttsLog("Utterance error: " + (e.error || "?")); finish(); };
        speechSynthesis.speak(u);
        // Watchdog: no onstart and engine idle = Safari swallowed it
        // (happens without a fresh gesture). Keep the text – it is spoken
        // immediately on the next tap, inside that gesture.
        setTimeout(() => {
          if (!done && !started && run === speechRunId && !speechSynthesis.speaking && !speechSynthesis.pending) {
            ttsLog("Safari blocked the output – I will say it on your next tap.");
            deferredSpeech = chunks.slice(idx - 1).join(" ");
            speechUnlocked = false; // next touch re-runs unlockSpeech
            cleanup();
            setOrb("idle", "Tap once so I can read the answer aloud.");
            resolve();
          }
        }, 900);
        // Safety net in case Safari never fires onend
        setTimeout(finish, Math.min(12000, 1200 + chunk.length * 110));
      };
      setTimeout(next, 60);
    } catch (e) { ttsLog("speakBrowser error: " + String(e.message || e)); resolve(); }
  });
}

/* ------------------------------------------- Voice test + diagnostics */
// The test speaks IMMEDIATELY (inside the tap, so Safari allows the
// sound) – the connection check runs afterwards and only writes to the
// log. Previously the ~10 s check ran first and the test audio was
// silently parked, then replayed on some unrelated later tap.
function testVoice() {
  unlockSpeech();
  const engine = state.ttsUrl ? "Pi Voicebox" : state.ttsServer ? "Pi Voicebox (via Vercel)" : "Browser voice";
  ttsLog("Test started (" + engine + ", voice " + (state.ttsVoice || "?") + "). Speaking now – the Pi needs a few seconds …");
  speak("Good day, Sir. This is J.A.R.V.I.S. If you can hear me, the British voice is working.");
  diagnoseVoicebox(); // fire and forget – result lands in the log below
}

async function diagnoseVoicebox() {
  try {
    if (state.ttsServer && !state.ttsUrl) {
      const r = await fetch("/api/tts?check=" + Date.now(), { cache: "no-store" });
      const d = await r.json();
      if (!d.configured) ttsLog("Check: Voicebox is NOT configured in Vercel.");
      else if (!d.upstream_reachable) ttsLog("Check: Pi is NOT reachable via the Cloudflare tunnel – is the tunnel still running on the Pi?");
      else if (!d.token_accepted) ttsLog("Check: Pi reachable, but the TOKEN was rejected (HTTP " + (d.upstream_tts_status || 401) + "). The token in Vercel must match the Pi (voicebox.env).");
      else ttsLog("Check passed: Pi reachable, token accepted, " + (d.audio_bytes || "?") + " bytes of audio generated.");
    } else if (state.ttsUrl) {
      const r = await fetch(state.ttsUrl + "/health", { cache: "no-store" });
      const d = await r.json();
      ttsLog(r.ok ? "Check: Voicebox reachable, voices: " + ((d.voices || []).join(", ") || "?") : "Check: Voicebox answered HTTP " + r.status);
    }
  } catch (e) { ttsLog("Check failed: " + String(e.message || e)); }
}

/* ------------------------------------------------ STT (voice input) */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null, listening = false, micStarting = false, voiceSubmitted = false;

// Actively request microphone permission (browser dialog) before recognising.
async function requestMicPermission() {
  if (!window.isSecureContext) throw new Error("insecure");
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop()); // permission only; recognition does the recording
  }
}

async function toggleMic() {
  unlockSpeech();
  const input = $("#chatInput");
  if (listening && recognition) { try { recognition.stop(); } catch { /* ignore */ } return; }
  if (micStarting) return;

  if (!SR) {
    // No SpeechRecognition (some Safari versions): typing + iOS keyboard dictation always work.
    addMsg("jarvis", "This browser does not support direct voice input, Sir. You can simply type your question below – or use the microphone key on the iOS keyboard.", "system");
    if (input) input.focus();
    return;
  }

  micStarting = true;
  voiceSubmitted = false;
  setOrb("listen", "Requesting microphone permission …");
  try {
    stopSpeaking(); // never speak and listen at the same time
    await requestMicPermission();
  } catch {
    micStarting = false;
    setOrb("idle", "Ready, Sir.");
    addMsg("jarvis", "I am not allowed to use the microphone, Sir. Please allow microphone access for this site in Safari (address bar, Website Settings). Alternatively, simply type your question below.", "system");
    if (input) input.focus();
    return;
  }

  try {
    recognition = new SR();
    recognition.lang = "en-GB";
    recognition.interimResults = true;   // live text in the input field
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      micStarting = false;
      listening = true;
      const btn = $("#btnMic"); if (btn) btn.classList.add("listening");
      setOrb("listen", "Listening – speak now …");
    };
    recognition.onend = () => {
      listening = false;
      micStarting = false;
      const btn = $("#btnMic"); if (btn) btn.classList.remove("listening");
      if (!voiceSubmitted) setOrb("idle", "Ready, Sir.");
    };
    recognition.onerror = (e) => {
      const hints = {
        "not-allowed": "Microphone access denied. Please allow it for this site in Safari – or type your question below.",
        "service-not-allowed": "The speech service is not allowed on this device. Please type below or use the iOS keyboard microphone.",
        "no-speech": "I heard nothing, Sir. Tap the orb and speak once more – or type the question.",
        "audio-capture": "No microphone found, Sir. Please type your question below.",
        network: "Speech recognition needs an internet connection. Please check it or type the question.",
      };
      addMsg("jarvis", "Microphone: " + (hints[e.error] || ("error (" + e.error + "). Please type your question below.")), "system");
    };
    recognition.onresult = (e) => {
      let finalText = "", interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interim += t;
      }
      const shown = (finalText || interim).trim();
      if (input && shown) input.value = shown; // visible and editable by keyboard
      if (finalText.trim() && !voiceSubmitted) {
        voiceSubmitted = true;
        setOrb("listen", "Heard you – you can still correct it below …");
        // Brief moment to correct by typing, then the field content is sent.
        setTimeout(() => {
          const text = input ? input.value.trim() : finalText.trim();
          if (input) input.value = "";
          try { if (recognition) recognition.stop(); } catch { /* ignore */ }
          if (text) handleUserText(text);
        }, 900);
      }
    };
    recognition.start();
  } catch {
    micStarting = false;
    setOrb("idle", "Ready, Sir.");
    addMsg("jarvis", "Voice input could not start, Sir. Please simply type your question below.", "system");
    if (input) input.focus();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const mic = $("#btnMic");
  if (mic) mic.addEventListener("click", toggleMic);
  // The pulsing orb is the big microphone button (handy on iPad)
  const orbEl = $("#orb");
  if (orbEl) {
    orbEl.addEventListener("click", toggleMic);
    orbEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleMic(); }
    });
  }
  // The input field stays typable; scroll it into view when the keyboard opens
  const input = $("#chatInput");
  if (input) input.addEventListener("focus", () =>
    setTimeout(() => { try { input.scrollIntoView({ block: "nearest" }); } catch { /* ignore */ } }, 250));
});
