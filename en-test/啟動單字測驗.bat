@echo off
cd /d "%~dp0"
start "" http://localhost:8791/jvpc-05.htm
node server.js
pause
