# Статус миграции LapisLauncher на Velopack

Дата проверки: 29 августа 2026. Этот файл — контрольный список фактической реализации и оставшихся production-действий.

## Выбранное решение

- Velopack npm и CLI закреплены на стабильной версии `1.2.0`; prerelease-сборки не используются.
- Electron Builder создаёт только оптимизированный `win-unpacked`. Setup, packages, delta и update feed формирует Velopack.
- Канал: `stable`; platform/runtime: `win-x64`; package ID: `LapisLauncher`; main EXE: `LapisLauncher.exe`.
- Установка per-user в `%LOCALAPPDATA%` без UAC. Данные launcher и Minecraft остаются в `%USERPROFILE%\.lapis`.

## Выполнено в коде

- [x] Удалена зависимость `electron-updater`, добавлены `velopack@1.2.0` и `electron-log@5.4.3`.
- [x] Добавлен закреплённый local tool manifest `.config/dotnet-tools.json` для `vpk 1.2.0`.
- [x] `VelopackApp.build().setAutoApplyOnStartup(false).run()` вызывается до запуска обычного lifecycle Electron; применение проходит только через общий install guard.
- [x] Реализован один типизированный state machine: `checking`, `available`, `downloading`, `downloaded`, `installing`, `error` и terminal-состояния.
- [x] Реализованы startup auto-check, автоматическая загрузка/установка, delta-first и штатный fallback Velopack на full package.
- [x] Реализована защита от параллельных check/download и возможность повторной проверки после завершения/ошибки.
- [x] Добавлен Electron single-instance lock; повторный запуск фокусирует существующее окно.
- [x] Добавлены три быстрые попытки download с exponential backoff/jitter и отложенный retry после исчерпания попыток.
- [x] Перед download проверяется свободное место с резервом для Full-пакета, реконструкции и безопасного apply.
- [x] Добавлен экономный scheduler: 30 минут, jitter ±8%, backoff 5–30 минут, stale-check по фокусу не чаще 10 минут.
- [x] Сетевая ошибка не закрывает launcher и не сбрасывает авторизацию.
- [x] Установка не начинается при запущенном Minecraft.
- [x] Активный Minecraft сохраняется атомарно и восстанавливается по PID плюс времени создания процесса; startup и ручная установка используют общий install guard.
- [x] Состояние Minecraft очищается только после фактического завершения JVM; строки игрового лога, временное зависание и ошибки модов не могут остановить процесс.
- [x] Пока JVM существует, повторный запуск и установка обновления остаются заблокированными. Принудительное завершение разрешено только подтверждённой кнопкой «Остановить Minecraft».
- [x] Дублирующие stdout/stderr Minecraft направляются в безопасный sink: основной журнал остаётся в instance, а поток сообщений модов не может заполнить pipe и заблокировать Render thread.
- [x] Перед запуском `glDebugVerbosity` атомарно устанавливается в `0`, чтобы ошибки Iris/OpenGL не создавали неограниченный лог-спам; Iris, шейдеры и Voice Chat при этом не отключаются.
- [x] Неизвестные ошибки запуска записываются в ограниченный runtime-лог, а клиент получает короткое сообщение с учётом этапа запуска.
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
- [x] `app.asar` уменьшен примерно с 799 МБ до 10,8 МБ: renderer-only зависимости не дублируются, source maps исключены.
- [x] В Electron package оставлены только локали `ru` и `en-US`; каталог locales уменьшен примерно с 43,7 до 1,5 МБ.
- [x] Фоновое видео перекодировано в H.264/30 FPS с faststart (7,49 → 1,36 МБ), логотип оптимизирован до 512×512 (1,74 → 0,32 МБ).
- [x] CI блокирует регрессию размера: Setup ≤150 MiB, full package ≤145 MiB, `app.asar` ≤15 MiB и ровно две разрешённые локали.
- [x] Локально создан подписанный feed 0.1.4: full package 130,08 MiB, Setup 134,48 MiB, delta 0.1.3 → 0.1.4 — 1,84 MiB.
- [x] Добавлен GitHub Actions workflow с проверкой версии тега, обязательной подписью и проверкой Authenticode.
- [x] Stable-релизы сериализованы общей concurrency-очередью; downgrade/устаревший тег блокируется до сборки.
- [x] После атомарной публикации CI повторно скачивает публичные Full/Delta-пакеты и сверяет Content-Length плюс SHA-256.
- [x] Production-команда fail-fast блокирует неподписанный release.
- [x] Добавлен Nginx-конфиг для Velopack metadata с отключённым кэшем.

