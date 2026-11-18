@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 (
  echo No se pudo abrir la carpeta del proyecto.
  pause
  exit /b 1
)

set "FINESA_NODE=node"
where node >nul 2>&1
if errorlevel 1 (
  set "FINESA_NODE=%ProgramFiles%\nodejs\node.exe"
  if not exist "%ProgramFiles%\nodejs\node.exe" (
    echo No se encontro Node.js. Instale Node.js y vuelva a abrir este archivo.
    pause
    exit /b 1
  )
)

"%FINESA_NODE%" scripts\start-local.mjs %*
set "FINESA_EXIT_CODE=%ERRORLEVEL%"
if not "%FINESA_EXIT_CODE%"=="0" (
  echo.
  echo El inicio no se completo. Revise el mensaje anterior.
  pause
)
exit /b %FINESA_EXIT_CODE%
