#!/usr/bin/env bash
# Bootstrap / update / build Service Monitor (macOS / Linux)
#
# Usage:
#   bash scripts/bootstrap.sh
#
# Env:
#   SERVICE_MONITOR_REPO      — git URL (default: https://github.com/IlhamDrinkX/service-monitor.git)
#   SERVICE_MONITOR_DIR       — install dir
#   SERVICE_MONITOR_SKIP_DIST — if 1, skip electron-builder

set -euo pipefail

REPO_URL="${SERVICE_MONITOR_REPO:-https://github.com/IlhamDrinkX/service-monitor.git}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_PARENT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -n "${SERVICE_MONITOR_DIR:-}" ]]; then
  ROOT="${SERVICE_MONITOR_DIR}"
elif [[ -f "${PWD}/package.json" ]]; then
  ROOT="${PWD}"
else
  ROOT="${REPO_PARENT}"
fi

step() { echo; echo "==> $*"; }

have() { command -v "$1" >/dev/null 2>&1; }

ensure_git() {
  if have git; then
    echo "git: $(git --version)"
    return
  fi
  step "Git not found — trying install"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    if have brew; then
      brew install git
    else
      echo "Install Xcode CLT: xcode-select --install" >&2
      xcode-select --install || true
      echo "Re-run after Git is installed." >&2
      exit 1
    fi
  elif have apt-get; then
    sudo apt-get update && sudo apt-get install -y git
  elif have dnf; then
    sudo dnf install -y git
  else
    echo "Install git manually, then re-run." >&2
    exit 1
  fi
}

ensure_node() {
  if have node; then
    local major
    major="$(node -v | sed 's/^v//' | cut -d. -f1)"
    echo "node: $(node -v)"
    if [[ "${major}" -lt 20 ]]; then
      echo "Node.js >= 20 required" >&2
      exit 1
    fi
    return
  fi
  step "Node not found — trying install"
  if [[ "$(uname -s)" == "Darwin" ]] && have brew; then
    brew install node@22
    brew link --overwrite --force node@22 || true
  else
    echo "Install Node.js >= 20 from https://nodejs.org and re-run." >&2
    exit 1
  fi
}

sync_repo() {
  step "Repo dir: ${ROOT}"
  mkdir -p "${ROOT}"
  cd "${ROOT}"

  if [[ -d .git ]]; then
    step "Existing checkout — git fetch/pull"
    git remote set-url origin "${REPO_URL}" 2>/dev/null || true
    git fetch --all --prune
    branch="$(git rev-parse --abbrev-ref HEAD)"
    if [[ "${branch}" == "HEAD" ]]; then branch="main"; fi
    git pull --ff-only "origin" "${branch}" || git pull --rebase "origin" "${branch}"
  elif [[ -f package.json ]]; then
    echo "package.json without .git — using as-is"
  else
    step "Clone ${REPO_URL}"
    git clone "${REPO_URL}" "${ROOT}"
    cd "${ROOT}"
  fi
}

install_and_build() {
  cd "${ROOT}"
  step "npm install"
  npm install --legacy-peer-deps

  step "build core + desktop"
  npm run build -w @service-monitor/core
  npm run build -w @service-monitor/desktop

  if [[ "${SERVICE_MONITOR_SKIP_DIST:-}" == "1" ]]; then
    echo "SKIP_DIST=1 — installer not built"
    return
  fi

  local os
  os="$(uname -s)"
  if [[ "${os}" == "Darwin" ]]; then
    step "electron-builder (macOS)"
    npm run dist:mac -w @service-monitor/desktop
  else
    step "electron-builder (current OS)"
    npm run dist -w @service-monitor/desktop
  fi

  local release="${ROOT}/apps/desktop/release"
  echo
  echo "Done. Artifacts in: ${release}"
  if [[ -d "${release}" ]]; then
    ls -la "${release}"
  fi
}

ensure_git
ensure_node
sync_repo
install_and_build
