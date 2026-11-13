#!/usr/bin/env bash
# ============================================================
# J.A.R.V.I.S – Lokales Mini-Modell auf dem Raspberry Pi 3B+
# (Ollama + Tiny-Modell, offline, MIT MCP-Tool-Calling)
#
#   ./install-ollama-pi.sh                -> qwen2.5:0.5b (empfohlen, schnellste Wahl)
#   ./install-ollama-pi.sh llama3.2:1b    -> besseres Tool-Calling, langsamer/enger RAM
#   ./install-ollama-pi.sh qwen2.5:1.5b   -> nur mit gutem Netzteil/Kühlung testen
#
# Realistische Erwartung (Pi 3B+, 4x Cortex-A53, 1 GB RAM):
#   0.5B-Modell: grob 3–6 Token/s, Antwort in ~10–30 s, RAM ~400–500 MB
#   1B-Modell:   grob 1–3 Token/s, deutlich langsamer, RAM sehr eng
# Für flüssige Antworten bleibt Groq (Cloud, gratis) die Empfehlung –
# lokal ist der Offline-/Datenschutz-Modus.
# ============================================================
set -e
cd "$(dirname "$0")"
MODEL="${1:-qwen2.5:0.5b}"

echo "=== JARVIS lokales Mini-Modell: $MODEL ==="

# 1) Ollama installieren (offizielles Skript, richtet systemd-Dienst ein) -----
if ! command -v ollama >/dev/null 2>&1; then
  echo "→ Installiere Ollama (offizielles Skript) …"
  curl -fsSL https://ollama.com/install.sh | sh
else
  echo "✓ Ollama bereits installiert: $(ollama --version 2>/dev/null || echo '?')"
fi

# 2) Pi-schonende Dienst-Einstellungen: nur 1 Modell, nur 1 Anfrage parallel,
#    Modell nach 2 Min Inaktivität aus dem RAM entladen (JARVIS braucht den Rest)
if command -v systemctl >/dev/null 2>&1; then
  echo "→ Setze Pi-Limits für den Ollama-Dienst …"
  sudo mkdir -p /etc/systemd/system/ollama.service.d
  sudo tee /etc/systemd/system/ollama.service.d/jarvis-pi.conf >/dev/null <<'EOF'
[Service]
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_KEEP_ALIVE=2m"
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now ollama
  sudo systemctl restart ollama
fi

# 3) Modell laden (einmaliger Download aus dem Netz, danach offline) ----------
echo "→ Lade Modell $MODEL (einmalig, danach offline nutzbar) …"
ollama pull "$MODEL"

# 4) JARVIS-Konfiguration vorschlagen -----------------------------------------
echo ""
echo "============================================================"
echo "✓ Lokales Modell bereit. Jetzt in .env eintragen:"
echo ""
echo "  ENABLE_OLLAMA=1"
echo "  OLLAMA_MODEL=$MODEL"
echo "  LLM_ORDER=ollama,groq,demo     # lokal zuerst, Groq als Backup"
echo "  OLLAMA_TIMEOUT=120             # lokale Antworten brauchen Zeit"
echo ""
echo "Danach:  sudo systemctl restart jarvis"
echo "Test:    ollama run $MODEL \"Hallo, wer bist du?\""
echo "         curl localhost:11434/api/tags"
echo ""
echo "MCP funktioniert automatisch: Die in mcp_servers.json aktivierten"
echo "Tools bekommt auch das lokale Modell (qwen2.5/llama3.2 können"
echo "Tool-Calling). Tiny-Modelle wählen Tools manchmal unsicher –"
echo "für kritische Aktionen ist Groq zuverlässiger."
echo "============================================================"
