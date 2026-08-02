#!/bin/bash
# Service Monitor — установка для тестировщика (macOS)
# Двойной клик в Finder: откроет Terminal и всё сделает сам
# (Git/Node → clone → сборка → открытие DMG).

cd "$(dirname "$0")" || true
clear
echo ""
echo "=== Service Monitor: установка (macOS) ==="
echo ""

set +e
if [[ -f "./install-macos.sh" ]]; then
  bash "./install-macos.sh"
  ERR=$?
else
  echo "Скачиваю установщик с GitHub..."
  curl -fsSL "https://raw.githubusercontent.com/IlhamDrinkX/service-monitor/main/scripts/install-macos.sh" | bash
  ERR=$?
fi

echo ""
if [[ $ERR -ne 0 ]]; then
  echo "Что-то пошло не так. Скопируй текст выше и отправь разработчику."
  echo "Частые причины: сеть при npm install / Electron; нет прав на brew."
else
  echo "Готово."
  echo "Первый запуск: правый клик по приложению → Open (не подписано)."
fi
echo ""
echo "Нажми Enter, чтобы закрыть окно…"
read -r _
exit "$ERR"
