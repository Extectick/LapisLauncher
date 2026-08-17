# Lapis Launcher

Lapis — Electron launcher для Fabric-сборок Minecraft с локальным API, защищённой сессией, подписанными манифестами, загрузкой скинов и Fabric Bridge для авторизации на сервере. Актуальный статус и дальнейший план — в [docs/implementation-plan.md](docs/implementation-plan.md).

## Локальный запуск

Требуются Node.js 22+, pnpm 10+ и Docker Desktop.

```powershell
Copy-Item .env.example apps/api/.env
pnpm install --frozen-lockfile
docker compose -f compose.dev.yml up -d
pnpm db:generate
pnpm --filter @lapis/api prisma:deploy
pnpm dev:api
```

API принимает запросы только на `127.0.0.1:3000`.

Для обновления статуса серверов в отдельном PowerShell запустите worker:

```powershell
pnpm --filter @lapis/worker dev
```

## Проверка через launcher UI

Оставьте API запущенным и откройте второй PowerShell в корне репозитория:

```powershell
pnpm dev:launcher
```

Откроется Electron-окно Lapis. После входа доступны каталог серверов, установка и запуск изолированной сборки, параметры ОЗУ/полноэкранного режима и загрузка скина. Renderer не получает refresh token: он сохраняется только main-процессом в зашифрованном Windows-хранилище `safeStorage`. При следующем запуске launcher автоматически попробует восстановить сессию.

## Проверка регистрации и входа

В отдельном PowerShell:

```powershell
$body = @{ nickname = 'LapisPlayer'; password = 'StrongPassword42' } | ConvertTo-Json
$registration = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/v1/auth/register -ContentType application/json -Body $body
$login = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/v1/auth/login -ContentType application/json -Body $body
```

`$registration` и `$login` вернут ник, короткоживущий access token и refresh token. Не выводите и не сохраняйте refresh token в файлах. Ники проверяются без учёта регистра; пароль при регистрации должен содержать не менее 6 символов.

Для интеграционных тестов используется отдельная БД `lapis_test` на порту `5433`; данные из локальной `lapis` на порту `5432` не затрагиваются:

```powershell
pnpm test
```

Тесты дополнительно откажутся запускаться, если URL БД не заканчивается на `lapis_test`.

После проверки остановить только локальную БД можно командой `docker compose -f compose.dev.yml stop`.
## Сборки Minecraft

Каждая сборка изолирована в `%USERPROFILE%\.lapis\instances\<build-id>`. Внутри неё находятся собственные `versions`, `libraries`, `assets`, `mods`, `config`, `resourcepacks`, `shaderpacks` и `saves`.

Сервер выбирает активную сборку в БД. Её версия Minecraft, версия Fabric и обязательные моды описываются отдельными записями `game_builds` и `build_mods`; моды скачиваются только в папку соответствующей сборки и проверяются по SHA-1. Поэтому две сборки с разными версиями и модпаками не перезаписывают друг друга.
