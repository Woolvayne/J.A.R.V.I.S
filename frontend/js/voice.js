/* J.A.R.V.I.S – Stimme: Edge TTS (Backend) + Browser-Fallback, STT via Web Speech API */
/* Hinweis: $ , API und state werden zentral in app.js definiert (wird zuerst geladen). */

let currentAudio = null;

async function speak(text) {
  if (!state.ttsOn || !text) return;
  const clean = text.replace(/[*_`#>\-]/g, "").slice(0, 900);
  setOrb("speak", "J.A.R.V.I.S spricht …");
  try {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    if (state.backend) {
      const r = await fetch(API + "/api/tts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, voice: state.voice }),
      });
      if (!r.ok) throw new Error("tts fail");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      currentAudio = new Audio(url);
      await new Promise((res, rej) => { currentAudio.onended = res; currentAudio.onerror = rej; currentAudio.play().catch(rej); });
      URL.revokeObjectURL(url);
    } else {
      speakBrowser(clean);
      await new Promise((r) => setTimeout(r, Math.min(6000, clean.length * 55)));
    }
  } catch {
    speakBrowser(clean);
    await new Promise((r) => setTimeout(r, Math.min(6000, clean.length * 55)));
  } finally {
    setOrb("idle", "Bereit, Sir.");
  }
}

function speakBrowser(text) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = state.voice.startsWith("de") ? "de-DE" : "en-GB";
    u.rate = 0.95; u.pitch = 0.9;
    const v = speechSynthesis.getVoices().find((x) => x.lang === u.lang);
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch { /* still */ }
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
