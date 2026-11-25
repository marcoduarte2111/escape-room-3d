@echo off
title Escape Room 3D - servidor
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instalalo desde https://nodejs.org y vuelve a intentarlo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias, solo la primera vez...
  call npm install
)
start "" http://localhost:8080
node server.js
pause
