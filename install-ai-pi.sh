#!/usr/bin/env bash
# Install the J.A.R.V.I.S "AI Box" on the Raspberry Pi: Ollama + a tiny
# tool-capable model + the token-guarded gateway (aibox) on 127.0.0.1:8771.
# JARVIS on Vercel uses it automatically as its fallback brain when Groq
# is unreachable – including MCP tools (Composio). Expose it afterwards
# via a Cloudflare Tunnel (see AIBOX.md) – never via port forwarding.
# Default model: qwen3:0.6b (fits the Pi 3B+ with 1 GB RAM, can call
# tools). Override: AIBOX_MODEL=llama3.2:1b ./install-ai-pi.sh
set -e

INSTALL_DIR=/opt/aibox
# Remember the absolute repo path – relative cp paths would break later.
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MODEL=${AIBOX_MODEL:-qwen3:0.6b}

echo "== J.A.R.V.I.S AI Box (Ollama fallback brain) installation =="

if ! command -v ollama >/dev/null 2>&1; then
  echo "-- Installing Ollama …"
  curl -fsSL https://ollama.com/install.sh | sh
fi

echo "-- Configuring Ollama for the Pi (one small model, one request) …"
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/jarvis-pi.conf >/dev/null <<'EOF'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_KEEP_ALIVE=5m"
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now ollama
sudo systemctl restart ollama

echo "-- Waiting for Ollama …"
for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
  sleep 1
done
curl -s http://127.0.0.1:11434/api/tags >/dev/null || { echo "Ollama did not come up – check: sudo systemctl status ollama"; exit 1; }

echo "-- Downloading tiny model ($MODEL, a few hundred MB) …"
ollama pull "$MODEL"

echo "-- Installing AI Box gateway …"
sudo mkdir -p "$INSTALL_DIR"
sudo cp "$SCRIPT_DIR/aibox/aibox.py" "$INSTALL_DIR/aibox.py"

if [ ! -f "$INSTALL_DIR/aibox.env" ]; then
  TOKEN=$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')
  sudo tee "$INSTALL_DIR/aibox.env" >/dev/null <<EOF
AIBOX_HOST=127.0.0.1
AIBOX_PORT=8771
AIBOX_TOKEN=$TOKEN
AIBOX_MODEL=$MODEL
OLLAMA_URL=http://127.0.0.1:11434
EOF
  sudo chmod 600 "$INSTALL_DIR/aibox.env"
  echo ">> Your AI Box token (goes into Vercel as PI_AI_TOKEN): $TOKEN"
else
  echo ">> Existing aibox.env found (token in it unchanged)."
  sudo sed -i "s/^AIBOX_MODEL=.*/AIBOX_MODEL=$MODEL/" "$INSTALL_DIR/aibox.env"
fi

sudo cp "$SCRIPT_DIR/deploy/aibox.service" /etc/systemd/system/aibox.service
sudo systemctl daemon-reload
sudo systemctl enable --now aibox
sudo systemctl restart aibox

sleep 2
echo "-- Test 1/3: health"
curl -s http://127.0.0.1:8771/health || echo "(gateway needs a moment – 'sudo systemctl status aibox')"
echo
echo "-- Test 2/3: a spoken-style answer (can take ~20 s on a Pi 3B+)"
curl -s http://127.0.0.1:8771/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-AI-Token: $(sudo grep ^AIBOX_TOKEN= /opt/aibox/aibox.env | cut -d= -f2)" \
  -d "{\"model\":\"$MODEL\",\"max_tokens\":40,\"messages\":[{\"role\":\"user\",\"content\":\"Say: At your service, Sir. (exactly that, nothing else)\"}]}" \
  | head -c 400
echo
echo "-- Test 3/3: tool calling (the MCP superpower)"
curl -s http://127.0.0.1:8771/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-AI-Token: $(sudo grep ^AIBOX_TOKEN= /opt/aibox/aibox.env | cut -d= -f2)" \
  -d "{\"model\":\"$MODEL\",\"max_tokens\":80,\"messages\":[{\"role\":\"user\",\"content\":\"What is the weather in [Your City]? Use the get_weather tool.\"}],\"tools\":[{\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"description\":\"Get the current weather for a city\",\"parameters\":{\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}},\"required\":[\"city\"]}}}]}" \
  | head -c 600
echo
echo
echo "Done! Next: expose it via Cloudflare Tunnel and enter PI_AI_URL /"
echo "PI_AI_TOKEN / PI_AI_MODEL in Vercel – full guide: AIBOX.md"
