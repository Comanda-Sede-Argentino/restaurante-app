@echo off
chcp 65001 >nul
title Actualizar Sistema Restaurante
cd /d "%~dp0"
echo ============================================
echo   ACTUALIZAR el sistema desde GitHub
echo   (ejecutar en la PC del restaurante)
echo ============================================
echo.
echo [1/4] Descargando ultimos cambios...
git pull
if errorlevel 1 goto error
echo.
echo [2/4] Revisando dependencias del backend...
cd /d "%~dp0backend"
call npm install
if errorlevel 1 goto error
echo.
echo [3/4] Revisando dependencias del frontend...
cd /d "%~dp0frontend"
call npm install
if errorlevel 1 goto error
echo.
echo [4/4] Recompilando la interfaz...
call npm run build
if errorlevel 1 goto error
echo.
echo ============================================
echo   LISTO. La actualizacion termino bien.
echo   Ahora cerra esta ventana y ejecuta INICIAR.bat
echo ============================================
pause
exit /b 0

:error
echo.
echo *** OCURRIO UN ERROR durante la actualizacion. ***
echo Sacale una foto a esta pantalla y avisale al desarrollador.
echo El sistema viejo sigue funcionando; volve a ejecutar INICIAR.bat.
pause
exit /b 1
