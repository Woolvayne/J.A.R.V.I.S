"""
J.A.R.V.I.S – Kostenlose Cloud-KI (Multi-Provider, Pi-optimiert)

Auf dem Raspberry Pi 3B+ läuft KEIN lokales LLM (1 GB RAM) – die Intelligenz
kommt aus der Cloud, der Pi macht nur Dashboard, Stimme und MCP-Brücke.

Empfohlene Reihenfolge (alle kostenlos, ohne Download, nur API-Key):
  1. Groq       – ⭐ EMPFEHLUNG: extrem schnell, Free Tier ohne Kreditkarte,
                  Llama 3.3 70B, natives Tool-Calling -> ideal für MCP + Sprache
  2. Gemini     – Google, sehr großzügiges Free Tier, Tool-Calling inklusive
  3. Cerebras   – optional, sehr schnell (Free/Developer Tier)
  4. Mistral    – optional, EU-Anbieter, Experiment-Plan kostenlos
  5. OpenRouter – optional, viele :free-Modelle mit einem Key
  6. Pollinations – keyloser Notfall-Fallback (kein Tool-Calling)
  7. Demo-Modus – regelbasiert, offline, immer verfügbar

Ollama (lokal) ist optional: Auf dem Pi 3B+ laufen nur Tiny-Modelle sinnvoll
(qwen2.5:0.5b, llama3.2:1b) – langsam, aber offline UND mit MCP-Tool-Calling.
Aktivierung: ./install-ollama-pi.sh, ENABLE_OLLAMA=1, LLM_ORDER z. B.
LLM_ORDER=ollama,groq,demo (lokal zuerst, Cloud als Backup).

Reihenfolge per LLM_ORDER änderbar, z. B. LLM_ORDER=gemini,groq,demo
MCP-Tools werden automatisch genutzt, wenn der Anbieter Tool-Calling kann
(Groq, Gemini, Cerebras, Mistral, OpenRouter und Ollama mit Tool-Modellen).
"""
from __future__ import annotations

import json
import os
import random
import re

import requests

SYSTEM_PROMPT = (
    "Du bist J.A.R.V.I.S (Just A Rather Very Intelligent System), ein höflicher, "
    "präziser KI-Assistent im Stil des Films. Antworte auf Deutsch, kurz und klar, "
    "maximal 3-4 Sätze, außer der Nutzer bittet um mehr. Sprich den Nutzer mit 'Sir' an, "
    "wenn es natürlich passt. Keine Markdown-Tabellen, keine Emojis. "
    "Wenn dir Tools zur Verfügung stehen, nutze sie für aktuelle/faktische Informationen, "
    "statt zu raten, und fasse das Ergebnis danach natürlich zusammen."
)

TIMEOUT = float(os.getenv("LLM_TIMEOUT", "25"))
MAX_TOOL_ROUNDS = 3

