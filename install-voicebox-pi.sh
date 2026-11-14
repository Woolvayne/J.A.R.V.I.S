#!/usr/bin/env bash
# J.A.R.V.I.S "Voicebox" auf dem Raspberry Pi installieren (Piper-TTS).
# Danach läuft ein winziger TTS-Server auf 127.0.0.1:8770, den du per
# Cloudflare Tunnel öffentlich (https) erreichbar machst – siehe VOICEBOX.md.
# Das Original "Voicebox" (Qwen3-TTS) braucht 8 GB RAM und läuft auf dem
# Pi 3B+ nicht; Piper ist die leichte, deutsche Alternative (offline).
set -e

INSTALL_DIR=/opt/voicebox
VOICE=de_DE-thorsten-medium
VOICE_BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/medium

echo "== J.A.R.V.I.S Voicebox (Piper) Installation =="
ARCH=$(uname -m)
case "$ARCH" in
  armv7l)  PIPER_TGZ=piper_linux_armv7.tar.gz ;;
  aarch64) PIPER_TGZ=piper_linux_aarch64.tar.gz ;;
  x86_64)  PIPER_TGZ=piper_linux_x86_64.tar.gz ;;
  *) echo "Unbekannte Architektur: $ARCH – bitte Piper manuell installieren."; exit 1 ;;
esac
echo "Architektur: $ARCH -> $PIPER_TGZ"

sudo mkdir -p "$INSTALL_DIR/voices"
cd /tmp

if [ ! -x "$INSTALL_DIR/piper/piper" ]; then
  echo "-- Lade Piper herunter …"
  curl -fsSL -o piper.tar.gz "https://github.com/rhasspy/piper/releases/download/v1.2.0/$PIPER_TGZ"
  sudo tar -xzf piper.tar.gz -C "$INSTALL_DIR"
fi

if [ ! -f "$INSTALL_DIR/voices/$VOICE.onnx" ]; then
  echo "-- Lade deutsche Stimme ($VOICE) herunter …"
  curl -fsSL -o "$VOICE.onnx" "$VOICE_BASE/$VOICE.onnx"
  curl -fsSL -o "$VOICE.onnx.json" "$VOICE_BASE/$VOICE.onnx.json"
  sudo mv "$VOICE.onnx" "$VOICE.onnx.json" "$INSTALL_DIR/voices/"
fi

echo "-- Installiere Voicebox-Server …"
sudo cp voicebox/voicebox.py "$INSTALL_DIR/voicebox.py"

if [ ! -f "$INSTALL_DIR/voicebox.env" ]; then
  TOKEN=$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')
  sudo tee "$INSTALL_DIR/voicebox.env" >/dev/null <<EOF
VOICEBOX_HOST=127.0.0.1
VOICEBOX_PORT=8770
VOICEBOX_TOKEN=$TOKEN
VOICEBOX_VOICES=$INSTALL_DIR/voices
VOICEBOX_VOICE=$VOICE
PIPER_BIN=$INSTALL_DIR/piper/piper
EOF
  sudo chmod 600 "$INSTALL_DIR/voicebox.env"
  echo ">> Dein Voicebox-Token (in JARVIS unter Voicebox-Token eintragen): $TOKEN"
else
  echo ">> Bestehende voicebox.env gefunden (Token darin unverändert)."
fi

sudo cp deploy/voicebox.service /etc/systemd/system/voicebox.service
sudo systemctl daemon-reload
sudo systemctl enable --now voicebox

sleep 2
echo "-- Test:"
curl -s http://127.0.0.1:8770/health || echo "(Server braucht evtl. einen Moment – 'sudo systemctl status voicebox' prüfen)"
echo
echo "Fertig! Jetzt per Cloudflare Tunnel öffentlich machen – Anleitung: VOICEBOX.md"
