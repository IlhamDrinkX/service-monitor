@echo off
REM Service Monitor install for Windows testers (ASCII-only messages = no mojibake)
REM Double-click: downloads/runs install-windows.ps1 (Git/Node/clone/build/setup)
setlocal
title Service Monitor Install
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo === Service Monitor: install ===
echo.

if exist "%~dp0install-windows.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
) else (
  echo Downloading installer script from GitHub...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/IlhamDrinkX/service-monitor/main/scripts/install-windows.ps1 | iex"
)

set ERR=%ERRORLEVEL%
echo.
if %ERR% neq 0 (
  echo FAILED.
  echo If you saw "spawn UNKNOWN": Windows Defender blocked the NSIS stub.
  echo   Add exclusion for %%USERPROFILE%%\service-monitor then re-run.
  echo Otherwise re-run - Electron download can fail on flaky network.
  echo Send the log above to the developer if it keeps failing.
) else (
  echo Done.
)
echo.
pause
exit /b %ERR%