# ------------------------------------------------------------- Anbieter-Definitionen
# OpenAI-kompatible Anbieter (alle unterstützen /chat/completions + Tool-Calling)
_OPENAI_PROVIDERS = {
    "groq": {
        "name": "Groq (Free Tier) ⭐",
        "base": "https://api.groq.com/openai/v1",
        "key_env": "GROQ_API_KEY",
        "model_env": "GROQ_MODEL",
        "default_model": "llama-3.3-70b-versatile",
        "tools": True,
        "recommended": True,
        "note": "Empfehlung für den Pi: sehr schnell, kostenlos, kein Download",
    },
    "gemini": {
        "name": "Google Gemini (Free Tier)",
        "base": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "key_env": "GEMINI_API_KEY",
        "model_env": "GEMINI_MODEL",
        "default_model": "gemini-2.5-flash",
        "tools": True,
        "recommended": False,
        "note": "Sehr großzügiges Free Tier, 1M Kontext",
    },
    "cerebras": {
        "name": "Cerebras (Free/Dev Tier)",
        "base": "https://api.cerebras.ai/v1",
        "key_env": "CEREBRAS_API_KEY",
        "model_env": "CEREBRAS_MODEL",
        "default_model": "llama-3.3-70b",
        "tools": True,
        "recommended": False,
        "note": "Extrem schnelle Inferenz, Kontingent im Dashboard prüfen",
    },
    "mistral": {
        "name": "Mistral (Experiment, kostenlos)",
        "base": "https://api.mistral.ai/v1",
        "key_env": "MISTRAL_API_KEY",
        "model_env": "MISTRAL_MODEL",
        "default_model": "mistral-small-latest",
        "tools": True,
        "recommended": False,
        "note": "EU-Anbieter, kostenloser Experiment-Plan (Telefon-Verifizierung)",
    },
    "openrouter": {
        "name": "OpenRouter :free",
        "base": "https://openrouter.ai/api/v1",
        "key_env": "OPENROUTER_API_KEY",
        "model_env": "OPENROUTER_MODEL",
        "default_model": "openrouter/free",
        "tools": True,
        "recommended": False,
        "note": "Viele Gratis-Modelle, Free-Limit ohne Guthaben klein (50/Tag)",
    },
}

DEFAULT_ORDER = "groq,gemini,cerebras,mistral,openrouter,pollinations,demo"


def _order() -> list[str]:
    order = [p.strip().lower() for p in os.getenv("LLM_ORDER", DEFAULT_ORDER).split(",") if p.strip()]
    if os.getenv("ENABLE_OLLAMA", "0").lower() in ("1", "true", "yes") and "ollama" not in order:
        order.insert(0, "ollama")  # nur wenn ausdrücklich aktiviert (Mini-Modell, siehe install-ollama-pi.sh)
    if "demo" not in order:
        order.append("demo")
    return order


def _normalize(messages: list[dict]) -> list[dict]:
    clean = [m for m in messages if m.get("role") != "system"][-8:]
    return [{"role": "system", "content": SYSTEM_PROMPT}] + clean


# ------------------------------------------------------------------ Aufrufe
def _openai_chat(pid: str, cfg: dict, messages: list[dict],
                 tools: list[dict] | None, tool_executor) -> tuple[str, list[str]]:
    """Chat mit optionalem Tool-Calling-Loop. Gibt (Text, genutzte Tools) zurück."""
    key = os.environ[cfg["key_env"]]
    model = os.getenv(cfg["model_env"], cfg["default_model"])
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if pid == "openrouter":
        headers["X-Title"] = "JARVIS-Pi"
    msgs = _normalize(messages)
    used: list[str] = []
    use_tools = bool(tools and tool_executor and cfg.get("tools"))
    for _round in range(MAX_TOOL_ROUNDS + 1):
        payload = {"model": model, "messages": msgs, "max_tokens": 700, "temperature": 0.7}
        if use_tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        r = requests.post(f"{cfg['base'].rstrip('/')}/chat/completions",
                          headers=headers, json=payload, timeout=TIMEOUT)
        r.raise_for_status()
        msg = r.json()["choices"][0]["message"]
        tool_calls = msg.get("tool_calls") or []
        if not (use_tools and tool_calls):
            return (msg.get("content") or "").strip(), used
        msgs.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": tool_calls})
        for tc in tool_calls:
            fn = (tc.get("function") or {})
            name = fn.get("name", "")
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except Exception:
                args = {}
            result = tool_executor(name, args)  # MCP-Aufruf (wirft nicht)
            used.append(name)
            msgs.append({"role": "tool", "tool_call_id": tc.get("id", name), "content": str(result)[:6000]})
    return "Die Tool-Aufrufe haben zu viele Runden benötigt, Sir.", used


