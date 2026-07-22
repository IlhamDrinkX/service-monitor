@echo off
REM Service Monitor — установка для тестировщика (Windows)
REM Двойной клик: скачает скрипт с GitHub (или запустит локальный) и всё сделает сам.
setlocal
title Service Monitor Install
cd /d "%~dp0"

echo.
echo === Service Monitor: установка ===
echo.

REM Если рядом лежит полный install-windows.ps1 (клон репо) — используем его.
if exist "%~dp0install-windows.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
) else (
  echo Скачиваю установщик с GitHub...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/IlhamDrinkX/service-monitor/main/scripts/install-windows.ps1 | iex"
)

set ERR=%ERRORLEVEL%
echo.
if %ERR% neq 0 (
  echo Что-то пошло не так. Скопируй текст выше и отправь разработчику.
) else (
  echo Готово.
)
echo.
pause
exit /b %ERR%
