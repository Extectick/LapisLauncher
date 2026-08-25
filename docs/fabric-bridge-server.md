# Lapis Bridge Server

Серверный Bridge обязателен для защищённого входа через Lapis Launcher. Он принимает одноразовый билет только для точного ника Lapis-профиля и отклоняет прямой вход из другого лаунчера.

## Требования

- Minecraft `26.2`;
- Fabric Loader `0.19.3` или новее;
- Fabric API для Minecraft `26.2`;
- Java `25`;
- `online-mode=false` в `server.properties`, поскольку UUID формируется из проверенного Bridge никнейма.

## Установка

1. Скопировать `bridge-server-0.1.1.jar` в серверную папку `mods`.
2. Убрать EasyAuth и другие моды `/register`/`/login`, чтобы не было второй независимой авторизации.
3. Перед запуском сервера задать переменные окружения:

```text
LAPIS_API_URL=https://lapis-mc.ru/api
LAPIS_SERVER_ID=main
LAPIS_BUILD_ID=lapis-26.2-fabric-0.19.3
LAPIS_BRIDGE_SHARED_KEY=<общий секрет минимум 32 случайных байта>
```

`LAPIS_BRIDGE_SHARED_KEY` должен в точности совпадать со значением production API. Секрет нельзя записывать в репозиторий, логи или командную строку общего доступа.

После перезапуска в логе должна появиться строка `Lapis login bridge is enabled`. Вход через актуальный Lapis Launcher должен пройти автоматически, а прямой вход из другого клиента — завершиться сообщением `Требуется запуск через Lapis Launcher.`

## Сборка

```powershell
cd fabric-bridge
.\gradlew.bat :bridge-server:clean :bridge-server:build
```

Готовый файл создаётся в `fabric-bridge/bridge-server/build/libs`.
