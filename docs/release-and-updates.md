# Релизы и обновления LapisLauncher

Актуальная реализация использует **Velopack 1.2.0**. `electron-updater`, NSIS metadata (`latest.yml`, `.blockmap`) и установка обновления кодом renderer больше не используются.

## Как работает обновление

- `VelopackApp` регистрируется в самом начале main-процесса и завершает отложенные операции после перезапуска.
- Только установленная через Velopack версия участвует в обновлениях. Dev и `win-unpacked` безопасно получают статус `disabled`.
- При каждом запуске выполняется одна обязательная проверка stable-канала. Если версия новее, она автоматически скачивается и применяется до работы с launcher.
- Velopack сначала использует delta-пакеты и сам переключается на полный пакет, если цепочка delta непригодна или слишком длинная.
- Во время открытой сессии проверка выполняется раз в 30 минут с jitter ±8%. При сетевой ошибке используется экспоненциальный retry от 5 до 30 минут. Фокус окна запускает проверку только если предыдущая старше 10 минут.
- Одновременно разрешены только одна проверка и одна загрузка. Постоянного polling процесса, файла или API нет.
- Electron использует single-instance lock: второй запуск активирует уже открытое окно и не создаёт конкурирующий updater или второй runtime Minecraft.
- Перед загрузкой launcher проверяет свободное место на диске установки. Резерв равен удвоенному размеру Full-пакета плюс 512 МиБ для безопасной реконструкции и применения.
- Ошибка загрузки получает до трёх быстрых попыток с exponential backoff и jitter. После исчерпания быстрых попыток остаётся фоновый retry 5–30 минут и ручная кнопка повтора.
- В фоне пользователь видит «Доступно обновление». Нажатие открывает общее модальное окно с версией, размером, release notes и прогрессом.
- Установка блокируется, пока работает Minecraft. PID управляемого клиента сохраняется атомарно и при восстановлении сверяется со временем создания процесса, поэтому совпавший повторно выданный Windows PID не блокирует обновление и не может быть остановлен launcher.
- Скачанное, но не применённое обновление обнаруживается через Velopack pending-restart и безопасно продолжается при следующем запуске.
- Пользовательские данные `%USERPROFILE%\.lapis`, игровые instances и сессия находятся вне каталога приложения и обновлением не заменяются.
- Технические ошибки пишутся в `%USERPROFILE%\.lapis\launcher\logs\updater.log`; renderer получает только безопасные сообщения.

Runtime-конфигурация находится в `apps/launcher/resources/update-config.json`:

```json
{
  "url": "https://lapis-mc.ru/updates",
  "channel": "stable",
  "checkIntervalMinutes": 30
}
```

Для временного стенда допустимы `LAPIS_UPDATE_URL`, `LAPIS_UPDATE_CHANNEL` и `LAPIS_UPDATE_INTERVAL_MINUTES`. URL обязан использовать HTTPS.

## Сборка

Velopack CLI закреплён в `.config/dotnet-tools.json`; глобальная установка не нужна.

Локальный неподписанный smoke-пакет:

```powershell
dotnet tool restore
pnpm install --frozen-lockfile
pnpm package:win
```

Локальный подписанный development-пакет:

```powershell
pnpm package:win:dev-signed
```

Команда создаёт или повторно использует неэкспортируемый self-signed сертификат `CN=Lapis Launcher Development` в `Cert:\CurrentUser\My`, добавляет доверие только для текущего пользователя и проверяет подпись итогового Setup. Публичная часть сохраняется в `.local/certificates`, закрытый ключ из Windows Certificate Store не экспортируется и не попадает в Git. Такой сертификат предназначен только для локального/закрытого теста и не заменяет публично доверенный production Code Signing.

Результат находится в `apps/launcher/release/velopack`:

