# Сборка и выпуск

## Требования

- Node.js 22.5 или новее (для тестов используется встроенный `node:sqlite`; приложение использует sql.js и от этого не зависит).
- Для установщиков — родная ОС: Windows для `.exe`, macOS для `.dmg`, Linux для `.deb`. Кросс-сборка не используется.

## Зависимости

| Пакет | Назначение |
|---|---|
| electron 45 | оболочка приложения |
| ssh2 | SSH, SFTP, туннели (используется реализация на JavaScript, без нативной части) |
| sql.js | SQLite на WebAssembly — одинаково работает на всех ОС и архитектурах, без пересборки |
| react 19, @xterm/xterm 5 | интерфейс и терминал |
| esbuild | сборка main, preload и интерфейса |
| electron-builder 26 | установщики |
| tsx, typescript | тесты и проверка типов |

Нативных модулей нет, поэтому `npmRebuild: false`, а универсальная сборка macOS (x64 + arm64) не требует ручного объединения бинарников.

## Локальная разработка

```bash
npm install --ignore-scripts             # --ignore-scripts: не собирать необязательную нативную часть ssh2
node node_modules/electron/install.js    # скачать Electron для локального запуска
npm run build                            # dist/main, dist/preload, dist/renderer, dist/data/user
npx electron .                           # запуск
npm run build:watch                      # пересборка при изменениях
```

Отдельный каталог данных для разработки: `NETADMIN_DESK_DATA=/tmp/nad-dev npx electron .`

### Проверки

```bash
npm test                 # модульные тесты (база на node:sqlite)
npm run test:sqljs       # тесты базы, хранилища и импорта на sql.js (как в приложении)
npm run typecheck        # проверка типов (нужны @types/*)
npm run import-report    # docs/IMPORT_REPORT.md — разбор встроенных TXT-заметок
npx electron . --smoke-test   # самопроверка: база, импорт, интерфейс, IPC; код выхода 0/1
```

Интеграционные SSH-тесты против настоящего OpenSSH:

```bash
docker run -d --name nad-sshd -p 2222:22 <образ с openssh-server>   # см. .github/workflows/build.yml
NAD_SSH_HOST=127.0.0.1 NAD_SSH_PORT=2222 NAD_SSH_USER=nad NAD_SSH_PASS=... npm run test:ssh
```

Предпросмотр интерфейса в браузере (без Electron, с имитацией API и SSH): `npm run preview`, затем открыть `dist-preview/renderer/index.html` через любой локальный HTTP-сервер.

## Установщики

```bash
npm run dist:win     # на Windows → release/NetAdminDesk-Windows-x64-Setup.exe
npm run dist:mac     # на macOS   → release/NetAdminDesk-macOS-Universal.dmg
npm run dist:linux   # на Linux   → release/netadmindesk-linux-amd64.deb
```

Настройки — в `electron-builder.yml`. Имена файлов заданы через `artifactName`.

### Иконки

Исходник логотипа — `build/logo.svg`. Все иконки получаются из него скриптом и лежат в репозитории, поэтому для обычной сборки ничего запускать не нужно; после изменения логотипа:

```bash
python3 scripts/make-icons.py   # нужны rsvg-convert (librsvg) и Pillow
```

| Файл | Где используется |
|---|---|
| `build/icon.png` (1024 px) | Linux (.deb), значок окна |
| `build/icon-mac.png` (1024 px, с полями) | macOS — поля по сетке значков, иначе значок в Dock крупнее соседних |
| `build/icon.ico` (16–256 px) | Windows; в размерах до 32 px линии знака толще |
| `build/tray.png`, `tray@2x.png` | область уведомлений Windows и Linux |
| `build/trayTemplate.png`, `@2x` | строка меню macOS (силуэт, цвет подставляет система) |

Знак в интерфейсе (боковая панель, «О программе») — компонент `src/renderer/components/Logo.tsx` с той же геометрией.

## CI/CD (GitHub Actions)

`.github/workflows/build.yml`:

