@echo off
setlocal
cd /d "%~dp0" || exit /b 1
chcp 65001 >nul
"%~dp0runtime\node.exe" "%~dp0server\index.js"
if errorlevel 1 (
  echo Server stopped with an error.
  pause
  exit /b 1
)
