#!/usr/bin/env bash
# J.A.R.V.I.S starten (Linux/macOS)
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "Erstelle virtuelle Umgebung und installiere Abhängigkeiten (einmalig) …"
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi
echo "J.A.R.V.I.S startet auf http://localhost:8000  (Strg+C zum Beenden)"
exec .venv/bin/python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000