| Задача | Что делает |
|---|---|
| `test` | модульные тесты (node:sqlite и sql.js), проверка типов (не блокирует), раннер ubuntu-24.04, сборка, отчёт импорта TXT |
| `ssh-integration` | поднимает OpenSSH в docker и проверяет: подключение и запрос отпечатка, блокировку при смене ключа, exec, интерактивную оболочку, маскировку паролей в истории, SFTP, локальный туннель |
| `package` (Windows, macOS, Linux) | сборка установщика, проверка имени файла, **запуск собранного приложения** с `--smoke-test`: Windows — тихая установка NSIS и запуск установленной программы; macOS — монтирование `.dmg`, проверка, что бинарник универсальный (`lipo`: x86_64 и arm64), проверка ad-hoc подписи, запуск; Linux — установка `.deb` через apt (проверяются зависимости пакета) и запуск под Xvfb. Публикует установщик и `.sha256` как артефакт |
| `release` | для тегов `v*`: публикует релиз GitHub с тремя установщиками и их `.sha256`; текст релиза — раздел этой версии из `CHANGELOG.md` (если раздела нет, публикация останавливается с ошибкой). Теги с дефисом (`v1.2.0-rc.1`) публикуются как предварительные версии |

Выпуск версии (подробнее — в [CONTRIBUTING.md](../CONTRIBUTING.md#выпуск-версии)):

```bash
# 1. CHANGELOG.md: пункты из [Unreleased] → новый раздел «## [1.2.0] — ГГГГ-ММ-ДД», ссылки внизу файла
# 2. версия в package.json и VERSION
npm version 1.2.0 --no-git-tag-version
echo 1.2.0 > VERSION
# 3. коммит, аннотированный тег и отправка
git commit -am "chore(release): 1.2.0"
git tag -a v1.2.0 -m "NetAdmin Desk 1.2.0"
git push --follow-tags
```

## Неподписанные сборки

У проекта нет сертификата подписи кода Windows и сертификата Apple Developer ID, поэтому:

**Windows.** SmartScreen покажет «Система Windows защитила ваш компьютер». Нажмите «Подробнее» → «Выполнить в любом случае». Проверьте контрольную сумму: `Get-FileHash NetAdminDesk-Windows-x64-Setup.exe -Algorithm SHA256`.

**macOS.** Приложение подписано только ad-hoc (`codesign --sign -`) — без этого на Apple Silicon оно не запустится вовсе. Нотаризации нет, поэтому Gatekeeper при первом запуске сообщит, что не может проверить разработчика:
- macOS 15 и новее: попытайтесь открыть приложение, затем «Системные настройки → Конфиденциальность и безопасность» → «Всё равно открыть»;
- если macOS сообщает, что приложение «повреждено», или кнопки «Всё равно открыть» нет — снимите карантинный атрибут в Терминале после копирования в «Программы»: `xattr -dr com.apple.quarantine "/Applications/NetAdmin Desk.app"`.

**Linux.** Подпись пакетов `.deb` не используется; установка: `sudo apt install ./netadmindesk-linux-amd64.deb` (apt подтянет зависимости, включая `libsecret-1-0` для хранения паролей в связке ключей).

### Как подписать, если появятся сертификаты

- Windows: переменные `CSC_LINK` (путь или base64 файла `.pfx`) и `CSC_KEY_PASSWORD` в секретах репозитория; убрать `CSC_IDENTITY_AUTO_DISCOVERY: false`.
- macOS: `CSC_LINK`/`CSC_KEY_PASSWORD` с сертификатом Developer ID Application, в `electron-builder.yml` убрать `identity: null`, включить `hardenedRuntime: true`, добавить нотаризацию (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) и удалить хук `afterSign` с ad-hoc подписью.

## Кодировки и окончания строк

Исходные TXT пользователя (`data/user/*.txt`) хранятся побайтно как есть; при импорте определяется кодировка (UTF-8, UTF-16, Windows-1251). Не включайте автоматическое преобразование окончаний строк для этих файлов (см. `.gitattributes`).
