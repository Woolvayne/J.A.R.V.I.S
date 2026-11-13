#!/usr/bin/env bash
# ============================================================
# J.A.R.V.I.S – Raspberry Pi 3B+ Installation (alles kostenlos)
#   ./install-pi.sh            Installation + Autostart-Dienst
#   ./install-pi.sh --no-service   nur Installation, ohne systemd
# Voraussetzungen: Raspberry Pi OS (64-bit empfohlen), Internet
# ============================================================
set -e
cd "$(dirname "$0")"
DIR="$(pwd)"
USER_NAME="$(whoami)"
SERVICE=1
[ "$1" = "--no-service" ] && SERVICE=0

echo "=== J.A.R.V.I.S Pi-Installation (Ordner: $DIR, User: $USER_NAME) ==="

# 1) Systempakete (Python + venv) -------------------------------------------
if command -v apt-get >/dev/null 2>&1; then
  echo "→ Installiere Python & venv (sudo nötig) …"
  sudo apt-get update -qq
  sudo apt-get install -y -qq python3 python3-venv python3-pip ca-certificates curl
else
  echo "⚠ Kein apt-get gefunden – bitte Python 3.11+ manuell installieren."
fi

# 2) Virtuelle Umgebung + schlanke Pi-Abhängigkeiten -------------------------
if [ ! -d .venv ]; then
  echo "→ Erstelle .venv …"
  python3 -m venv .venv
fi
echo "→ Installiere Python-Pakete (requirements-pi.txt) …"
.venv/bin/pip install -q -r requirements-pi.txt

# 3) Konfiguration ------------------------------------------------------------
[ -f .env ] || { cp .env.example .env; echo "→ .env aus Vorlage erstellt – bitte GROQ_API_KEY eintragen (kostenlos: console.groq.com)"; }
[ -f mcp_servers.json ] || echo "⚠ mcp_servers.json fehlt (liegt normalerweise im Repo)."

# 4) Autostart per systemd -----------------------------------------------------
if [ "$SERVICE" = "1" ] && command -v systemctl >/dev/null 2>&1; then
  echo "→ Richte systemd-Dienst 'jarvis' ein (Autostart) …"
  sed -e "s|__USER__|$USER_NAME|g" -e "s|__DIR__|$DIR|g" deploy/jarvis.service | sudo tee /etc/systemd/system/jarvis.service >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable --now jarvis
  echo "✓ Dienst läuft. Status:  sudo systemctl status jarvis"
  echo "  Logs:                 journalctl -u jarvis -f"
  echo "  Neustart:             sudo systemctl restart jarvis"
else
  echo "→ Manuell starten mit:  ./start.sh"
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo ""
echo "============================================================"
echo "✓ J.A.R.V.I.S ist bereit!"
echo "  Lokal:    http://localhost:8000"
[ -n "$IP" ] && echo "  Im Netz:  http://$IP:8000   (z. B. vom Handy/Tablet)"
echo ""
echo "Nächste Schritte:"
echo "  1. Kostenlosen Groq-Key holen: https://console.groq.com/keys"
echo "  2. In .env eintragen:  GROQ_API_KEY=gsk_..."
echo "  3. MCP-Server in mcp_servers.json aktivieren (siehe MCP.md)"
echo "============================================================"
