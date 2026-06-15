@echo off
chcp 65001 >nul
title Subir cambios a GitHub
cd /d "%~dp0"
echo ============================================
echo   SUBIR cambios a GitHub
echo   (ejecutar en la PC de desarrollo / portatil)
echo ============================================
echo.
git add -A
set "msg="
set /p "msg=Describi el cambio (o ENTER para mensaje automatico): "
if not defined msg set "msg=Actualizacion del sistema"
git commit -m "%msg%"
echo.
echo Subiendo a GitHub...
git push
if errorlevel 1 goto error
echo.
echo ============================================
echo   LISTO. Los cambios estan en GitHub.
echo   En el restaurante: ejecutar ACTUALIZAR.bat
echo ============================================
pause
exit /b 0

:error
echo.
echo *** No se pudo subir (puede que no haya cambios nuevos
echo     o falte conexion). Revisa el mensaje de arriba. ***
pause
exit /b 1
