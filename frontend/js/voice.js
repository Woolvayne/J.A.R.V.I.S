/* J.A.R.V.I.S – Stimme ohne Backend:
 * Standard: Browser-Stimme (speechSynthesis, kostenlos, offline im Browser).
 * Optional: Edge TTS, wenn in den Einstellungen eine Pi-Backend-URL gesetzt
 * ist (dort läuft weiter backend/tts.py). STT: Web Speech API (de-DE). */
/* Hinweis: $ , API und state werden zentral in app.js definiert. */

let currentAudio = null;

async function speak(text) {
  if (!state.ttsOn || !text) return;
  const clean = text.replace(/[*_`#>]/g, "").slice(0, 900);
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

function browserVoices() {
  try { return speechSynthesis.getVoices(); } catch { return []; }
}

function speakBrowser(text) {
  return new Promise((resolve) => {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voices = browserVoices();
      const chosen = voices.find((v) => v.name === state.voice)
        || voices.find((v) => v.lang === "de-DE")
        || voices.find((v) => v.lang && v.lang.startsWith("de"));
      if (chosen) { u.voice = chosen; u.lang = chosen.lang; } else { u.lang = "de-DE"; }
      u.rate = 0.98; u.pitch = 0.9;
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      u.onend = finish; u.onerror = finish;
      speechSynthesis.speak(u);
      setTimeout(finish, Math.min(15000, 1500 + text.length * 95)); // Sicherheitsnetz
    } catch { resolve(); }
  });
}

/* ------------------------------------------------ STT (Spracheingabe) */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null, listening = false;

function toggleMic() {
  if (!SR) {
    addMsg("jarvis", "Spracheingabe wird von diesem Browser nicht unterstützt. Bitte Chrome oder Edge nutzen – die Web Speech API ist kostenlos und braucht keinen Key.", "system");
    return;
  }
  if (listening) { recognition.stop(); return; }
  recognition = new SR();
  recognition.lang = "de-DE";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    listening = true;
    $("#btnMic").classList.add("listening");
    setOrb("listen", "Ich höre zu …");
  };
  recognition.onend = () => {
    listening = false;
    $("#btnMic").classList.remove("listening");
    setOrb("idle", "Bereit, Sir.");
  };
  recognition.onerror = (e) => {
    addMsg("jarvis", "Mikrofon-Fehler: " + e.error + ". Bitte Mikrofon-Zugriff erlauben.", "system");
  };
  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript.trim();
    if (text) { $("#chatInput").value = text; handleUserText(text); }
  };
  recognition.start();
}

document.addEventListener("DOMContentLoaded", () => {
  $("#btnMic").addEventListener("click", toggleMic);
});
