@echo off
cd /d "%~dp0"
echo Cargando las variedades de pizza en el catalogo...
node\node.exe backend\cargar_pizzas.mjs
echo.
echo Si dice "Listo", ya estan cargadas. Revisa en Catalogo y desactiva las viejas.
pause