- `LapisLauncher-stable-Setup.exe` — bootstrap installer;
- `LapisLauncher-<version>-stable-full.nupkg` — полный пакет;
- `LapisLauncher-<version>-stable-delta.nupkg` — delta, начиная со второго совместимого релиза;
- `releases.stable.json` — основной update feed;
- `assets.stable.json` и `RELEASES-stable` — metadata Velopack.

`release/electron` и `release/velopack` разделены специально: Electron-сборка не включает предыдущие release-артефакты внутрь ASAR, а Velopack сохраняет прошлые packages для расчёта delta.

Production-команда:

```powershell
$env:VELOPACK_SIGN_PARAMS = '/f "C:\secure\lapis.pfx" /p "<password>" /fd SHA256 /tr http://timestamp.digicert.com /td SHA256'
pnpm package:win:release
```

Вместо локального PFX поддерживается Azure Trusted Signing через `VELOPACK_AZURE_TRUSTED_SIGN_FILE`. Production-команда завершается до тяжёлой сборки, если signing не настроен. PFX, пароль и параметры с секретами запрещено коммитить.

CI workflow `.github/workflows/launcher-release.yml` выполняет полный production-процесс:

- ручной запуск создаёт подписанный проверочный artifact без публикации;
- тег `launcher-v<version>` обязан совпадать с `apps/launcher/package.json`;
- предыдущий full package загружается из GitHub Release для формирования delta;
- Setup и packages подписываются, проверяются по защищённому отпечатку и получают GitHub build attestation;
- создаётся GitHub Release;
- проверенные файлы атомарно публикуются на `lapis-mc.ru`, причём `releases.stable.json` заменяется последним;
- все stable-релизы сериализуются одной GitHub Actions concurrency-очередью, даже если запущены разными тегами;
- workflow запрещает публиковать версию ниже уже выпущенной;
- после публикации workflow повторно скачивает Full и Delta, сверяет их размер и SHA-256 с опубликованным feed.

Используемые Repository Secrets:

- `WINDOWS_CODE_SIGNING_PFX_BASE64`;
- `WINDOWS_CODE_SIGNING_PFX_PASSWORD`;
- `WINDOWS_CODE_SIGNING_THUMBPRINT`;
- `LAPIS_UPDATE_SSH_PRIVATE_KEY`;
- `LAPIS_UPDATE_SSH_KNOWN_HOSTS`;
- `LAPIS_UPDATE_SSH_HOST`;
- `LAPIS_UPDATE_SSH_USER`.

Для текущего закрытого тестирования secrets уже могут содержать self-signed CI-сертификат. Перед публичным распространением их нужно заменить сертификатом публично доверенного издателя, не меняя workflow.

Выпуск новой версии:

```powershell
# Сначала изменить version в apps/launcher/package.json и закоммитить.
git tag launcher-v0.1.11
git push origin main
git push origin launcher-v0.1.11
```

## Публикация

Nginx-конфигурация находится в `deploy/nginx/lapis-mc-updates.https.conf`. Packages и Setup можно кэшировать как immutable. `releases.stable.json`, `assets.stable.json` и `RELEASES-stable` всегда отдаются с `Cache-Control: no-store`.

Публикация должна быть атомарной:

1. Загрузить новый full/delta package и Setup под их окончательными уникальными именами.
2. Проверить доступность файлов и SHA-256.
3. Последними заменить metadata-файлы, прежде всего `releases.stable.json`.
4. Не изменять и не удалять packages уже опубликованной версии, пока они присутствуют в feed/delta-цепочке.

Откат выполняется новым исправляющим релизом. Downgrade в клиенте запрещён (`AllowVersionDowngrade: false`).

## Проверка обновления

Полный сценарий описан и отслеживается в `docs/velopack-migration-status.md`. Проверяются автоматический startup update, уведомление уже открытого launcher, delta download, повтор после сетевого сбоя, нехватка места, single-instance, блокировка при Minecraft, подпись и сохранность `%USERPROFILE%\.lapis`.
