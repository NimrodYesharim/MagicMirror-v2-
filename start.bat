@echo off
cd /d "%~dp0"
title MagicMirror

echo Starting MagicMirror server...
start /B python -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --ssl-keyfile config/ssl/key.pem --ssl-certfile config/ssl/cert.pem

:: Wait for server to be ready
:wait
timeout /t 1 /nobreak > nul
curl -sk https://localhost:8000 > nul 2>&1
if errorlevel 1 goto wait

echo Server ready. Opening browser...
start "" "https://localhost:8000"
