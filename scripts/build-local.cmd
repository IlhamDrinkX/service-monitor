@echo off
REM Local build from this checkout (no git clone). Double-click OK.
setlocal
title Service Monitor - local build
cd /d "%~dp0.."
echo.
echo === Service Monitor: local Windows build ===
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-local.ps1" %*
set ERR=%ERRORLEVEL%
echo.
if %ERR% neq 0 (
  echo FAILED.
  echo If spawn UNKNOWN: Windows Security - Exclusions - add this folder:
  echo   %CD%
  echo Then delete apps\desktop\release and re-run.
) else (
  echo Done. Installer is under apps\desktop\release\
)
echo.
pause
exit /b %ERR%
