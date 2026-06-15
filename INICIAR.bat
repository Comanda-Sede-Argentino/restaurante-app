@echo off
title Sistema Restaurante - Argentino Sede Social
cd /d "%~dp0backend"
echo ============================================
echo   Sistema de Restaurante - iniciando...
echo   Abrir en el navegador:  http://localhost:3001
echo   (en otros dispositivos: http://IP-DE-ESTA-PC:3001)
echo ============================================
start "" http://localhost:3001
node server.js
pause
