#!/usr/bin/env bash
# Install the J.A.R.V.I.S "Voicebox" on the Raspberry Pi (Piper TTS).
# Afterwards a tiny TTS server runs on 127.0.0.1:8770 which you expose
# publicly (https) via a Cloudflare Tunnel – see VOICEBOX.md.
# The original "Voicebox" (Qwen3-TTS) needs 8 GB RAM and does not run on
# the Pi 3B+; Piper is the light, offline alternative – with the British
# voice en_GB-alan-medium as the default (closest legal Piper voice to
# the film J.A.R.V.I.S).
set -e

INSTALL_DIR=/opt/voicebox
# Remember the absolute repo path – the script chdirs to /tmp later, where
# relative cp paths (voicebox/…, deploy/…) would point nowhere.
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
VOICE=en_GB-alan-medium
VOICE_BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium

# The 2023 piper binary aborts on multi-codepoint diphthong keys in the
# voice config ("aɪ" is not a single codepoint, exit 134). Remove those
# keys (with backup) – the binary splits diphthongs by itself.
patch_voice_config() {
  python3 - "$INSTALL_DIR/voices/$VOICE.onnx.json" <<'PYEOF'
import json, sys, shutil
p = sys.argv[1]
shutil.copyfile(p, p + ".orig")
d = json.load(open(p))
bad = [k for k in set(list(d.get("phoneme_id_map", {})) + list(d.get("phoneme_map", {}))) if len(k) > 1]
for section in ("phoneme_id_map", "phoneme_map"):
    for k in list(d.get(section, {})):
        if len(k) > 1:
            del d[section][k]
d.pop("vowel_clusters", None)
json.dump(d, open(p, "w"), ensure_ascii=False)
print(f"[patch] removed multi-codepoint phonemes {bad} (backup: {p}.orig)")
PYEOF
}

echo "== J.A.R.V.I.S Voicebox (Piper) installation =="
ARCH=$(uname -m)
case "$ARCH" in
  armv7l)  PIPER_TGZ=piper_linux_armv7l.tar.gz ;;
  aarch64) PIPER_TGZ=piper_linux_aarch64.tar.gz ;;
  x86_64)  PIPER_TGZ=piper_linux_x86_64.tar.gz ;;
  *) echo "Unknown architecture: $ARCH – please install Piper manually."; exit 1 ;;
esac
echo "Architecture: $ARCH -> $PIPER_TGZ"

sudo mkdir -p "$INSTALL_DIR/voices"
cd /tmp

if [ ! -x "$INSTALL_DIR/piper/piper" ]; then
  echo "-- Downloading Piper …"
  curl -fsSL -o piper.tar.gz "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/$PIPER_TGZ"
  sudo tar -xzf piper.tar.gz -C "$INSTALL_DIR"
fi

if [ ! -f "$INSTALL_DIR/voices/$VOICE.onnx" ]; then
  echo "-- Downloading British voice ($VOICE) …"
  curl -fsSL -o "$VOICE.onnx" "$VOICE_BASE/$VOICE.onnx"
  curl -fsSL -o "$VOICE.onnx.json" "$VOICE_BASE/$VOICE.onnx.json"
  sudo mv "$VOICE.onnx" "$VOICE.onnx.json" "$INSTALL_DIR/voices/"
fi

if [ ! -f "$INSTALL_DIR/voices/$VOICE.onnx.json.orig" ]; then
  echo "-- Patching voice config (diphthong fix) …"
  patch_voice_config
fi

echo "-- Installing voicebox server …"
sudo cp "$SCRIPT_DIR/voicebox/voicebox.py" "$INSTALL_DIR/voicebox.py"

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
  echo ">> Your voicebox token (enter it in JARVIS under “Voicebox token”): $TOKEN"
else
  echo ">> Existing voicebox.env found (token in it unchanged)."
  # Switch an existing install to the new default voice.
  sudo sed -i "s/^VOICEBOX_VOICE=.*/VOICEBOX_VOICE=$VOICE/" "$INSTALL_DIR/voicebox.env"
fi

sudo cp "$SCRIPT_DIR/deploy/voicebox.service" /etc/systemd/system/voicebox.service
sudo systemctl daemon-reload
sudo systemctl enable --now voicebox

sleep 2
echo "-- Test:"
curl -s http://127.0.0.1:8770/health || echo "(server may need a moment – check 'sudo systemctl status voicebox')"
echo
echo "Done! Now expose it via a Cloudflare Tunnel – guide: VOICEBOX.md"
