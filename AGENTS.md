# Iva — личный агент на eve

This project uses the eve framework. Before writing code, always read the relevant guide in `node_modules/eve/docs/`.

## Архитектура (self-host bare-VPS)
- **Без sandbox.** Тулзы `bash`/`read_file`/`write_file`/`glob`/`grep` host-native (Node `fs`/`child_process`),
  полный доступ к VPS. Защита периметра — allowlist Telegram (fail-closed).
- **Telegram — polling по умолчанию.** eve-канал — webhook-приёмник (`POST /eve/v1/telegram`), но публичного
  HTTPS на bare-VPS нет. Мост `scripts/telegram-poll.mjs` (сервис `iva-telegram-poll`) сам забирает апдейты
  (`getUpdates`) и POST-ит их в локальный роут с секретным заголовком. Прокси/домен не нужны; код канала не меняется.
- **Deepgram.** Голос/видео/аудио из Telegram транскрибируются (nova-3, `DEEPGRAM_LANGUAGE=multi`) и пишутся
  в дневной транскрипт vault до попадания к Iva.
- **Модель.** Провайдер выбирается `MODEL_PROVIDER` (ollama|opencode), оба OpenAI-совместимы.
  Окно контекста задаётся вручную (`*_CONTEXT_WINDOW`) ≤ реального; компактация — `thresholdPercent 0.7`.
- **Веб/браузер.** `web_search` (DuckDuckGo, свой тул) + встроенный `web_fetch`; интерактив — CLI
  `agent-browser` (ставится install.sh, скилл `agent/skills/agent-browser/`).
- **Команды Telegram.** Управляющие (`/restart`/`/help`/`/new`) — в поллер-мосте out-of-band;
  `/task`/`/tasks`/`/digest` — перехват в `onMessage`. Новые tool/hook — самодостаточны (см. ниже).
- **Vault.** Скелет (правила, autograph, dbrain-processor, schema) живёт в код-репо как `vault-template/`.
  ЖИВОЙ vault (`ASSISTANT_VAULT_DIR`, дефолт `./vault`) — ОТДЕЛЬНЫЙ приватный git-репо: личные транскрипты/блобы
  в код-репо не попадают (`/vault/` в `.gitignore`). Создаётся из шаблона: `npm run init-vault` (install.sh зовёт сам);
  затем `gh auth login` + приватный remote. doctor.ts коммитит/пушит живой vault.
- **Память — systemd-таймеры** (`deploy/iva-memory-*.{service,timer}`): daily/weekly/monthly/yearly + doctor,
  драйвят Iva через `eve/client`. eve-расписания (`defineSchedule`) на self-host НЕ срабатывают (только Vercel Cron).
- **Время** — `ASSISTANT_TIMEZONE` (→ `TZ`) + динамическая инструкция `now`.
- **CLI `iva`** (`bin/iva.mjs`, zero-dep) — wrapper в `~/.local/bin`, ставит install.sh:
  `iva update` (git pull+build+рестарт), `iva config` (→ `scripts/setup.mjs`), `iva doctor`
  (health+авто-починка), `iva uninstall`, + `status/restart/logs/start/stop`. **Единый источник
  правды для systemd-юнитов** (`writeUnits()`): install.sh §9 делегирует сюда (`iva _install-units`).

## Гочи eve (0.11.4)
- `eve dev` падает на cross-authored относительном `.js`-импорте. Каждая новая тулза/хук/инструкция
  **самодостаточна**: импортирует только `eve/*`, `zod`, `ai`, node-builtins. Общий код НЕ выносить в `lib/`
  с относительным импортом — дублируй мелкие хелперы инлайном (напр. Deepgram-fetch).
- **Не** добавляй handler-schedules в `agent/`. Стиль: ESM, TypeScript, `.js`-расширения в относительных импортах.
