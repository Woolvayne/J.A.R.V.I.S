#!/usr/bin/env bash
# J.A.R.V.I.S starten (Linux/macOS/Raspberry Pi)
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "Erstelle virtuelle Umgebung und installiere Abhängigkeiten (einmalig) …"
  python3 -m venv .venv
  # Auf ARM (Raspberry Pi) die schlanken Pi-Abhängigkeiten nutzen
  case "$(uname -m)" in
    arm*|aarch64) REQ=requirements-pi.txt ;;
    *) REQ=requirements.txt ;;
  esac
  echo "Nutze $REQ"
  .venv/bin/pip install -r "$REQ"
fi
echo "J.A.R.V.I.S startet auf http://localhost:8000  (Strg+C zum Beenden)"
exec .venv/bin/python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000 --workers 1
