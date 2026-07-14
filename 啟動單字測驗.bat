@echo off
cd /d "%~dp0"
start "" http://localhost:8791/
node server.js
pause
