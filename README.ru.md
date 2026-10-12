<div align="center">
  <picture>
    <source srcset="https://raw.githubusercontent.com/TheVilfer/better-tg-cli/main/assets/banner-dark.png" media="(prefers-color-scheme: dark)"/>
    <source srcset="https://raw.githubusercontent.com/TheVilfer/better-tg-cli/main/assets/banner-light.png" media="(prefers-color-scheme: light)"/>
    <img src="https://raw.githubusercontent.com/TheVilfer/better-tg-cli/main/assets/banner-light.png" alt="Better-TG-CLI"/>
  </picture>

  [![npm version](https://img.shields.io/npm/v/better-tg-cli?style=flat&colorA=000000&colorB=000000)](https://www.npmjs.com/package/better-tg-cli)
  [![CI](https://img.shields.io/github/actions/workflow/status/TheVilfer/better-tg-cli/ci.yml?branch=main&label=ci&style=flat&colorA=000000&colorB=000000)](https://github.com/TheVilfer/better-tg-cli/actions/workflows/ci.yml)
  [![npm provenance](https://img.shields.io/badge/npm-provenance-000000?style=flat&colorA=000000&colorB=000000&logo=npm)](https://www.npmjs.com/package/better-tg-cli#provenance)
  [![install size](https://img.shields.io/npm/unpacked-size/better-tg-cli?label=size&style=flat&colorA=000000&colorB=000000)](https://www.npmjs.com/package/better-tg-cli)
  [![dependencies](https://img.shields.io/badge/dependencies-0-000000?style=flat&colorA=000000&colorB=000000)](package.json)
  [![MCP](https://img.shields.io/badge/MCP-server-000000?style=flat&colorA=000000&colorB=000000)](#mcp-сервер)
  [![platforms](https://img.shields.io/badge/macOS%20%C2%B7%20Linux-000000?style=flat&colorA=000000&colorB=000000&logo=apple)](#установка)
  [![license](https://img.shields.io/badge/license-MIT-000000?style=flat&colorA=000000&colorB=000000)](LICENSE)

  <p>
    <a href="#установка">Установка</a> · <a href="skills/better-tg-cli/reference.md">Справка</a> · <a href="SECURITY.md">Безопасность</a> · <a href="https://github.com/TheVilfer/better-tg-cli/issues">Issues</a> · <a href="README.md">English</a> · <a href="README.es.md">Español</a>
  </p>
</div>

https://github.com/user-attachments/assets/d143f7c7-7d50-439c-b373-cbcbff5a6675

Неофициальный консольный клиент Telegram, который работает **от вашего собственного аккаунта**
(MTProto через [`teleproto`](https://www.npmjs.com/package/teleproto), TL layer 229). Команда
называется `telegram`. В ней около 60 команд: чтение, поиск, отправка, боты, группы, выгрузка. Всё
сделано так, чтобы им было дёшево и безопасно пользоваться ИИ-агентам (Claude Code, Codex и другим).

```console
$ telegram inbox -n 3
48 unread in 7 chats (showing 3)
1234567890 user unread=2 Алиса @alice | в 7 в силе?
-1001234567 supergroup muted unread=41 Rust Seattle @rust_sea | кто уже пробовал 1.90?
-1009876543 channel unread=5 Changelog | вышла v2.4
```

> [!WARNING]
> **Аккаунт ваш, и риск тоже ваш.** Это неофициальный клиент, и входит он от вашего имени.
> Telegram может ограничить или заморозить аккаунт, который ведёт себя как бот. Сильнее всего
> рискуют новые аккаунты, массовые рассылки, массовые вступления и приглашения и всё, что похоже на
> спам. Пользуйтесь им так же, как пользовались бы самим Telegram. Держите запись выключенной, пока
> она не нужна. Прежде чем разрешать агенту писать, прочитайте [SECURITY.md](SECURITY.md). Авторы
> не отвечают за ограниченные аккаунты.

**Содержание:** [Чем этот форк лучше](#чем-этот-форк-лучше) · [Установка](#установка) · [Вход](#вход) · [Использование](#использование) · [MCP-сервер](#mcp-сервер) · [FAQ](#faq) · [Разработка](#разработка) · [Приватность](#приватность) · [Лицензия](#лицензия)

## Чем этот форк лучше

Это форк [skillhq/telegram](https://github.com/skillhq/telegram), переделанный под агентов:

- **Актуальный слой Telegram.** Ответы ботов с rich-контентом (layer 228+) показывают текст, а не
  `(no text)`. Можно нажимать кнопки ботов (`click`) и ходить по их меню.
- **Экономия токенов.** Вне терминала каждый элемент занимает одну строку, и ID идёт первым. JSON
  выводится в одну строку без пустых полей. `--max-text` обрезает длинные посты. `telegram help-all
  -g <слово>` показывает все флаги, и этот список генерируется из кода.
- **Точное чтение.** `--since` и `--until` честно листают историю. Работают `--unread`, треды и
  комментарии в каналах, темы форумов, `get` по ID, поиск по типу, отправителю и дате. `me` и
  `Избранное` означают «Избранное».
- **Безопасность по умолчанию.** Аккаунт открыт только на чтение, пока человек не выполнит
  `write-access on [--for 1h]` и не подтвердит это в терминале или в диалоге macOS. Сам агент
  запись не включит. Каждая запись попадает в `~/.config/tg/audit.jsonl`. Секреты хранятся в
  Keychain macOS, в Secret Service на Linux или в 1Password.
- **Маленький и самодостаточный.** npm-пакет — один файл на 0,3 МБ без runtime-зависимостей.
  Homebrew ставит отдельный бинарник, которому не нужен Node.

## Установка

```bash
brew install thevilfer/tap/better-tg-cli   # отдельный бинарник, macOS и Linux
npm install -g better-tg-cli               # Node >= 20, любая ОС
```

На Windows (экспериментально) через [Scoop](https://scoop.sh) или npm:

```powershell
scoop bucket add thevilfer https://github.com/TheVilfer/scoop-bucket
scoop install better-tg-cli
```

`telegram.exe` для Windows не подписан, поэтому SmartScreen может предупредить при скачивании из релиза.

`telegram update` обновляет CLI тем же способом, каким он был установлен. В терминале CLI раз в
сутки проверяет, не вышла ли новая версия. Агенты и пайпы этого уведомления не видят, а
`TG_NO_UPDATE_CHECK=1` отключает его совсем.

Бинарник, скачанный вручную из Releases на macOS, не нотаризован. Один раз снимите с него карантин:
`xattr -d com.apple.quarantine ./telegram`. Homebrew делает это сам.

Не ставьте `@skillhq/telegram`. Это старая сборка апстрима на GramJS (layer 198).

Все каналы получают одну и ту же версию из одного релиза:

| Где | Что | Установка |
|---|---|---|
| [Homebrew](https://github.com/TheVilfer/homebrew-tap) | отдельный бинарник | `brew install thevilfer/tap/better-tg-cli` |
| [npm](https://www.npmjs.com/package/better-tg-cli) | CLI и MCP-сервер (Node 20+) | `npm install -g better-tg-cli` |
| [Scoop](https://github.com/TheVilfer/scoop-bucket) (Windows, экспериментально) | отдельный `telegram.exe` | `scoop bucket add thevilfer https://github.com/TheVilfer/scoop-bucket`, затем `scoop install better-tg-cli` |
| [GitHub Releases](https://github.com/TheVilfer/better-tg-cli/releases) | бинарники и SHA256SUMS | скачать вручную |
| Плагин Claude Code | скилл и MCP-сервер | [см. ниже](#плагин-для-claude-code) |
| Расширение Claude Desktop | MCP-сервер на встроенном Node из Claude | [скачать `.mcpb`](https://github.com/TheVilfer/better-tg-cli/releases/latest/download/better-tg-cli.mcpb) и открыть |
| Плагин Grok Build | скилл и MCP-сервер | [см. ниже](#плагин-для-grok-build) |
| Расширение Gemini CLI | скилл и MCP-сервер | `gemini extensions install https://github.com/TheVilfer/better-tg-cli` |
| Cursor, VS Code | MCP-сервер | [кнопки в один клик](#mcp-сервер) |
| Grok Bot | MCP-сервер по HTTP с вашего Mac | [см. ниже](#grok-bot-удалённый-mcp-по-http) |
| Сам CLI | скилл для Claude Code, Codex, Cursor, Gemini CLI и ещё 7 агентов | `telegram skill install` |
| [skills.sh](https://skills.sh) | скилл для любого агента с шеллом | `npx skills add TheVilfer/better-tg-cli` |
| [MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=better-tg-cli) | запись MCP-сервера `io.github.TheVilfer/better-tg-cli` | через ваш MCP-клиент |

### Плагин для Claude Code

Скилл и MCP-сервер ставятся вместе:

```
/plugin marketplace add TheVilfer/better-tg-cli
/plugin install better-tg-cli@better-tg-cli
```

MCP-сервер запускается через `npx`, так что хватит Node 20+. Один раз войдите в терминале:
`telegram auth --qr` (или `npx better-tg-cli auth --qr`).

### Плагин для Codex

Тот же скилл и MCP-сервер в виде плагина Codex (он появится и в десктопном приложении ChatGPT):

```bash
codex plugin marketplace add TheVilfer/better-tg-cli
codex plugin add better-tg-cli@better-tg-cli
```

### Плагин для Grok Build

[Grok Build](https://x.ai/cli) ставит тот же плагин, скилл и MCP-сервер вместе:

```bash
grok plugin install TheVilfer/better-tg-cli --trust
# или сначала маркетплейс, потом установка из меню /plugins:
grok plugin marketplace add TheVilfer/better-tg-cli && grok plugin install better-tg-cli --trust
```

### Как скилл для агента

Скилл ([`skills/better-tg-cli`](skills/better-tg-cli/SKILL.md)) учит любого агента с шеллом
(Claude Code, Codex, Cursor, Gemini CLI, OpenCode и других) безопасно работать с CLI. Он проверяет
установку, никогда не входит сам, держит запись под вашим подтверждением и обходит действия, за
которые банят. Скилл лежит внутри CLI, и CLI ставит его сам, поэтому версии всегда совпадают:

```bash
telegram skill install                  # во все поддерживаемые агенты на этой машине
telegram skill install -a claude-code codex
telegram skill status                   # по каждому агенту: стоит, устарел, симлинк или нет
```

Поддерживаются Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, Grok Build, OpenCode,
Goose, Droid, Windsurf и Pi (папки показывает `telegram skill status`). После `telegram update`
запустите команду ещё раз, чтобы обновить скилл. Папку-симлинк команда не трогает без `--force`.
Для остальных агентов есть CLI [skills](https://skills.sh):

```bash
npx skills add TheVilfer/better-tg-cli          # агенты выбираются интерактивно
npx skills add TheVilfer/better-tg-cli -g -a claude-code -a codex -y
```

## Вход

**Через агента** (проще всего): попросите его подключить Telegram или запустите `telegram onboard`
сами. Откроется страница на 127.0.0.1: там вы получаете ключ входа на [better-tg-cli.com](https://better-tg-cli.com)
(он сам возвращается на страницу) или вводите свои ключи, сканируете QR и вводите пароль 2FA. Агент
только запускает команду и ждёт: ни ключ входа, ни QR, ни пароль он не видит. Страница отвечает только
по случайному секретному адресу и закрывается после входа.

**Со своими API-ключами** (основной способ):
1. Откройте https://my.telegram.org/apps, создайте приложение и скопируйте `api_id` и `api_hash`.
2. Запустите `telegram auth --qr` и введите их. Затем на телефоне откройте Настройки → Устройства →
   Подключить устройство и отсканируйте QR-код. Если у вас есть облачный пароль, введите его.
   Обычный `telegram auth` вместо QR спрашивает номер телефона и код. Если в светлой теме
   терминала QR не сканируется, запустите с `TG_QR_INVERT=1`.

**По ключу входа.** С ключом входа свои API-ключи не нужны. Получите его на
[better-tg-cli.com](https://better-tg-cli.com/login) (почта подтверждается кодом, там же гайд по
установке) или у мейнтейнера. Запустите `telegram auth --login-key --qr` и вставьте ключ. Его также
можно передать через `TG_LOGIN_KEY=…` или `--login-key -`. Сервис входа (`broker/`) выдаёт ключи
приложения один раз, только для этого входа. `api_hash` на вашей машине не сохраняется. Ключи входа
персональные, работают на 3 компьютерах, и их можно отозвать. До версии 0.37 ключ назывался
инвайтом: `--invite` и `TG_INVITE` по-прежнему работают.

Сессия хранится в Keychain macOS (сервис `tg-cli`) или в 1Password с флагом `--op-vault <vault>`.
`telegram logout` её удаляет. На Linux сессия хранится в Secret Service (GNOME Keyring, KWallet,
KeePassXC) через `secret-tool`, для этого нужен пакет `libsecret-tools`. Сессия, которая уже лежит
в конфиге, переедет туда сама. Если хранилища секретов нет, сессия лежит в
`~/.config/tg/config.json5` (права 0600), а запись остаётся выключенной. На Linux
`write-access on` подтверждается в терминале. На Windows секреты лежат в
`%APPDATA%\tg\secrets.dpapi`, зашифрованные DPAPI для вашего пользователя Windows (расшифровать их
можете только вы на этой машине), а `write-access on` без терминала спрашивает в окне «Да/Нет».

## Использование

```bash
telegram chats --type channel                 # чат в одну строку, ID первым
telegram read "Чат" --since 1h                # точный диапазон, новые сверху (--asc наоборот)
telegram read @channel --thread 123           # комментарии к посту
telegram search "счёт" --chat "Работа" --type document
telegram get "Чат" 812 813                    # конкретные сообщения по ID
telegram download "Чат" 812                   # сохранить вложение
telegram sync --chat "Чат" --output ./export --resume   # инкрементальная выгрузка в markdown

telegram write-access on --for 1h             # подтверждает человек
telegram send @alice "уже еду"
printf '%s' "$text" | telegram send @alice -  # длинный или многострочный текст: из stdin, без проблем с кавычками
telegram reply "Чат" 812 "беру" --silent
telegram click @SomeBot 4410 "Настройки"      # нажать инлайн-кнопку
```

Команды чтения принимают `--json`, а некоторые и `--markdown`. Все команды выводит
`telegram help-all`. В [reference.md](skills/better-tg-cli/reference.md) описано то, чего не видно по списку флагов:
форматы вывода, треды, кнопки ботов, админские команды, решение проблем.

## MCP-сервер

Для клиентов без шелла (Claude Desktop, Cursor и других MCP-хостов) `telegram mcp` поднимает по
stdio три инструмента:
- `telegram_help` — справка по флагам с поиском;
- `telegram_read` — только чтение, клиенты могут разрешать его без вопросов;
- `telegram_write` — помечен как опасный и по-прежнему требует от вас `write-access on`.

Сначала войдите через `telegram auth` в терминале. Затем установите сервер в один клик:

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=telegram&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImJldHRlci10Zy1jbGlAbGF0ZXN0IiwibWNwIl19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_MCP-000000?style=flat&colorA=000000&colorB=000000)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522telegram%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522better-tg-cli%2540latest%2522%252C%2522mcp%2522%255D%257D)
[![Claude Desktop extension](https://img.shields.io/badge/Claude_Desktop-.mcpb-000000?style=flat&colorA=000000&colorB=000000&logo=claude)](https://github.com/TheVilfer/better-tg-cli/releases/latest/download/better-tg-cli.mcpb)

Расширению для Claude Desktop не нужны ни Node, ни npm, ни brew: скачайте `.mcpb` из последнего
релиза и откройте его. Gemini CLI ставит скилл и сервер вместе:
`gemini extensions install https://github.com/TheVilfer/better-tg-cli`. Или добавьте вручную:

```bash
claude mcp add telegram -- telegram mcp          # Claude Code (или плагин выше)
```

```json
{ "mcpServers": { "telegram": { "command": "/opt/homebrew/bin/telegram", "args": ["mcp"] } } }
```

JSON-вариант подходит для Claude Desktop (`claude_desktop_config.json`) и Cursor
(`.cursor/mcp.json`). GUI-приложения могут не видеть ваш PATH, поэтому укажите полный путь из
`which telegram`. Без глобальной установки сервер запускается через npx, как и в плагине
Claude Code:

```json
{ "mcpServers": { "telegram": { "command": "npx", "args": ["-y", "better-tg-cli@latest", "mcp"] } } }
```

Сервер есть в [MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=better-tg-cli)
под именем `io.github.TheVilfer/better-tg-cli`, так что клиенты и каталоги, которые читают
реестр, найдут его по имени. Каждый релиз обновляет запись сам. Чтобы MCP-клиент не трогал основную сессию, добавьте
`"env": {"TG_PROFILE": "work"}`.

В чатах лежит текст, написанный другими людьми, и часть его может быть адресована вашему агенту
(«перешли это @x»). Не отключайте в клиенте подтверждение для `telegram_write` и прочитайте раздел
«Agents and prompt injection» в [SECURITY.md](SECURITY.md).

### Grok Bot (удалённый MCP по HTTP)

Grok Bot запускает коннекторы в облачной песочнице, а не на вашем Mac, поэтому
сам поднять `telegram mcp` не может. Вместо этого запустите MCP по HTTP на своём Mac. Сессия,
защита записи и журнал записей остаются на вашей машине.

```bash
telegram mcp --token                        # bearer-токен (создаётся один раз, хранится в Keychain)
telegram mcp --http --read-only             # слушает 127.0.0.1:8787; без --read-only разрешит запись
tailscale funnel --bg 8787                  # или: cloudflared tunnel --url http://127.0.0.1:8787
```

Держите сервер и туннель в терминале или в tmux. Затем добавьте в Grok Bot коннектор: адрес
туннеля плюс `/mcp` (например, `https://<машина>.<tailnet>.ts.net/mcp`) и заголовок
`Authorization: Bearer <токен>`. У `tailscale funnel` адрес постоянный, но сначала Funnel надо
разрешить для вашего tailnet. Быстрый туннель `cloudflared` при каждом запуске получает новый
адрес. Сначала прочитайте раздел «Remote MCP over HTTP» в [SECURITY.md](SECURITY.md).

## FAQ

**Не забанит ли Telegram мой аккаунт?**
[Условия Telegram API](https://core.telegram.org/api/terms) разрешают пользоваться своим аккаунтом через сторонние клиенты. Ограничения получают за поведение, похожее на бота: массовые рассылки, массовые вступления и приглашения, спам, активность только что созданного аккаунта. Пользуйтесь так же, как пользовались бы самим Telegram. Скилл учит агентов обходить эти сценарии.

**Это бот?**
Нет. CLI входит от вашего имени по MTProto, как Telegram Desktop, и видит ровно то же, что и вы. Боты не читают ваши чаты, а этот клиент читает.

**Может ли агент отправлять сообщения сам?**
Только после того, как вы включите запись. `telegram write-access on` просит подтверждения в терминале или в диалоге macOS, на которое агент ответить не может. Дальше запись требует точно указанный чат, а каждая отправка пишется в журнал. В MCP запись вынесена в отдельный инструмент, и клиенты могут спрашивать вас перед каждым вызовом. Подробнее в [SECURITY.md](SECURITY.md).

**Отмечает ли чтение сообщения прочитанными?**
Нет. `read`, `inbox` и `search` оставляют чаты непрочитанными. Отмечает только `telegram mark-read`.

**Нужны ли свои API-ключи?**
Да, с [my.telegram.org/apps](https://my.telegram.org/apps). Они бесплатные, их создание занимает минуту. С ключом входа с [better-tg-cli.com](https://better-tg-cli.com/login) `telegram auth --login-key --qr` войдёт без своих ключей.

**Где хранится сессия и кто видит мои сообщения?**
Сессия лежит в Keychain macOS, в Secret Service на Linux или в 1Password. CLI общается с Telegram напрямую, аналитики нет. Кроме Telegram, он ходит только в npm (раз в день за номером версии) и в сервис входа, если вы входите по ключу входа. Подробнее в [PRIVACY.md](PRIVACY.md).

**Можно ли несколько аккаунтов?**
Да, через `TG_PROFILE`: у каждого профиля свой вход, конфиг и записи в Keychain, например `TG_PROFILE=work telegram auth --qr`. Удобное переключение аккаунтов — в [#5](https://github.com/TheVilfer/better-tg-cli/issues/5).

**Работает ли на Windows?**
Да, экспериментально: `scoop install better-tg-cli` или npm. Секреты хранятся через Windows DPAPI,
тесты гоняются на Windows в CI, но вживую там проверено меньше, чем на macOS и Linux. О проблемах
пишите в issues.

**Можно ли пользоваться из Grok Bot, ChatGPT или другого облачного агента?**
Облачный агент не может запустить программу на вашем компьютере, поэтому поднимите MCP-сервер по HTTP и откройте к нему туннель. См. [Grok Bot](#grok-bot-удалённый-mcp-по-http).

**Как обновиться?**
`telegram update`. Команда обновляет тем же способом, каким CLI был установлен: Homebrew, npm или бинарник из релиза.
Если скилл для агентов ставили через `telegram skill install`, запустите её ещё раз, чтобы обновить скилл.

## Разработка

В [DEVELOPMENT.md](DEVELOPMENT.md) описаны:
- запуск из исходников (`scripts/tg-dev`);
- изолированные dev-профили (`TG_PROFILE`), которые не трогают вашу настоящую сессию;
- тестовые серверы Telegram;
- отладка в редакторе и тесты.

Релиз готовит `scripts/release.sh` (PR с новой версией, она считается по заголовкам PR), после мержа `scripts/release.sh tag` ставит тег. Тег собирает бинарники и публикует их в
GitHub Releases, в npm (trusted publishing с provenance), в Homebrew-тап и в MCP Registry. Подробнее в
[CONTRIBUTING.md](CONTRIBUTING.md).

## Удаление

1. `telegram logout` удаляет сохранённую сессию. Чтобы завершить её и на стороне Telegram,
   закройте её в Telegram → Настройки → Устройства.
2. `telegram skill uninstall` убирает скилл из агентов, куда он был установлен.
3. Удалите саму программу: `brew uninstall better-tg-cli`, `npm uninstall -g better-tg-cli` или
   `scoop uninstall better-tg-cli`. Бинарник из Releases удаляется как обычный файл.
4. Удалите папку настроек: `~/.config/tg` (`%APPDATA%\tg` на Windows) и `~/.config/tg-<профиль>`
   для каждого `TG_PROFILE`, который вы использовали. На Windows вместе с ней удалится и файл секретов
   DPAPI. На других системах api_hash и флаг write-access остаются в хранилище секретов: удалите
   записи `tg-cli` в «Связке ключей» (или `secret-tool clear service tg-cli`) либо запись в 1Password.

## Приватность

Аналитики нет. Единственный наш сервис — необязательный сервис входа, и он не видит ни ваших
сообщений, ни сессии. В [PRIVACY.md](PRIVACY.md) перечислены три хоста, с которыми общается CLI,
и то, что он хранит локально.

## Code signing policy

Бинарники для Windows собираются из этого репозитория только в GitHub Actions
(`.github/workflows/release.yml`), никогда не на личной машине. Мы подали заявку на бесплатную
подпись кода от SignPath Foundation; когда её одобрят, в релизах будет: *Free code signing provided
by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).*
Пока `telegram.exe` для Windows не подписан; бинарники для macOS подписаны ad-hoc.

- Коммиттеры и ревьюеры: [@TheVilfer](https://github.com/TheVilfer)
- Утверждают каждый подписанный релиз: [@TheVilfer](https://github.com/TheVilfer)
- Политика приватности: [PRIVACY.md](PRIVACY.md). CLI обращается только к Telegram, к сервису
  входа при входе по ключу входа и раз в день к npm-реестру за номером версии, если запущен в
  терминале (отключается `TG_NO_UPDATE_CHECK=1`).

## Лицензия

MIT, см. [LICENSE](LICENSE). Основано на [skillhq/telegram](https://github.com/skillhq/telegram)
Дерека Рейна. Проект не связан с Telegram и не одобрен им; «Telegram» — товарный знак своего
владельца. Используйте в соответствии с [условиями Telegram API](https://core.telegram.org/api/terms).