def _pollinations(messages: list[dict]) -> str:
    convo = "\n".join(
        f"{'Assistent' if m['role'] == 'assistant' else 'Nutzer'}: {m['content']}"
        for m in _normalize(messages)[-6:]
    )
    prompt = f"{SYSTEM_PROMPT}\n\nUnterhaltung:\n{convo}\nAssistent:"
    r = requests.get(
        "https://text.pollinations.ai/" + requests.utils.quote(prompt, safe=""),
        params={"model": "openai", "seed": random.randint(1, 99999)},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return r.text.strip()


def _ollama_enabled() -> bool:
    return os.getenv("ENABLE_OLLAMA", "0").lower() in ("1", "true", "yes")


def _ollama_chat(messages: list[dict], tools: list[dict] | None,
                 tool_executor) -> tuple[str, list[str]]:
    """Lokales Mini-Modell per Ollama – MIT MCP-Tool-Calling.

    Für den Pi 3B+ nur Tiny-Modelle (Default qwen2.5:0.5b). Unterstützte
    Modelle (z. B. qwen2.5, llama3.2) liefern message.tool_calls zurück.
    Lokale Inferenz ist langsam -> großzügiges OLLAMA_TIMEOUT (Standard 120 s).
    """
    base = os.getenv("OLLAMA_URL", "http://localhost:11434")
    model = os.getenv("OLLAMA_MODEL", "qwen2.5:0.5b")
    timeout = float(os.getenv("OLLAMA_TIMEOUT", "120"))
    msgs = _normalize(messages)
    used: list[str] = []
    use_tools = bool(tools and tool_executor)
    for _round in range(MAX_TOOL_ROUNDS + 1):
        payload: dict = {"model": model, "messages": msgs, "stream": False}
        if use_tools:
            payload["tools"] = tools
        r = requests.post(f"{base.rstrip('/')}/api/chat", json=payload, timeout=timeout)
        r.raise_for_status()
        msg = r.json().get("message", {})
        tool_calls = msg.get("tool_calls") or []
        if not (use_tools and tool_calls):
            return (msg.get("content") or "").strip(), used
        msgs.append({"role": "assistant", "content": msg.get("content") or "",
                     "tool_calls": tool_calls})
        for tc in tool_calls:
            fn = tc.get("function") or {}
            name = fn.get("name", "")
            args = fn.get("arguments") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args or "{}")
                except Exception:
                    args = {}
            result = tool_executor(name, args)  # MCP-Aufruf (wirft nicht)
            used.append(name)
            msgs.append({"role": "tool", "content": str(result)[:6000]})
    return "Die Tool-Aufrufe haben zu viele Runden benötigt, Sir.", used


# ---------------------------------------------------------------- Demo-Modus
_DEMO = [
    ("hallo|hi|hey|guten tag|servus", "Guten Tag, Sir. Alle Systeme laufen nominal. Wie kann ich helfen?"),
    ("wie geht|status|system", "Alle Systeme sind einsatzbereit. CPU, Speicher und Netzwerk melden keine Anomalien."),
    ("wetter", "Für das Wetter nutze bitte das Wetter-Plugin – es lädt Live-Daten von Open-Meteo, ganz ohne API-Key."),
    ("witz|lustig", "Warum mögen Programmierer den Dunkelmodus? Weil Licht Bugs anzieht."),
    ("danke", "Sehr gern, Sir. Steht sonst noch etwas an?"),
    ("wer bist|was bist|jarvis", "Ich bin J.A.R.V.I.S – Ihr Assistent auf einem Raspberry Pi, mit kostenloser Cloud-KI und MCP-Plugins."),
    ("zeit|uhr|spät", "Die Uhrzeit findest du oben im Dashboard. Ich halte sie stets aktuell."),
    ("hilfe|was kannst|befehle", "Ich verstehe Befehle wie 'Wetter in Berlin', 'Timer 5 Minuten', 'Rechne 12 mal 8', 'Suche nach Katzen' oder 'Öffne Notizen'. Für echte KI: kostenlosen GROQ_API_KEY in die .env eintragen."),
    ("mcp|tool|plugin", "Meine MCP-Tools siehst du im MCP-Plugin (🔌). Server werden in mcp_servers.json aktiviert – dann kann die KI sie automatisch nutzen."),
]

