@echo off
REM J.A.R.V.I.S starten (Windows)
cd /d %~dp0
if not exist .venv (
  echo Erstelle virtuelle Umgebung und installiere Abhaengigkeiten (einmalig) ...
  python -m venv .venv
  .venv\Scripts\pip install -r requirements.txt
)
echo J.A.R.V.I.S startet auf http://localhost:8000  (Strg+C zum Beenden)
.venv\Scripts\python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000
