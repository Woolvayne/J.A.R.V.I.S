"""
J.A.R.V.I.S – Kostenlose LLM-Anbieter (Multi-Provider)

Reihenfolge (Fallback-Kette, alles kostenlos):
  1. Ollama (lokal, offline, kein Key) – http://localhost:11434
  2. Pollinations (Cloud, KEIN Key nötig) – https://text.pollinations.ai
  3. OpenRouter :free-Modelle (kostenloser Key, optional)
  4. Groq (kostenloser Key, optional)
  5. Google Gemini (kostenloser Key, optional)
  6. Demo-Modus (regelbasiert, offline, immer verfügbar)

Kein Anbieter ist Pflicht. Ohne Keys läuft JARVIS über Pollinations oder Demo.
"""
from __future__ import annotations

import os
import random
import re

import requests

SYSTEM_PROMPT = (
    "Du bist J.A.R.V.I.S (Just A Rather Very Intelligent System), ein höflicher, "
    "präziser KI-Assistent im Stil des Films. Antworte auf Deutsch, kurz und klar, "
    "maximal 3-4 Sätze, außer der Nutzer bittet um mehr. Sprich den Nutzer mit 'Sir' an, "
    "wenn es natürlich passt. Keine Markdown-Tabellen, keine Emojis."
)

TIMEOUT = 25