_FALLBACK = [
    "Verstanden, Sir. (Demo-Modus – für echte KI-Antworten kostenlosen Groq-Key in die .env eintragen: console.groq.com)",
    "Notiert, Sir. Tipp: Mit GROQ_API_KEY in der .env antworte ich als echte KI – kostenlos und ohne Download.",
    "Alle Kernfunktionen wie Wetter, Timer, Suche, Plugins und MCP funktionieren auch ohne KI-Key.",
]


def _demo(messages: list[dict]) -> str:
    last = messages[-1]["content"].lower() if messages else ""
    for pat, ans in _DEMO:
        if re.search(pat, last):
            return ans
    return random.choice(_FALLBACK)


# ------------------------------------------------------------------- Routing
def chat(messages: list[dict], tools: list[dict] | None = None, tool_executor=None) -> dict:
    """
    Gibt {'text', 'provider', 'tools_used'} zurück. Wirft nie.
    tools/tool_executor: MCP-Tools (OpenAI-Format) + Ausführungs-Funktion.
    """
    if not messages:
        return {"text": "Ich höre, Sir.", "provider": "demo", "tools_used": []}

    for pid in _order():
        try:
            if pid in _OPENAI_PROVIDERS:
                cfg = _OPENAI_PROVIDERS[pid]
                if not os.getenv(cfg["key_env"]):
                    continue
                text, used = _openai_chat(pid, cfg, messages, tools, tool_executor)
                if text:
                    return {"text": text, "provider": pid, "tools_used": used}
            elif pid == "pollinations":
                text = _pollinations(messages)
                if text:
                    return {"text": text, "provider": "pollinations", "tools_used": []}
            elif pid == "ollama":
                if not _ollama_enabled():
                    continue
                text, used = _ollama_chat(messages, tools, tool_executor)
                if text:
                    return {"text": text, "provider": "ollama", "tools_used": used}
            elif pid == "demo":
                return {"text": _demo(messages), "provider": "demo", "tools_used": []}
        except Exception:
            continue  # nächster Anbieter in der Kette
    return {"text": _demo(messages), "provider": "demo", "tools_used": []}


def status() -> dict:
    """Anbieter-Status für die UI (ohne Netz-Checks – schont den Pi)."""
    providers = []
    for pid in _order():
        if pid in _OPENAI_PROVIDERS:
            cfg = _OPENAI_PROVIDERS[pid]
            providers.append({
                "id": pid, "name": cfg["name"],
                "available": bool(os.getenv(cfg["key_env"])),
                "key_needed": True, "tools": cfg["tools"],
                "recommended": cfg["recommended"], "note": cfg["note"],
                "model": os.getenv(cfg["model_env"], cfg["default_model"]),
            })
        elif pid == "pollinations":
            providers.append({"id": pid, "name": "Pollinations (Cloud, kein Key)", "available": True,
                              "key_needed": False, "tools": False, "recommended": False,
                              "note": "Keyloser Notfall-Fallback", "model": "openai"})
        elif pid == "ollama":
            on = _ollama_enabled()
            providers.append({"id": pid, "name": "Ollama (lokal, Mini-Modell)", "available": on,
                              "key_needed": False, "tools": True, "recommended": False,
                              "note": "Offline auf dem Pi, inkl. MCP-Tools. Nur Tiny-Modelle (qwen2.5:0.5b / llama3.2:1b), langsam. Aktivieren: ENABLE_OLLAMA=1 + ./install-ollama-pi.sh",
                              "model": os.getenv("OLLAMA_MODEL", "qwen2.5:0.5b")})
        elif pid == "demo":
            providers.append({"id": pid, "name": "Demo-Modus (offline)", "available": True,
                              "key_needed": False, "tools": False, "recommended": False,
                              "note": "Regelbasiert, immer verfügbar", "model": "-"})
    return {"providers": providers, "order": _order(),
            "default_voice": os.getenv("TTS_VOICE", "de-DE-ConradNeural")}
