# GLauncher

Лаунчер для игроков приватного сервера на Windows x64. Устанавливает Minecraft Java Edition 26.3, NeoForge 26.3.0.115 и Java 25, затем синхронизирует моды перед каждым запуском. Игровые файлы, настройки и журналы хранятся в `%AppData%\GLauncher`.

## Игрокам

1. Скачайте `GLauncher-Setup.exe` со [страницы релиза GitHub](https://github.com/Linsaym/GLauncher/releases/latest) и запустите установщик. Портативную версию можно собрать из исходников.
2. В «Настройках» введите никнейм, общий IP двух серверов, порт обновлений и порт Minecraft. Выберите объём памяти.
3. Нажмите «Играть». Первый запуск загрузит игру и зависимости. Сервер появится в меню «Сетевая игра» под именем «Приватный сервер GLauncher».
4. После обновления сборки владельцем сервера снова нажмите «Играть». Лаунчер скачает новые и изменённые JAR, уберёт лишние и остановит запуск, если обновления недоступны или не прошли проверку.

GLauncher — неофициальный проект. Клиент загружает Java, Minecraft и NeoForge из источников Eclipse Adoptium, Mojang и NeoForged. ZIP лаунчера и сервер обновлений не содержат файлов Minecraft или изменённой игры. Локальный профиль не проверяет право владения и работает с сервером, настроенным на приём локальных профилей (`online-mode=false`). Никнейм сам по себе не удостоверяет личность.

[Minecraft EULA](https://www.minecraft.net/ru-ru/eula) · [Условия использования Minecraft](https://www.minecraft.net/en-us/usage-guidelines) · [NeoForged](https://docs.neoforged.net/user/docs/client/) · [Eclipse Temurin](https://adoptium.net/temurin/)

## Оформление игры

При первом запуске этой сборки Minecraft выбирает русский язык, ресурспак **Walnut and Brass — UI** из предоставленной копии и шейдеры **Complementary Shaders — Reimagined r5.9.3** от EminGT и Complementary Development. Шейдерпак загружается из Modrinth. За его интеграцию отвечает GLauncher. В дальнейшем язык, ресурспак и шейдеры можно менять в настройках самой игры.

Для шейдеров лаунчер загружает Horizon Iris Fork 1.12.1-r2 с CurseForge и Sodium 0.9.3-beta.5 с Modrinth. Если сервер обновлений публикует свои совместимые версии, используйте узнаваемые имена JAR, например `Horizon-Iris-Fork-…jar` и `sodium-neoforge-…jar`. Лаунчер выберет эти версии.

[Complementary Reimagined](https://modrinth.com/shader/complementary-reimagined/version/r5.9.3) · [Horizon Iris Fork](https://www.curseforge.com/minecraft/mc-mods/horizon-iris-fork/files/9719428) · [Sodium](https://modrinth.com/mod/sodium/version/CT6qQx01)

## Владельцу сервера

Скачайте `GLauncher-Server.zip` из релиза GitHub, распакуйте его целиком и запустите `start-server.bat`. Архив содержит Node.js и создаёт `mods` рядом с BAT.

Для запуска из исходников установите Node.js 24 и npm 11. Выполните `npm.cmd ci`, затем из корня репозитория запустите:

```powershell
npm.cmd run start:server
```

По умолчанию сервер слушает `127.0.0.1:3000`, а `mods` создаётся внутри `apps/update-server`. Для доступа игроков задайте IP вашего ПК в доверенной локальной сети или VPN:

```powershell
$env:GLAUNCHER_HOST = "192.168.1.10"
$env:GLAUNCHER_PORT = "3000"
$env:GLAUNCHER_MODS_DIR = "D:\GLauncher\mods"
npm.cmd run start:server
```

Укажите фактический IP в `GLAUNCHER_HOST` и разрешите на брандмауэре доступ к обоим портам из сети игроков. Сервер обновлений использует HTTP, а моды выполняются как код, поэтому используйте его только в доверенной сети или через VPN. Не открывайте Minecraft с локальными профилями и HTTP-порт обновлений в публичный интернет.

Добавляйте, заменяйте и удаляйте разрешённые к распространению клиентские `.jar` в папке `mods`. Подпапки и остальные форматы не публикуются. Для замены большого файла сначала завершите копирование под временным именем без расширения `.jar`, затем переименуйте его. Пустая папка означает пустую сборку и удаление управляемых JAR у игроков. Перезапуск HTTP-сервера при изменении набора модов не нужен. Остановка — `Ctrl+C`.

## Сборка и разработка

Выполните из корня:

```powershell
npm.cmd ci
npm.cmd run install:electron
npm.cmd run check
npm.cmd run start:client
```

`npm.cmd run package:setup` собирает `GLauncher-Setup.exe` в `apps/client/release`. Команда `npm.cmd run package:server` собирает `GLauncher-Server.zip` в `apps/update-server/release`, а `npm.cmd run package:win` собирает портативный клиент. Если клиент не смог запуститься, посмотрите `launcher.log` и `game.log` в `%AppData%\GLauncher`.

[Архитектура](docs/architecture.md) · [Инструкции для разработки](AGENTS.md)
