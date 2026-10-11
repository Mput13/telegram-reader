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
  [![MCP](https://img.shields.io/badge/MCP-server-000000?style=flat&colorA=000000&colorB=000000)](#servidor-mcp)
  [![platforms](https://img.shields.io/badge/macOS%20%C2%B7%20Linux-000000?style=flat&colorA=000000&colorB=000000&logo=apple)](#instalación)
  [![license](https://img.shields.io/badge/license-MIT-000000?style=flat&colorA=000000&colorB=000000)](LICENSE)

  <p>
    <a href="#instalación">Instalación</a> · <a href="skills/better-tg-cli/reference.md">Referencia</a> · <a href="SECURITY.md">Seguridad</a> · <a href="https://github.com/TheVilfer/better-tg-cli/issues">Issues</a> · <a href="README.md">English</a> · <a href="README.ru.md">Русский</a>
  </p>
</div>

https://github.com/user-attachments/assets/d143f7c7-7d50-439c-b373-cbcbff5a6675

Un cliente de línea de comandos no oficial para Telegram, pensado para agentes, que funciona **con tu
propia cuenta** (MTProto mediante [`teleproto`](https://www.npmjs.com/package/teleproto), TL layer 229).
El comando es `telegram`: unos 60 comandos para leer, buscar, escribir, bots, grupos y exportaciones,
diseñados para que los agentes de IA (Claude Code, Codex, …) puedan manejarlo de forma barata y segura.

```console
$ telegram inbox -n 3
48 unread in 7 chats (showing 3)
1234567890 user unread=2 Alice @alice | see you at 7?
-1001234567 supergroup muted unread=41 Rust Seattle @rust_sea | anyone tried 1.90?
-1009876543 channel unread=5 Changelog | v2.4 is out
$ telegram read @alice -n 1 --json
{"chatTitle":"Alice","messages":[{"id":812,"date":"2026-09-27T10:02:11.000Z","sender":"Alice","senderId":"1234567890","text":"see you at 7?"}]}
```

> [!WARNING]
> **Tu cuenta, tu riesgo.** Este es un cliente no oficial que inicia sesión como tú. Telegram puede
> limitar o congelar las cuentas que se comportan como bots. El riesgo es mayor para las cuentas
> nuevas, los envíos masivos, las uniones o invitaciones en masa y todo lo que parezca spam. Úsalo
> como usarías Telegram tú mismo, mantén la escritura desactivada salvo que la necesites y lee
> [SECURITY.md](SECURITY.md) antes de dejar que un agente escriba. Los autores no se hacen
> responsables de las cuentas restringidas.

**Contenido:** [Por qué este fork](#por-qué-este-fork) · [Instalación](#instalación) · [Inicio de sesión](#inicio-de-sesión) · [Uso](#uso) · [Servidor MCP](#servidor-mcp) · [FAQ](#faq) · [Desarrollo](#desarrollo) · [Privacidad](#privacidad) · [Licencia](#licencia)

## Por qué este fork

Un fork de [skillhq/telegram](https://github.com/skillhq/telegram), rehecho para agentes:

- **Capa de Telegram actual.** Las respuestas de bots con contenido enriquecido (layer 228+) muestran
  el texto real en lugar de `(no text)`. Puedes pulsar botones de bots (`click`) y recorrer sus menús.
- **Salida que ahorra tokens.** Fuera de una TTY obtienes una línea compacta por elemento con el ID
  primero, y JSON en una sola línea sin los campos vacíos. `--max-text` recorta las publicaciones
  largas. `telegram help-all -g <palabra>` muestra todos los flags, generados a partir del código.
- **Lecturas exactas.** Paginación real para `--since/--until`, `--unread`, hilos y comentarios de
  canales, temas de foros, `get` por ID, filtros de búsqueda por tipo, remitente o fecha, y `me` /
  `Избранное` para los Mensajes guardados.
- **Seguro por defecto.** La cuenta es de solo lectura hasta que una persona ejecuta
  `write-access on [--for 1h]` y lo confirma en un prompt del terminal o en un diálogo de macOS, así
  que un agente no puede activarlo por su cuenta. Cada escritura se registra en
  `~/.config/tg/audit.jsonl`. Los secretos se guardan en el Keychain de macOS, en el Secret Service
  de Linux o en 1Password.
- **Pequeño y autónomo.** El paquete de npm es un único archivo de 0,3 MB sin dependencias en tiempo
  de ejecución. Homebrew instala un binario independiente que no necesita Node.

## Instalación

```bash
brew install thevilfer/tap/better-tg-cli   # binario independiente, macOS y Linux
npm install -g better-tg-cli               # Node >= 20, cualquier sistema operativo
```

En Windows (experimental), con [Scoop](https://scoop.sh) o npm:

```powershell
scoop bucket add thevilfer https://github.com/TheVilfer/scoop-bucket
scoop install better-tg-cli
```

El `telegram.exe` de Windows no tiene firma de código, así que SmartScreen puede mostrar una
advertencia al descargarlo desde la release.

`telegram update` actualiza una instalación existente, sea cual sea el método que usaste. En un
terminal, el CLI busca nuevas versiones una vez al día. Los agentes y los pipes nunca ven ese aviso,
y `TG_NO_UPDATE_CHECK=1` lo desactiva.

¿Descargas a mano un binario desde Releases en macOS? No está notarizado, así que quítale la marca de
cuarentena una vez: `xattr -d com.apple.quarantine ./telegram`. Homebrew lo hace por ti.

**No** instales `@skillhq/telegram`. Es la build antigua del upstream sobre GramJS (layer 198).

Todos los canales distribuyen la misma versión desde una única release:

| Dónde | Qué obtienes | Instalación |
|---|---|---|
| [Homebrew](https://github.com/TheVilfer/homebrew-tap) | binario independiente | `brew install thevilfer/tap/better-tg-cli` |
| [npm](https://www.npmjs.com/package/better-tg-cli) | CLI y servidor MCP (Node 20+) | `npm install -g better-tg-cli` |
| [Scoop](https://github.com/TheVilfer/scoop-bucket) (Windows, experimental) | `telegram.exe` independiente | `scoop bucket add thevilfer https://github.com/TheVilfer/scoop-bucket` y luego `scoop install better-tg-cli` |
| [GitHub Releases](https://github.com/TheVilfer/better-tg-cli/releases) | binarios y SHA256SUMS | descarga manual |
| Plugin de Claude Code | skill y servidor MCP | [ver abajo](#plugin-para-claude-code) |
| Extensión de Claude Desktop | servidor MCP, se ejecuta con el Node integrado de Claude | [descarga el `.mcpb`](https://github.com/TheVilfer/better-tg-cli/releases/latest/download/better-tg-cli.mcpb) y ábrelo |
| Plugin de Grok Build | skill y servidor MCP | [ver abajo](#plugin-para-grok-build) |
| Extensión de Gemini CLI | skill y servidor MCP | `gemini extensions install https://github.com/TheVilfer/better-tg-cli` |
| Cursor, VS Code | servidor MCP | [botones de un clic](#servidor-mcp) |
| Grok Bot | servidor MCP por HTTP desde tu Mac | [ver abajo](#grok-bot-mcp-remoto-por-http) |
| El propio CLI | skill de agente para Claude Code, Codex, Cursor, Gemini CLI y 7 más | `telegram skill install` |
| [skills.sh](https://skills.sh) | skill de agente para cualquier agente con shell | `npx skills add TheVilfer/better-tg-cli` |
| [MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=better-tg-cli) | entrada del servidor MCP `io.github.TheVilfer/better-tg-cli` | desde tu cliente MCP |

### Plugin para Claude Code

La skill y el servidor MCP juntos, en una sola instalación:

```
/plugin marketplace add TheVilfer/better-tg-cli
/plugin install better-tg-cli@better-tg-cli
```

Ejecuta el servidor MCP mediante `npx`, así que basta con Node 20+. Inicia sesión una vez con
`telegram auth --qr` (o `npx better-tg-cli auth --qr`) en un terminal.

### Plugin para Codex

La misma skill y el mismo servidor MCP como plugin de Codex (también aparece en la app de escritorio
de ChatGPT):

```bash
codex plugin marketplace add TheVilfer/better-tg-cli
codex plugin add better-tg-cli@better-tg-cli
```

### Plugin para Grok Build

[Grok Build](https://x.ai/cli) instala el mismo plugin, con la skill y el servidor MCP juntos:

```bash
grok plugin install TheVilfer/better-tg-cli --trust
# o añade primero el marketplace y luego instala desde el menú /plugins:
grok plugin marketplace add TheVilfer/better-tg-cli && grok plugin install better-tg-cli --trust
```

### Como skill de agente

La skill ([`skills/better-tg-cli`](skills/better-tg-cli/SKILL.md)) enseña a cualquier agente con
shell (Claude Code, Codex, Cursor, Gemini CLI, OpenCode y otros) a usar el CLI de forma segura.
Comprueba la configuración, nunca inicia sesión por su cuenta, deja las escrituras sujetas a tu
aprobación y evita los patrones que llevan a un baneo. El CLI incluye la skill y la instala él mismo,
así que siempre coincide con tu versión:

```bash
telegram skill install                  # en todos los agentes compatibles de esta máquina
telegram skill install -a claude-code codex
telegram skill status                   # instalada, desactualizada, enlazada o ausente, por agente
```

Conoce Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, Grok Build, OpenCode, Goose, Droid,
Windsurf y Pi (`telegram skill status` lista las carpetas). Vuelve a ejecutarlo después de
`telegram update` para actualizar la skill. Una carpeta de skill que sea un enlace simbólico no se
toca a menos que pases `--force`. Para otros agentes, usa el CLI [skills](https://skills.sh):

```bash
npx skills add TheVilfer/better-tg-cli          # elige los agentes de forma interactiva
npx skills add TheVilfer/better-tg-cli -g -a claude-code -a codex -y
```

## Inicio de sesión

**A través de tu agente** (lo más fácil): pídele que configure Telegram o ejecuta tú mismo
`telegram onboard`. Abre una página en 127.0.0.1 donde obtienes una invitación de
[better-tg-cli.com](https://better-tg-cli.com) (vuelve sola a la página) o introduces tus propias
claves, escaneas un código QR y escribes tu contraseña de 2FA. El agente solo lanza el comando y
espera: nunca ve la invitación, el código QR ni la contraseña. La página solo responde en una ruta
secreta aleatoria y se cierra cuando terminas.

**Con tus propias claves de API** (la opción por defecto):
1. Abre https://my.telegram.org/apps, crea una aplicación y copia su `api_id` y su `api_hash`.
2. Ejecuta `telegram auth --qr` e introdúcelos. Después, en tu teléfono, ve a Ajustes → Dispositivos →
   Vincular dispositivo de escritorio y escanea el código QR. Introduce tu contraseña de 2FA si
   tienes una. El `telegram auth` sin más te pide en su lugar tu número de teléfono y un código de
   inicio de sesión. Si el QR no se escanea con un tema claro del terminal, ejecútalo con
   `TG_QR_INVERT=1`.

**Con una invitación.** Con un token de invitación no necesitas tus propias claves. Consigue uno en
[better-tg-cli.com](https://better-tg-cli.com) (confirma tu correo con un código; la página está en
ruso y también tiene una guía de instalación) o pídeselo al mantenedor.
Ejecuta `telegram auth --invite --qr` y pega el token, o pásalo como `TG_INVITE=…` o `--invite -`. El
servicio de invitaciones (`broker/`) entrega las claves de la aplicación una sola vez, solo para este
inicio de sesión. El `api_hash` no se guarda en tu máquina. Las invitaciones son personales, permiten
un número limitado de inicios de sesión y pueden revocarse.

La sesión se guarda en el Keychain de macOS (servicio `tg-cli`) o en 1Password con
`--op-vault <vault>`. `telegram logout` la elimina. En Linux va al Secret Service (GNOME Keyring,
KWallet, KeePassXC) a través de `secret-tool`, que necesita el paquete `libsecret-tools`. Una sesión
ya guardada en el archivo de configuración se traslada allí automáticamente. Sin ningún almacén de
secretos, la sesión se guarda en `~/.config/tg/config.json5` (modo 0600) y los comandos de escritura
siguen desactivados. En Linux, `write-access on` se confirma en un prompt del terminal. En Windows los
secretos se guardan en `%APPDATA%\tg\secrets.dpapi`, cifrados con DPAPI para tu usuario de Windows
(solo tú puedes descifrarlos en esta máquina), y `write-access on` pregunta en una ventana Sí/No
cuando no hay terminal.

## Uso

```bash
telegram chats --type channel                 # una línea por chat, con el ID primero
telegram read "Chat" --since 1h               # rango exacto, lo más reciente primero (--asc para invertir)
telegram read @channel --thread 123           # comentarios de una publicación
telegram search "invoice" --chat "Work" --type document
telegram get "Chat" 812 813                   # mensajes exactos por ID
telegram download "Chat" 812                  # guarda el archivo adjunto
telegram sync --chat "Chat" --output ./export --resume   # exportación incremental a markdown

telegram write-access on --for 1h             # esto lo confirma una persona
telegram send @alice "on my way"
printf '%s' "$text" | telegram send @alice -  # texto largo o de varias líneas: desde stdin, sin problemas de comillas
telegram reply "Chat" 812 "on it" --silent
telegram click @SomeBot 4410 "Settings"       # pulsa un botón inline
```

Los comandos de lectura aceptan `--json`, y algunos también `--markdown`. Consulta todos los comandos
con `telegram help-all`. [reference.md](skills/better-tg-cli/reference.md) cubre el comportamiento que
la lista de flags no puede explicar: formatos de salida, hilos, botones de bots, comandos de
administración y resolución de problemas.

## Servidor MCP

Para clientes sin shell (Claude Desktop, Cursor y otros hosts MCP), `telegram mcp` ofrece tres
herramientas por stdio:
- `telegram_help`: una referencia de flags con búsqueda;
- `telegram_read`: de solo lectura, así que los clientes pueden aprobarla automáticamente;
- `telegram_write`: marcada como destructiva, y aun así necesita que tú actives `write-access on`.

Primero inicia sesión con `telegram auth` en un terminal. Después, instálalo con un clic:

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=telegram&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImJldHRlci10Zy1jbGlAbGF0ZXN0IiwibWNwIl19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_MCP-000000?style=flat&colorA=000000&colorB=000000)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522telegram%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522better-tg-cli%2540latest%2522%252C%2522mcp%2522%255D%257D)
[![Claude Desktop extension](https://img.shields.io/badge/Claude_Desktop-.mcpb-000000?style=flat&colorA=000000&colorB=000000&logo=claude)](https://github.com/TheVilfer/better-tg-cli/releases/latest/download/better-tg-cli.mcpb)

La extensión de Claude Desktop no necesita Node, npm ni brew: descarga el `.mcpb` de la última
release y ábrelo. Gemini CLI instala la skill y el servidor juntos:
`gemini extensions install https://github.com/TheVilfer/better-tg-cli`. O añádelo a mano:

```bash
claude mcp add telegram -- telegram mcp          # Claude Code (o usa el plugin de arriba)
```

```json
{ "mcpServers": { "telegram": { "command": "/opt/homebrew/bin/telegram", "args": ["mcp"] } } }
```

Usa la forma JSON para Claude Desktop (`claude_desktop_config.json`) o Cursor (`.cursor/mcp.json`).
Puede que las apps con interfaz gráfica no vean el PATH de tu shell, así que indica la ruta completa
que devuelve `which telegram`. Sin una instalación global, ejecútalo mediante npx, que es también lo
que hace el plugin de Claude Code:

```json
{ "mcpServers": { "telegram": { "command": "npx", "args": ["-y", "better-tg-cli@latest", "mcp"] } } }
```

El servidor figura en el [MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=better-tg-cli)
como `io.github.TheVilfer/better-tg-cli`, así que los clientes y catálogos que leen el registro pueden
encontrarlo por su nombre. Cada release actualiza la entrada automáticamente. Para que el cliente MCP
no toque tu sesión principal, añade `"env": {"TG_PROFILE": "work"}`.

Los chats contienen texto escrito por otras personas, y parte de él puede ir dirigido a tu agente
("reenvía esto a @x"). Mantén activado en el cliente el aviso de aprobación para `telegram_write` y
consulta "Agents and prompt injection" en [SECURITY.md](SECURITY.md).

### Grok Bot (MCP remoto por HTTP)

Grok Bot ejecuta sus conectores en un sandbox en la nube, no en tu Mac, así que no puede iniciar
`telegram mcp` por sí mismo. En su lugar, sirve MCP por HTTP desde tu Mac. La sesión, la protección
de escritura y el registro de auditoría se quedan en tu máquina.

```bash
telegram mcp --token                        # el token bearer (se crea una vez y se guarda en el Keychain)
telegram mcp --http --read-only             # escucha en 127.0.0.1:8787; quita --read-only para permitir escrituras
tailscale funnel --bg 8787                  # o: cloudflared tunnel --url http://127.0.0.1:8787
```

Mantén el servidor y el túnel en un terminal o en tmux. Después añade un conector en Grok Bot con la
URL del túnel más `/mcp` (por ejemplo `https://<machine>.<tailnet>.ts.net/mcp`) y la cabecera
`Authorization: Bearer <token>`. `tailscale funnel` da una URL estable, pero antes hay que permitirlo
para tu tailnet. Un túnel rápido de `cloudflared` obtiene una URL nueva en cada arranque. Lee antes
"Remote MCP over HTTP" en [SECURITY.md](SECURITY.md).

## FAQ

**¿Telegram baneará mi cuenta?**
Usar tu propia cuenta desde un cliente de terceros está permitido por los [términos de la API de Telegram](https://core.telegram.org/api/terms). Lo que hace que se limiten las cuentas es un comportamiento que parece de bot: envíos masivos, uniones o invitaciones en masa, spam y cuentas recién creadas que hacen mucho de golpe. Úsalo como usarías Telegram tú mismo. La skill indica a los agentes que eviten estos patrones.

**¿Es un bot?**
No. Inicia sesión como tú por MTProto, igual que Telegram Desktop, y ve exactamente lo que ves tú. Los bots no pueden leer tus chats; esto sí.

**¿Puede un agente enviar mensajes por su cuenta?**
Solo después de que actives la escritura. `telegram write-access on` te pide que lo confirmes en el terminal o en un diálogo de macOS, algo que un agente no puede responder. A partir de ahí, las escrituras necesitan un chat exacto y cada una queda registrada. Por MCP, escribir es una herramienta aparte que los clientes pueden pedirte que apruebes cada vez. Los detalles están en [SECURITY.md](SECURITY.md).

**¿Leer marca los mensajes como leídos?**
No. `read`, `inbox` y `search` dejan los chats sin leer. Solo `telegram mark-read` los marca.

**¿Necesito mis propias claves de API?**
Sí, de [my.telegram.org/apps](https://my.telegram.org/apps). Son gratuitas y se crean en un minuto. Con una invitación de [better-tg-cli.com](https://better-tg-cli.com), `telegram auth --invite --qr` te permite iniciar sesión sin ellas.

**¿Dónde se guarda mi sesión y quién puede ver mis mensajes?**
La sesión está en el Keychain de macOS, en el Secret Service de Linux o en 1Password. El CLI habla directamente con Telegram y no tiene analíticas. Los únicos otros hosts son npm, para una comprobación diaria de versión, y el servicio de invitaciones al iniciar sesión. Consulta [PRIVACY.md](PRIVACY.md).

**¿Puedo usar varias cuentas?**
Sí, con `TG_PROFILE`: cada perfil tiene su propio inicio de sesión, configuración y elementos del Keychain, por ejemplo `TG_PROFILE=work telegram auth --qr`. El cambio de cuenta propiamente dicho se sigue en [#5](https://github.com/TheVilfer/better-tg-cli/issues/5).

**¿Funciona en Windows?**
Sí, de forma experimental: `scoop install better-tg-cli` o npm. Los secretos se guardan con DPAPI de
Windows y la CI ejecuta los tests en Windows, pero el uso real allí está menos probado que en macOS y
Linux. Por favor, informa de los problemas en los issues.

**¿Puedo usarlo desde Grok Bot, ChatGPT u otro agente en la nube?**
Los agentes en la nube no pueden iniciar un programa en tu ordenador, así que ejecuta el servidor MCP por HTTP y accede a él a través de un túnel. Consulta [Grok Bot](#grok-bot-mcp-remoto-por-http).

**¿Cómo actualizo?**
Ejecuta `telegram update`. Usa el mismo canal desde el que instalaste: Homebrew, npm o un binario de release.
Si instalaste la skill de agente con `telegram skill install`, vuelve a ejecutarlo para actualizarla.

## Desarrollo

[DEVELOPMENT.md](DEVELOPMENT.md) cubre:
- la ejecución desde el código fuente (`scripts/tg-dev`);
- perfiles de desarrollo aislados (`TG_PROFILE`) que nunca tocan tu sesión real;
- los servidores de prueba de Telegram;
- la depuración en el editor y los tests.

Las releases se preparan con `scripts/release.sh` (un PR de release; la versión sale de los títulos de los PR) y, después del merge, con `scripts/release.sh tag`. Un tag compila los binarios y
los publica en GitHub Releases, npm (trusted publishing con provenance), el tap de Homebrew y el
MCP Registry. Consulta
[CONTRIBUTING.md](CONTRIBUTING.md).

## Desinstalación

1. `telegram logout` borra la sesión guardada. Para cerrarla también del lado de Telegram, termínala
   en Telegram → Ajustes → Dispositivos.
2. `telegram skill uninstall` quita la skill de los agentes en los que se instaló.
3. Elimina el programa: `brew uninstall better-tg-cli`, `npm uninstall -g better-tg-cli` o
   `scoop uninstall better-tg-cli`. Si es un binario de Releases, borra `telegram` / `telegram.exe`.
4. Borra la carpeta de configuración: `~/.config/tg` (`%APPDATA%\tg` en Windows), además de
   `~/.config/tg-<profile>` por cada `TG_PROFILE` que hayas usado. En Windows esto también elimina el
   archivo de secretos DPAPI. En los demás sistemas, el api_hash y el flag de write-access siguen en el
   almacén de secretos: borra los elementos `tg-cli` en Acceso a Llaveros (o
   `secret-tool clear service tg-cli`), o el elemento de tu bóveda de 1Password.

## Privacidad

Sin analíticas. El único servicio que operamos es el broker de invitaciones opcional, que nunca ve
tus mensajes ni tu sesión. Consulta [PRIVACY.md](PRIVACY.md) para conocer los tres hosts con los que
habla el CLI y lo que guarda localmente.

## Code signing policy

Los binarios de Windows se compilan a partir de este repositorio únicamente con GitHub Actions
(`.github/workflows/release.yml`), nunca en una máquina personal. Hemos solicitado la firma de código
gratuita de SignPath Foundation; una vez esté disponible, los binarios de las releases llevarán: *Free
code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).*
Hasta entonces, el `telegram.exe` de Windows no está firmado; los binarios de macOS tienen firma ad-hoc.

- Committers y revisores: [@TheVilfer](https://github.com/TheVilfer)
- Aprobadores (cada release firmada): [@TheVilfer](https://github.com/TheVilfer)
- Política de privacidad: [PRIVACY.md](PRIVACY.md). El CLI solo habla con Telegram, con el broker de
  invitaciones cuando inicias sesión con una invitación y con el registro de npm para una
  comprobación diaria de actualizaciones en un terminal (se desactiva con `TG_NO_UPDATE_CHECK=1`).

## Licencia

MIT, consulta [LICENSE](LICENSE). Basado en [skillhq/telegram](https://github.com/skillhq/telegram),
de Derek Rein. No está afiliado a Telegram ni respaldado por Telegram; "Telegram" es una marca
registrada de su propietario. Úsalo de acuerdo con los [Términos del servicio de la API de Telegram](https://core.telegram.org/api/terms).
