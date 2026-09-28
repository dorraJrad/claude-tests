@echo off
chcp 65001 >nul
title Pilotage de projets
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js n'est pas installe sur cet ordinateur.
  echo Installez la version LTS depuis https://nodejs.org puis relancez ce fichier.
  echo.
  start "" "https://nodejs.org/fr/download"
  pause
  exit /b 1
)
set OPEN_BROWSER=1
node --disable-warning=ExperimentalWarning src\index.js
pause
