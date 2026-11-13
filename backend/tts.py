"""
J.A.R.V.I.S – Edge TTS (Microsoft Edge Neural Voices, kostenlos, kein API-Key)

Nutzt die edge-tts Python-Bibliothek (Open Source, rany2/edge-tts).
Stimmen: de-DE-ConradNeural (männlich, JARVIS-ähnlich), de-DE-KatjaNeural,
en-GB-RyanNeural, en-US-GuyNeural, en-US-AriaNeural u.v.m. (300+ Stimmen).

Doku: https://github.com/rany2/edge-tts
"""
from __future__ import annotations

import asyncio
import io
import os

# Kuratierte Stimmenliste für die UI (de + en)
VOICES = [
    {"id": "de-DE-ConradNeural", "label": "Conrad – Deutsch (männlich, JARVIS)", "lang": "de"},
    {"id": "de-DE-KatjaNeural", "label": "Katja – Deutsch (weiblich)", "lang": "de"},
    {"id": "de-DE-FlorianMultilingualNeural", "label": "Florian – Deutsch (männlich)", "lang": "de"},
    {"id": "de-DE-KillianNeural", "label": "Killian – Deutsch (männlich)", "lang": "de"},
    {"id": "en-GB-RyanNeural", "label": "Ryan – Englisch UK (männlich)", "lang": "en"},
    {"id": "en-GB-SoniaNeural", "label": "Sonia – Englisch UK (weiblich)", "lang": "en"},
    {"id": "en-US-GuyNeural", "label": "Guy – Englisch US (männlich)", "lang": "en"},
    {"id": "en-US-AriaNeural", "label": "Aria – Englisch US (weiblich)", "lang": "en"},
]


async def _synth(text: str, voice: str, rate: str) -> bytes:
    import edge_tts  # erst hier importieren, damit der Server auch ohne Paket startet

    communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate)
    buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    return buf.getvalue()


def synthesize(text: str, voice: str | None = None, rate: str | None = None) -> bytes:
    """Text -> MP3-Bytes. Wirft bei Fehlern (Server antwortet dann 502)."""
    voice = voice or os.getenv("TTS_VOICE", "de-DE-ConradNeural")
    rate = rate or os.getenv("TTS_RATE", "-5%")
    # Edge TTS mag keine allzu langen Texte in einem Rutsch
    text = text.strip()[:1200]
    if not text:
        raise ValueError("Leerer Text")
    return asyncio.run(_synth(text, voice, rate))
