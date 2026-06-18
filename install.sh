#!/usr/bin/env bash
#
# Установка ассистента (Ева) одной командой:
#
#   curl -fsSL https://raw.githubusercontent.com/smixs/eve-assistant/main/install.sh | bash
#
# Ставит Node 24+ (через nvm, без root), зависимости, проводит интерактивную
# настройку (ключ Ollama Cloud + выбор модели + Telegram), собирает и опционально
# заводит systemd-сервис.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/smixs/eve-assistant.git}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/eve-assistant}"
NODE_MAJOR_MIN=24

c_blue=$'\033[34m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_reset=$'\033[0m'
step() { echo "${c_blue}▸ $*${c_reset}"; }
ok()   { echo "${c_green}✓ $*${c_reset}"; }
warn() { echo "${c_yellow}! $*${c_reset}"; }
die()  { echo "${c_red}✗ $*${c_reset}" >&2; exit 1; }

# Интерактивный ввод даже при запуске через `curl | bash`
if [ ! -t 0 ] && [ -r /dev/tty ]; then exec < /dev/tty; fi

echo
echo "  ${c_green}Ева${c_reset} — личный ассистент на eve + Ollama Cloud"
echo "  ─────────────────────────────────────────────"

# 1. Базовые утилиты
command -v git >/dev/null  || die "нужен git (установи: apt/brew install git)"
command -v curl >/dev/null || die "нужен curl"

# 2. Node 24+
need_node=1
if command -v node >/dev/null; then
  major="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
  [ "$major" -ge "$NODE_MAJOR_MIN" ] && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  step "Устанавливаю Node $NODE_MAJOR_MIN+ через nvm…"
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install "$NODE_MAJOR_MIN"
  nvm use "$NODE_MAJOR_MIN"
fi
ok "Node $(node -v)"

# 3. Код проекта
SOURCE="${BASH_SOURCE[0]:-}"
SCRIPT_DIR=""
if [ -n "$SOURCE" ] && [ -f "$SOURCE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
fi
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/package.json" ] && grep -q '"eve"' "$SCRIPT_DIR/package.json"; then
  PROJECT_DIR="$SCRIPT_DIR"
  step "Использую текущий каталог: $PROJECT_DIR"
elif [ -d "$INSTALL_DIR/.git" ]; then
  PROJECT_DIR="$INSTALL_DIR"
  step "Обновляю $PROJECT_DIR…"
  git -C "$PROJECT_DIR" pull --ff-only origin "$BRANCH"
else
  step "Клонирую $REPO_URL → $INSTALL_DIR…"
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  PROJECT_DIR="$INSTALL_DIR"
fi
cd "$PROJECT_DIR"

# 4. Зависимости
step "Ставлю зависимости…"
if [ -f package-lock.json ]; then npm ci; else npm install; fi
ok "Зависимости установлены"

# 5. Интерактивная настройка
step "Настройка (ключ + модель + Telegram)…"
node scripts/setup.mjs

# 6. Сборка
step "Собираю агента (eve build)…"
npm exec -- eve build
ok "Сборка готова → .output"

# 7. systemd (опционально, Linux)
if command -v systemctl >/dev/null 2>&1; then
  read -r -p "Завести автозапуск через systemd (user-сервис)? (y/N) " a
  if echo "${a:-}" | grep -qi '^y'; then
    NODE_BIN="$(command -v node)"
    UNIT_DIR="$HOME/.config/systemd/user"
    mkdir -p "$UNIT_DIR"
    cat > "$UNIT_DIR/eve-assistant.service" <<EOF
[Unit]
Description=eve assistant (Ева)
After=network-online.target

[Service]
WorkingDirectory=$PROJECT_DIR
EnvironmentFile=$PROJECT_DIR/.env
ExecStart=$NODE_BIN $PROJECT_DIR/.output/server/index.mjs
Environment=PORT=3000
Restart=always

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now eve-assistant.service
    loginctl enable-linger "$USER" >/dev/null 2>&1 || warn "не удалось включить linger (сервис не стартует до логина)"
    ok "Сервис запущен: systemctl --user status eve-assistant"
  fi
fi

echo
ok "Готово."
echo
echo "  Запуск вручную:   cd $PROJECT_DIR && npm start"
echo "  Локальный диалог: npm run dev   (TUI)"
echo "  Проверка:         npm run smoke"
echo
echo "  Telegram webhook (после публичного HTTPS-домена) и cron-дайджест — см. DEPLOY.md"
echo
