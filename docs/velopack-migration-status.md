# Статус миграции LapisLauncher на Velopack

Дата проверки: 20 августа 2026. Этот файл — контрольный список фактической реализации и оставшихся production-действий.

## Выбранное решение

- Velopack npm и CLI закреплены на стабильной версии `1.2.0`; prerelease-сборки не используются.
- Electron Builder создаёт только оптимизированный `win-unpacked`. Setup, packages, delta и update feed формирует Velopack.
- Канал: `stable`; platform/runtime: `win-x64`; package ID: `LapisLauncher`; main EXE: `LapisLauncher.exe`.
- Установка per-user в `%LOCALAPPDATA%` без UAC. Данные launcher и Minecraft остаются в `%USERPROFILE%\.lapis`.

## Выполнено в коде

- [x] Удалена зависимость `electron-updater`, добавлены `velopack@1.2.0` и `electron-log@5.4.3`.
- [x] Добавлен закреплённый local tool manifest `.config/dotnet-tools.json` для `vpk 1.2.0`.
- [x] `VelopackApp.build().setAutoApplyOnStartup(true).run()` вызывается до запуска обычного lifecycle Electron.
- [x] Реализован один типизированный state machine: `checking`, `available`, `downloading`, `downloaded`, `installing`, `error` и terminal-состояния.
- [x] Реализованы startup auto-check, автоматическая загрузка/установка, delta-first и штатный fallback Velopack на full package.
- [x] Реализована защита от параллельных check/download и возможность повторной проверки после завершения/ошибки.
- [x] Добавлен экономный scheduler: 30 минут, jitter ±8%, backoff 5–30 минут, stale-check по фокусу не чаще 10 минут.
- [x] Сетевая ошибка не закрывает launcher и не сбрасывает авторизацию.
- [x] Установка не начинается при запущенном Minecraft.
- [x] Добавлен startup gate без мигания auth/dashboard, прогресс и модальное окно обновления в общем стиле приложения.
- [x] Добавлены release notes, размер скачивания и признак delta/full без выполнения Markdown/HTML.
- [x] Ошибки классифицируются в main; внутренние подробности не отправляются renderer.
- [x] Лог ограничен 2 МБ и хранится в `%USERPROFILE%\.lapis\launcher\logs\updater.log`.
- [x] Runtime URL валидируется Zod и допускает только HTTPS.

## Выполнено в сборке

- [x] NSIS/publish-конфигурация удалена; добавлены `package:win` и `package:win:release`.
- [x] Нативный Velopack `.node` externalized из Vite и распаковывается из ASAR.
- [x] В Windows package остаётся только `velopack_nodeffi_win_x64_msvc.node`.
- [x] Добавлен allowlist Electron-файлов. Устранено рекурсивное включение `release` в `app.asar`.
- [x] `app.asar` уменьшен примерно с 799 МБ до 40,7 МБ.
- [x] Локально создан корректный feed 0.1.2: full package около 153 МБ, Setup около 157 МБ.
- [x] Добавлен GitHub Actions workflow с проверкой версии тега, обязательной подписью и проверкой Authenticode.
- [x] Production-команда fail-fast блокирует неподписанный release.
- [x] Добавлен Nginx-конфиг для Velopack metadata с отключённым кэшем.

## Локально проверено

- [x] `pnpm --filter @lapis/launcher typecheck`.
- [x] `pnpm --filter @lapis/launcher build`.
- [x] `pnpm --filter @lapis/launcher package:win`.
- [x] Полный `pnpm typecheck` для workspace и `pnpm test` (4/4 auth e2e).
- [x] В main bundle присутствует внешний `require("velopack")`.
- [x] В package присутствует ровно нужный Windows x64 native-модуль.
- [x] `releases.stable.json` содержит SHA-1, SHA-256, размер и версию 0.1.2.
- [x] Локальный Setup подтверждён как `NotSigned`; это ожидаемый smoke-артефакт, публиковать его нельзя.
- [x] Проверено, что production build без signing secret завершается ошибкой до сборки.
- [x] Добавлена повторяемая команда `pnpm package:win:dev-signed`: создаёт неэкспортируемый RSA-3072/SHA-256 self-signed сертификат с Code Signing EKU, доверенный только текущему пользователю.
- [x] Development Setup 0.1.2 подписан `CN=Lapis Launcher Development`, имеет DigiCert timestamp и локальный статус Authenticode `Valid`.
- [x] Создан отдельный экспортируемый CI development-сертификат; PFX, пароль и ожидаемый отпечаток переданы напрямую в GitHub Secrets без коммита и вывода значений.
- [x] Создан ограниченный VPS-пользователь `lapis-deploy` без sudo; его ключ позволяет публиковать только через права каталога `/var/www/lapis-updates`.
- [x] SSH host key закреплён в GitHub Secret; workflow не использует `StrictHostKeyChecking=no`.
- [x] Production environment GitHub принимает deploy только от тегов `launcher-v*`.
- [x] Nginx-конфигурация Velopack применена на VPS, `nginx -t` успешен; сохранён backup прежнего конфига.
- [x] Workflow проверен YAML parser и actionlint 1.7.12 без ошибок.

## Требуется перед production-проверкой

- [ ] Получить EV/OV Code Signing certificate или настроить Azure Trusted Signing.
- [ ] Перед публичным распространением заменить текущий self-signed CI-сертификат в GitHub Secrets на публично доверенный Code Signing или Azure Artifact Signing.
- [ ] Закоммитить и отправить текущую реализацию в `Extectick/LapisLauncher`, затем опубликовать тег базового release. До первого успешного workflow `https://lapis-mc.ru/updates/releases.stable.json` возвращает 404.
- [ ] Решить миграцию старых NSIS test-installations. Для текущих локальных тестов удалить старую установленную тестовую версию и один раз установить Velopack Setup. Если старый NSIS уже раздавался внешним пользователям, нужен отдельный bridge-release/инструкция деинсталляции.

## Ручной acceptance test 0.1.2 → 0.1.3

1. Собрать подписанную 0.1.2 командой `pnpm package:win:release` и проверить `Get-AuthenticodeSignature` со статусом `Valid`.
2. Опубликовать packages/Setup, затем metadata; проверить HTTPS, `Content-Type` и `Cache-Control: no-store` для `releases.stable.json`.
3. Установить `LapisLauncher-stable-Setup.exe`, войти в аккаунт, запустить/закрыть Minecraft и перезапустить launcher.
4. Не очищая `apps/launcher/release/velopack`, поднять версию до 0.1.3, добавить release notes и снова выполнить production build.
5. Убедиться, что создан `0.1.3-stable-delta.nupkg`, а feed содержит 0.1.2 и 0.1.3.
6. Опубликовать 0.1.3 атомарно. На уже открытой 0.1.2 должна появиться надпись «Доступно обновление» и рабочее модальное окно.
7. Для startup-пути заново запустить 0.1.2: должен появиться gate, пройти delta download, launcher должен закрыться, обновиться и запуститься как 0.1.3.
8. Во время запущенного Minecraft установка должна отказать с понятным сообщением; после закрытия Minecraft — выполниться.
9. Отключить сеть: launcher должен открыться с сохранённой авторизацией, а updater — перейти в retry без logout.
10. Проверить сохранность `%USERPROFILE%\.lapis\launcher`, `%USERPROFILE%\.lapis\instances`, сессии, настроек памяти и скина.

## Критерий готовности

Миграция считается production-завершённой после успешного подписанного теста 0.1.2 → 0.1.3 через реальный `lapis-mc.ru`, включая delta, startup update, already-open update, сетевую ошибку и сохранность пользовательских данных.
