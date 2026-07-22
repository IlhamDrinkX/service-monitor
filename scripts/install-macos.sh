#!/usr/bin/env bash
# Service Monitor — one-click install for macOS beta testers
#
# Что делает сам:
#   1) ставит Git / Node (brew или Xcode CLT), если нет
#   2) git clone в ~/service-monitor
#   3) npm install + сборка + DMG
#   4) открывает DMG
#
# Запуск одной строкой в Terminal:
#   curl -fsSL https://raw.githubusercontent.com/IlhamDrinkX/service-monitor/main/scripts/install-macos.sh | bash
#
# Или из клона репо:
#   bash scripts/install-macos.sh

set -euo pipefail

REPO_URL="${SERVICE_MONITOR_REPO:-https://github.com/IlhamDrinkX/service-monitor.git}"
ROOT="${SERVICE_MONITOR_DIR:-${HOME}/service-monitor}"

step() { echo; echo "==> $*"; }

have() { command -v "$1" >/dev/null 2>&1; }

ensure_git() {
  if have git; then
    echo "git: $(git --version)"
    return
  fi
  step "Git не найден — ставлю"
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Этот скрипт для macOS." >&2
    exit 1
  fi
  if have brew; then
    brew install git
  else
    echo "Ставлю Xcode Command Line Tools (окно установки — подтверди)…"
    xcode-select --install || true
    echo "После установки CLT запусти эту же команду снова." >&2
    exit 1
  fi
  if ! have git; then
    echo "Git всё ещё не найден. Перезапусти Terminal и повтори." >&2
    exit 1
  fi
}

ensure_brew() {
  if have brew; then return; fi
  step "Homebrew не найден — ставлю (нужен пароль администратора)"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Apple Silicon path
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

ensure_node() {
  if have node; then
    local major
    major="$(node -v | sed 's/^v//' | cut -d. -f1)"
    echo "node: $(node -v)"
    if [[ "${major}" -lt 20 ]]; then
      echo "Нужен Node.js >= 20. Обнови и запусти снова." >&2
      exit 1
    fi
    return
  fi
  step "Node.js не найден — ставлю"
  ensure_brew
  brew install node@22
  brew link --overwrite --force node@22 || true
  if [[ -x /opt/homebrew/opt/node@22/bin/node ]]; then
    export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
  fi
  if ! have node; then
    echo "Node не найден после установки. Перезапусти Terminal и повтори." >&2
    exit 1
  fi
  echo "node: $(node -v)"
}

sync_repo() {
  step "Папка проекта: ${ROOT}"
  mkdir -p "$(dirname "${ROOT}")"

  if [[ -d "${ROOT}/.git" ]]; then
    step "Уже есть клон — обновляю (git pull)"
    cd "${ROOT}"
    git remote set-url origin "${REPO_URL}" 2>/dev/null || true
    git fetch --all --prune
    branch="$(git rev-parse --abbrev-ref HEAD)"
    if [[ "${branch}" == "HEAD" ]]; then branch="main"; fi
    git pull --ff-only origin "${branch}" || git pull --rebase origin "${branch}"
  elif [[ -f "${ROOT}/package.json" ]]; then
    echo "Есть package.json без .git — собираю как есть"
    cd "${ROOT}"
  else
    if [[ -e "${ROOT}" ]] && [[ -n "$(ls -A "${ROOT}" 2>/dev/null || true)" ]]; then
      echo "Папка ${ROOT} занята. Удали её или задай SERVICE_MONITOR_DIR=другой путь." >&2
      exit 1
    fi
    rm -rf "${ROOT}" 2>/dev/null || true
    step "Скачиваю проект (git clone)"
    git clone "${REPO_URL}" "${ROOT}"
    cd "${ROOT}"
  fi
}

install_and_build() {
  cd "${ROOT}"

  export npm_config_fetch_retries=5
  export npm_config_fetch_retry_mintimeout=20000
  export npm_config_fetch_retry_maxtimeout=120000

  local attempt
  for attempt in 1 2 3; do
    step "npm install (попытка ${attempt}/3, долго — подожди)"
    if npm install --legacy-peer-deps; then
      break
    fi
    echo "npm install не удался (часто сеть / Electron). Повтор…"
    rm -rf "${ROOT}/node_modules/electron" 2>/dev/null || true
    sleep $((attempt * 5))
    if [[ "${attempt}" -eq 3 ]]; then
      echo "npm install failed после 3 попыток. Запусти скрипт ещё раз." >&2
      exit 1
    fi
  done

  step "Сборка core + desktop"
  npm run build -w @service-monitor/core
  npm run build -w @service-monitor/desktop

  if [[ "${SERVICE_MONITOR_SKIP_DIST:-}" == "1" ]]; then
    echo "SKIP_DIST=1 — DMG не собираю"
    return
  fi

  step "Сборка установщика (.dmg)"
  npm run dist:mac -w @service-monitor/desktop

  local release="${ROOT}/apps/desktop/release"
  echo
  echo "Готово. Файлы: ${release}"
  if [[ -d "${release}" ]]; then
    ls -la "${release}"
    local dmg
    dmg="$(ls -t "${release}"/*.dmg 2>/dev/null | head -n1 || true)"
    if [[ -n "${dmg}" ]]; then
      step "Открываю DMG: ${dmg}"
      open "${dmg}"
    else
      open "${release}"
    fi
  fi
}

echo "Service Monitor — установка для тестировщика (macOS)"
echo "Репозиторий: ${REPO_URL}"

ensure_git
ensure_node
sync_repo
install_and_build

echo
echo "Готово. Если DMG не открылся — смотри ~/service-monitor/apps/desktop/release"
