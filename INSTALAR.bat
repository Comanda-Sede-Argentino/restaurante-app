@echo off
chcp 65001 >nul
title Instalar Sistema Restaurante (primera vez)
cd /d "%~dp0"
echo ============================================
echo   INSTALACION INICIAL  (ejecutar UNA sola vez)
echo   Sistema de Restaurante - Argentino Sede Social
echo ============================================
echo.
echo [1/4] Instalando dependencias del backend...
cd /d "%~dp0backend"
call npm install
if errorlevel 1 goto error
echo.
echo [2/4] Cargando datos iniciales (platos, precios, mesas, usuarios)...
call npm run seed
if errorlevel 1 goto error
echo.
echo [3/4] Instalando dependencias del frontend...
cd /d "%~dp0frontend"
call npm install
if errorlevel 1 goto error
echo.
echo [4/4] Compilando la interfaz...
call npm run build
if errorlevel 1 goto error
echo.
echo ============================================
echo   INSTALACION COMPLETA.
echo   Ahora cerra esta ventana y ejecuta INICIAR.bat
echo ============================================
pause
exit /b 0

:error
echo.
echo *** OCURRIO UN ERROR durante la instalacion. ***
echo Sacale una foto a esta pantalla.
echo Causa mas frecuente: falta instalar Node.js o Git.
echo Ver la guia INSTALACION-RESTAURANTE.md (seccion Problemas comunes).
pause
exit /b 1