def _ollama(messages: list[dict], model: str, base: str) -> str:
    r = requests.post(
        f"{base.rstrip('/')}/api/chat",
        json={"model": model, "messages": messages, "stream": False},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return r.json()["message"]["content"].strip()


def _pollinations(messages: list[dict]) -> str:
    # Pollinations: GET https://text.pollinations.ai/{prompt}?model=openai
    # Wir bauen den Verlauf zu einem Prompt zusammen (einfach & keylos).
    convo = "\n".join(
        f"{'Assistent' if m['role'] == 'assistant' else 'Nutzer'}: {m['content']}"
        for m in messages[-6:]
    )
    prompt = f"{SYSTEM_PROMPT}\n\nUnterhaltung:\n{convo}\nAssistent:"
    r = requests.get(
        "https://text.pollinations.ai/" + requests.utils.quote(prompt, safe=""),
        params={"model": "openai", "seed": random.randint(1, 99999)},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return r.text.strip()


def _openai_compatible(messages: list[dict], base: str, key: str, model: str) -> str:
    r = requests.post(
        f"{base.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": model, "messages": messages, "max_tokens": 600, "temperature": 0.7},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"].strip()


def _gemini(messages: list[dict], key: str, model: str) -> str:
    text = "\n".join(f"{m['role']}: {m['content']}" for m in messages[-6:])
    r = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        params={"key": key},
        json={"contents": [{"parts": [{"text": text}]}]},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    data = r.json()
    return data["candidates"][0]["content"]["parts"][0]["text"].strip()


# ---------------------------------------------------------------- Demo-Modus
_DEMO = [
    ("hallo|hi|hey|guten tag|servus", "Guten Tag, Sir. Alle Systeme laufen nominal. Wie kann ich helfen?"),
    ("wie geht|status|system", "Alle Systeme sind einsatzbereit. CPU, Speicher und Netzwerk melden keine Anomalien."),
    ("wetter", "Für das Wetter nutze bitte das Wetter-Plugin – es lädt Live-Daten von Open-Meteo, ganz ohne API-Key."),
    ("witz|lustig", "Warum mögen Programmierer den Dunkelmodus? Weil Licht Bugs anzieht."),
    ("danke", "Sehr gern, Sir. Steht sonst noch etwas an?"),
    ("wer bist|was bist|jarvis", "Ich bin J.A.R.V.I.S – Just A Rather Very Intelligent System. Ihr persönlicher Assistent, komplett kostenlos betrieben."),
    ("zeit|uhr|spät", "Die Uhrzeit findest du oben im Dashboard. Ich halte sie stets aktuell."),
    ("hilfe|was kannst|befehle", "Ich verstehe Befehle wie 'Wetter in Berlin', 'Timer 5 Minuten', 'Rechne 12 mal 8', 'Suche nach Katzen' oder 'Öffne Notizen'. Oder schreibe einfach etwas – die KI antwortet."),
]

_FALLBACK = [
    "Verstanden, Sir. Ich habe das notiert. (Demo-Modus – für echte KI-Antworten Pollinations oder Ollama aktivieren.)",
    "Interessant. Im Demo-Modus kann ich nur vordefinierte Antworten geben. Aktiviere Ollama lokal oder Pollinations für volle Intelligenz – beides kostenlos.",
    "Notiert, Sir. Alle Kernfunktionen wie Wetter, Timer, Suche und Plugins funktionieren auch ohne KI-Anbieter.",
]


def _demo(messages: list[dict]) -> str:
    last = messages[-1]["content"].lower() if messages else ""
    for pat, ans in _DEMO:
        if re.search(pat, last):
            return ans
    return random.choice(_FALLBACK)


# ------------------------------------------------------------------- Routing
def chat(messages: list[dict]) -> dict:
    """Gibt {'text': ..., 'provider': ...} zurück. Wirft nie – Demo als letzter Fallback."""
    if not messages:
        return {"text": "Ich höre, Sir.", "provider": "demo"}

    # 1) Ollama lokal
    ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
    ollama_model = os.getenv("OLLAMA_MODEL", "llama3.1")
    try:
        return {"text": _ollama(messages, ollama_model, ollama_url), "provider": f"ollama:{ollama_model}"}
    except Exception:
        pass

    # 2) Pollinations (kein Key)
    try:
        return {"text": _pollinations(messages), "provider": "pollinations"}
    except Exception:
        pass

    # 3) OpenRouter :free
    if os.getenv("OPENROUTER_API_KEY"):
        try:
            return {
                "text": _openai_compatible(
                    messages,
                    "https://openrouter.ai/api/v1",
                    os.environ["OPENROUTER_API_KEY"],
                    os.getenv("OPENROUTER_MODEL", "openrouter/free"),
                ),
                "provider": "openrouter",
            }
        except Exception:
            pass

    # 4) Groq
    if os.getenv("GROQ_API_KEY"):
        try:
            return {
                "text": _openai_compatible(
                    messages,
                    "https://api.groq.com/openai/v1",
                    os.environ["GROQ_API_KEY"],
                    os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
                ),
                "provider": "groq",
            }
        except Exception:
            pass

    # 5) Gemini
    if os.getenv("GEMINI_API_KEY"):
        try:
            return {
                "text": _gemini(messages, os.environ["GEMINI_API_KEY"], os.getenv("GEMINI_MODEL", "gemini-2.0-flash")),
                "provider": "gemini",
            }
        except Exception:
            pass

    # 6) Demo
    return {"text": _demo(messages), "provider": "demo"}


def status() -> dict:
    """Welche Anbieter sind (vermutlich) verfügbar? Für die UI-Anzeige."""
    providers = []
    # Ollama: kurzer Check
    ollama_ok = False
    try:
        r = requests.get(os.getenv("OLLAMA_URL", "http://localhost:11434") + "/api/tags", timeout=2)
        ollama_ok = r.ok
    except Exception:
        pass
    providers.append({"name": "Ollama (lokal)", "available": ollama_ok, "key_needed": False})
    providers.append({"name": "Pollinations (Cloud, kein Key)", "available": True, "key_needed": False})
    providers.append({"name": "OpenRouter :free", "available": bool(os.getenv("OPENROUTER_API_KEY")), "key_needed": True})
    providers.append({"name": "Groq (Free Tier)", "available": bool(os.getenv("GROQ_API_KEY")), "key_needed": True})
    providers.append({"name": "Google Gemini (Free Tier)", "available": bool(os.getenv("GEMINI_API_KEY")), "key_needed": True})
    providers.append({"name": "Demo-Modus (offline)", "available": True, "key_needed": False})
    return {"providers": providers, "default_voice": os.getenv("TTS_VOICE", "de-DE-ConradNeural")}