## Локально проверено

- [x] `pnpm --filter @lapis/launcher typecheck`.
- [x] `pnpm --filter @lapis/launcher build`.
- [x] `pnpm --filter @lapis/launcher package:win`.
- [x] Полный `pnpm typecheck` для workspace и `pnpm test` (4/4 auth e2e).
- [x] Добавлены unit-тесты update policy: резерв диска, bounded retry и форматирование пользовательского требования.
- [x] В main bundle присутствует внешний `require("velopack")`.
- [x] В package присутствует ровно нужный Windows x64 native-модуль.
- [x] Локальный `releases.stable.json` содержит SHA-1, SHA-256, Full и Delta для версии 0.1.4.
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

## Требуется перед публичным распространением

- [ ] Получить EV/OV Code Signing certificate или настроить Azure Trusted Signing.
- [ ] Перед публичным распространением заменить текущий self-signed CI-сертификат в GitHub Secrets на публично доверенный Code Signing или Azure Artifact Signing.
- [x] Репозиторий, GitHub Release и HTTPS feed настроены; release workflow 0.1.3 полностью прошёл и опубликован на `lapis-mc.ru`.
- [x] Старые NSIS-сборки не распространялись пользователям; миграция legacy-инсталляций сознательно исключена из production scope.

## Ручной acceptance test 0.1.9 → 0.1.10

1. Установить опубликованный Setup 0.1.9, войти в аккаунт и убедиться, что профиль `%USERPROFILE%\.lapis` сохранён.
2. Опубликовать тег `launcher-v0.1.10`; workflow обязан создать Full и Delta, проверить подпись/лимиты размера и атомарно заменить feed.
3. На уже открытой 0.1.9 должна появиться надпись «Доступно обновление» и рабочее модальное окно.
4. Для startup-пути заново запустить 0.1.9: должен появиться gate, пройти delta download, launcher должен закрыться, обновиться и запуститься как 0.1.10.
5. После обновления проверить версию, видео, логотип, авторизацию, настройки, скин и запуск Minecraft.
6. Во время запущенного Minecraft установка должна отказать с понятным сообщением; после закрытия Minecraft — выполниться.
7. Отключить сеть: launcher должен открыться с сохранённой авторизацией, а updater — перейти в retry без logout.
8. Проверить сохранность `%USERPROFILE%\.lapis\launcher`, `%USERPROFILE%\.lapis\instances`, сессии, настроек памяти и скина.
9. Запустить launcher второй раз: новое окно не создаётся, фокус получает существующее.
10. Прервать загрузку и восстановить сеть: должны отработать быстрые попытки, затем ручной или фоновый retry.
11. Проверить недостаток свободного места: пакет не скачивается, отображается понятное требование освободить диск.
12. Закрыть Minecraft и проверить, что кнопка остаётся в состоянии остановки до фактического выхода Java. Искусственно зависшая JVM не должна завершаться лаунчером без нажатия подтверждённой кнопки «Остановить Minecraft».
13. Проверить `%USERPROFILE%\.lapis\launcher\logs\updater.log`: причина искусственной ошибки запуска должна быть записана без показа технического текста в интерфейсе.

## Критерий готовности

Миграция считается production-завершённой после ручного подписанного теста 0.1.9 → 0.1.10 через реальный `lapis-mc.ru`, включая delta, startup update, already-open update, сетевую ошибку, корректный lifecycle Minecraft и сохранность пользовательских данных.
