@echo off
cd /d "%~dp0\.."
title MagicMirror

echo Starting MagicMirror server...
echo Press Ctrl+C to stop.

:: Background watcher: polls until server is ready, then opens browser (gives up after 30s)
start /B powershell -NoProfile -Command "$i=0; do { Start-Sleep 1; $i++; try { $r=[Net.WebRequest]::Create('https://localhost:8000'); $r.ServerCertificateValidationCallback={$true}; $r.GetResponse()|Out-Null; Start-Process 'https://localhost:8000'; exit } catch {} } while ($i -lt 30)"

:: Run server in foreground — Ctrl+C kills it directly
python -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --ssl-keyfile config/ssl/key.pem --ssl-certfile config/ssl/cert.pem
