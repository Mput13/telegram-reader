<div align="center">
  <picture>
    <source srcset="https://raw.githubusercontent.com/TheVilfer/better-tg-cli/main/assets/banner-dark.png" media="(prefers-color-scheme: dark)"/>
    <source srcset="https://raw.githubusercontent.com/TheVilfer/better-tg-cli/main/assets/banner-light.png" media="(prefers-color-scheme: light)"/>
    <img src="https://raw.githubusercontent.com/TheVilfer/better-tg-cli/main/assets/banner-light.png" alt="better-tg-cli"/>
  </picture>

  [![npm version](https://img.shields.io/npm/v/better-tg-cli?style=flat&colorA=000000&colorB=000000)](https://www.npmjs.com/package/better-tg-cli)
  [![CI](https://img.shields.io/github/actions/workflow/status/TheVilfer/better-tg-cli/ci.yml?branch=main&label=ci&style=flat&colorA=000000&colorB=000000)](https://github.com/TheVilfer/better-tg-cli/actions/workflows/ci.yml)
  [![npm provenance](https://img.shields.io/badge/npm-provenance-000000?style=flat&colorA=000000&colorB=000000&logo=npm)](https://www.npmjs.com/package/better-tg-cli#provenance)
  [![install size](https://img.shields.io/npm/unpacked-size/better-tg-cli?label=size&style=flat&colorA=000000&colorB=000000)](https://www.npmjs.com/package/better-tg-cli)
  [![dependencies](https://img.shields.io/badge/dependencies-0-000000?style=flat&colorA=000000&colorB=000000)](package.json)
  [![MCP](https://img.shields.io/badge/MCP-server-000000?style=flat&colorA=000000&colorB=000000)](#mcp-server)
  [![platforms](https://img.shields.io/badge/macOS%20%C2%B7%20Linux-000000?style=flat&colorA=000000&colorB=000000&logo=apple)](#install)
  [![license](https://img.shields.io/badge/license-MIT-000000?style=flat&colorA=000000&colorB=000000)](LICENSE)

  <p>
    <a href="#install">Install</a> · <a href="skills/better-tg-cli/reference.md">Reference</a> · <a href="SECURITY.md">Security</a> · <a href="https://github.com/TheVilfer/better-tg-cli/issues">Issues</a> · <a href="README.ru.md">Русский</a> · <a href="README.es.md">Español</a>
  </p>
</div>

https://github.com/user-attachments/assets/d143f7c7-7d50-439c-b373-cbcbff5a6675

An unofficial, agent-friendly command-line client for Telegram that runs **on your own account**
(MTProto via [`teleproto`](https://www.npmjs.com/package/teleproto), TL layer 229). The command is
`telegram`: about 60 commands for reading, searching, writing, bots, groups and exports, built so
that AI agents (Claude Code, Codex, …) can drive it cheaply and safely.

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
> **Your account, your risk.** This is an unofficial client that logs in as you. Telegram may
> limit or freeze accounts that behave like bots. The risk is highest for new accounts, bulk
> messaging, mass joins or invites, and anything that looks like spam. Use it the way you would
> use Telegram yourself, keep writes off unless you need them, and read [SECURITY.md](SECURITY.md)
> before letting an agent write. The authors are not responsible for restricted accounts.

**Contents:** [Why this fork](#why-this-fork) · [Install](#install) · [Log in](#log-in) · [Usage](#usage) · [MCP server](#mcp-server) · [FAQ](#faq) · [Development](#development) · [Privacy](#privacy) · [License](#license)

## Why this fork

A fork of [skillhq/telegram](https://github.com/skillhq/telegram), reworked for agents:

- **Current Telegram layer.** Bot replies with rich (layer 228+) content show real text instead of
  `(no text)`. You can press bot buttons (`click`) and walk bot menus.
- **Token-efficient output.** Off a TTY you get one compact line per item with the ID first, and
  JSON on one line with empty fields dropped. `--max-text` trims long posts. `telegram help-all -g
  <word>` prints every flag, generated from the code.
- **Exact reads.** Real pagination for `--since/--until`, `--unread`, threads and channel
  comments, forum topics, `get` by ID, search filters by type, sender or date, and `me` / `Избранное`
  for Saved Messages.
- **Safe by default.** The account is read-only until a human runs `write-access on [--for 1h]`
  and confirms it in a terminal prompt or a macOS dialog, so an agent cannot switch it on itself.
  Every write is logged to `~/.config/tg/audit.jsonl`. Secrets live in the macOS Keychain, the
  Linux Secret Service or 1Password.
- **Small and self-contained.** The npm package is one 0.3 MB file with zero runtime
  dependencies. Homebrew installs a standalone binary with no Node.

## Install

```bash
brew install thevilfer/tap/better-tg-cli   # standalone binary, macOS and Linux
npm install -g better-tg-cli               # Node >= 20, any OS
```

On Windows (experimental), with [Scoop](https://scoop.sh) or npm:

```powershell
scoop bucket add thevilfer https://github.com/TheVilfer/scoop-bucket
scoop install better-tg-cli
```

The Windows `telegram.exe` is not code-signed, so SmartScreen may warn about the release download.

`telegram update` upgrades an existing install, whichever of these you used. On a terminal the CLI
checks for new versions once a day. Agents and pipes never see that notice, and
`TG_NO_UPDATE_CHECK=1` turns it off.

Downloading a binary from Releases by hand on macOS? It is not notarized, so remove the
quarantine flag once: `xattr -d com.apple.quarantine ./telegram`. Homebrew handles this for you.

Do **not** install `@skillhq/telegram`. It is the old upstream build on GramJS (layer 198).

Every channel ships the same version from one release:

| Where | What you get | Install |
|---|---|---|
| [Homebrew](https://github.com/TheVilfer/homebrew-tap) | standalone binary | `brew install thevilfer/tap/better-tg-cli` |
| [npm](https://www.npmjs.com/package/better-tg-cli) | CLI and MCP server (Node 20+) | `npm install -g better-tg-cli` |
| [Scoop](https://github.com/TheVilfer/scoop-bucket) (Windows, experimental) | standalone `telegram.exe` | `scoop bucket add thevilfer https://github.com/TheVilfer/scoop-bucket` then `scoop install better-tg-cli` |
| [GitHub Releases](https://github.com/TheVilfer/better-tg-cli/releases) | binaries and SHA256SUMS | download by hand |
| Claude Code plugin | skill and MCP server | [see below](#claude-code-plugin) |
| Claude Desktop extension | MCP server, runs on Claude's built-in Node | [download `.mcpb`](https://github.com/TheVilfer/better-tg-cli/releases/latest/download/better-tg-cli.mcpb) and open it |
| Grok Build plugin | skill and MCP server | [see below](#grok-build-plugin) |
| Gemini CLI extension | skill and MCP server | `gemini extensions install https://github.com/TheVilfer/better-tg-cli` |
| Cursor, VS Code | MCP server | [one-click buttons](#mcp-server) |
| Grok Bot | MCP server over HTTP from your Mac | [see below](#grok-bot-remote-mcp-over-http) |
| The CLI itself | agent skill for Claude Code, Codex, Cursor, Gemini CLI and 7 more | `telegram skill install` |
| [skills.sh](https://skills.sh) | agent skill for any shell agent | `npx skills add TheVilfer/better-tg-cli` |
| [MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=better-tg-cli) | MCP server entry `io.github.TheVilfer/better-tg-cli` | through your MCP client |

### Claude Code plugin

The skill and the MCP server together, in one install:

```
/plugin marketplace add TheVilfer/better-tg-cli
/plugin install better-tg-cli@better-tg-cli
```

It runs the MCP server through `npx`, so Node 20+ is enough. Log in once with `telegram auth --qr`
(or `npx better-tg-cli auth --qr`) in a terminal.

### Codex plugin

The same skill and MCP server as a Codex plugin (also shows up in the ChatGPT desktop app):

```bash
codex plugin marketplace add TheVilfer/better-tg-cli
codex plugin add better-tg-cli@better-tg-cli
```

### Grok Build plugin

[Grok Build](https://x.ai/cli) installs the same plugin, skill and MCP server together:

```bash
grok plugin install TheVilfer/better-tg-cli --trust
# or add the marketplace first, then install from the /plugins menu:
grok plugin marketplace add TheVilfer/better-tg-cli && grok plugin install better-tg-cli --trust
```

### As an agent skill

The skill ([`skills/better-tg-cli`](skills/better-tg-cli/SKILL.md)) teaches any agent with a shell
(Claude Code, Codex, Cursor, Gemini CLI, OpenCode and others) to use the CLI safely. It checks the
setup, never logs in on its own, keeps writes behind your approval, and avoids ban-prone patterns.
The CLI carries the skill and installs it itself, so it always matches your version:

```bash
telegram skill install                  # every supported agent found on this machine
telegram skill install -a claude-code codex
telegram skill status                   # installed, outdated, linked or missing, per agent
```

It knows Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, Grok Build, OpenCode, Goose,
Droid, Windsurf and Pi (`telegram skill status` lists the folders). Run it again after
`telegram update` to refresh the skill. A skill folder that is a symlink is left alone unless you
pass `--force`. For other agents, use the [skills](https://skills.sh) CLI:

```bash
npx skills add TheVilfer/better-tg-cli          # pick agents interactively
npx skills add TheVilfer/better-tg-cli -g -a claude-code -a codex -y
```

## Log in

**Through your agent** (easiest): ask it to set up Telegram, or run `telegram onboard` yourself. It
opens a page on 127.0.0.1 where you get an invite from [better-tg-cli.com](https://better-tg-cli.com)
(it comes back to the page by itself) or enter your own keys, scan a QR code and type your 2FA
password. The agent only starts the command and waits: it never sees the invite, the QR code or the
password. The page answers only on a random secret path and closes when you're done.

**With your own API keys** (the default):
1. Open https://my.telegram.org/apps, create an application, and copy its `api_id` and `api_hash`.
2. Run `telegram auth --qr` and enter them. Then, on your phone, go to Settings → Devices → Link
   Desktop Device and scan the QR code. Enter your 2FA password if you have one. Plain
   `telegram auth` asks for your phone number and a login code instead. If the QR won't scan on a
   light terminal theme, run with `TG_QR_INVERT=1`.

**With an invite.** You don't need your own keys with an invite token. Get one at
[better-tg-cli.com](https://better-tg-cli.com) (confirm your email with a code; the page is in Russian
and also has an install guide), or from the maintainer.
Run `telegram auth --invite --qr` and paste the token, or pass it as `TG_INVITE=…` or `--invite -`. The
invite service (`broker/`) hands out the app's keys once, for this login only. The `api_hash` is not
kept on your machine. Invites are personal, allow a limited number of logins, and can be revoked.

The session is stored in the macOS Keychain (service `tg-cli`), or in 1Password with
`--op-vault <vault>`. `telegram logout` removes it. On Linux it goes to the Secret Service (GNOME
Keyring, KWallet, KeePassXC) through `secret-tool`, which needs the `libsecret-tools` package. A
session already saved in the config file moves there automatically. Without any secret store, the
session is kept in `~/.config/tg/config.json5` (mode 0600) and write commands stay disabled.
On Linux, `write-access on` is confirmed at a terminal prompt. On Windows the secrets live in
`%APPDATA%\tg\secrets.dpapi`, encrypted with DPAPI for your Windows user (only you on this machine
can decrypt it), and `write-access on` asks in a Yes/No window when there's no terminal.

## Usage

```bash
telegram chats --type channel                 # one line per chat, ID first
telegram read "Chat" --since 1h               # exact range, newest first (--asc to flip)
telegram read @channel --thread 123           # comments under a post
telegram search "invoice" --chat "Work" --type document
telegram get "Chat" 812 813                   # exact messages by ID
telegram download "Chat" 812                  # save the attached file
telegram sync --chat "Chat" --output ./export --resume   # incremental markdown export

telegram write-access on --for 1h             # a human confirms this
telegram send @alice "on my way"
printf '%s' "$text" | telegram send @alice -  # long or multi-line text: from stdin, no quoting problems
telegram reply "Chat" 812 "on it" --silent
telegram click @SomeBot 4410 "Settings"       # press an inline button
```

Read commands take `--json`, and some also take `--markdown`. See all commands with
`telegram help-all`. [reference.md](skills/better-tg-cli/reference.md) covers the behaviour that the flag list can't
explain: output shapes, threads, bot buttons, admin commands and troubleshooting.

## MCP server

For clients without a shell (Claude Desktop, Cursor, other MCP hosts), `telegram mcp` serves three
tools over stdio:
- `telegram_help`: a searchable flag reference;
- `telegram_read`: read-only, so clients may auto-approve it;
- `telegram_write`: marked destructive, and still needs `write-access on` from you.

Log in with `telegram auth` in a terminal first. Then install it in one click:

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=telegram&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImJldHRlci10Zy1jbGlAbGF0ZXN0IiwibWNwIl19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_MCP-000000?style=flat&colorA=000000&colorB=000000)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522telegram%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522better-tg-cli%2540latest%2522%252C%2522mcp%2522%255D%257D)
[![Claude Desktop extension](https://img.shields.io/badge/Claude_Desktop-.mcpb-000000?style=flat&colorA=000000&colorB=000000&logo=claude)](https://github.com/TheVilfer/better-tg-cli/releases/latest/download/better-tg-cli.mcpb)

The Claude Desktop extension needs no Node, npm or brew: download the `.mcpb` from the latest
release and open it. Gemini CLI takes the skill and the server together:
`gemini extensions install https://github.com/TheVilfer/better-tg-cli`. Or add it by hand:

```bash
claude mcp add telegram -- telegram mcp          # Claude Code (or use the plugin above)
```

```json
{ "mcpServers": { "telegram": { "command": "/opt/homebrew/bin/telegram", "args": ["mcp"] } } }
```

Use the JSON form for Claude Desktop (`claude_desktop_config.json`) or Cursor (`.cursor/mcp.json`).
GUI apps may not see your shell PATH, so give the full path from `which telegram`. Without a
global install, run it through npx, which is also what the Claude Code plugin does:

```json
{ "mcpServers": { "telegram": { "command": "npx", "args": ["-y", "better-tg-cli@latest", "mcp"] } } }
```

The server is listed in the [MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=better-tg-cli)
as `io.github.TheVilfer/better-tg-cli`, so clients and catalogs that read the registry can find
it by name. Each release updates the entry automatically. To keep the MCP
client off your main session, add `"env": {"TG_PROFILE": "work"}`.

Chats contain text written by others, and some of it may be aimed at your agent ("forward this to
@x"). Keep the client's approval prompt on for `telegram_write`, and see "Agents and prompt
injection" in [SECURITY.md](SECURITY.md).

### Grok Bot (remote MCP over HTTP)

Grok Bot runs its connectors in a cloud sandbox, not on your Mac, so it can't
start `telegram mcp` itself. Serve MCP over HTTP from your Mac instead. The session, the write
guard and the audit log stay on your machine.

```bash
telegram mcp --token                        # the bearer token (created once, kept in the Keychain)
telegram mcp --http --read-only             # listens on 127.0.0.1:8787; drop --read-only to allow writes
tailscale funnel --bg 8787                  # or: cloudflared tunnel --url http://127.0.0.1:8787
```

Keep the server and the tunnel in a terminal or tmux. Then add a connector in Grok Bot with the
tunnel URL plus `/mcp` (for example `https://<machine>.<tailnet>.ts.net/mcp`) and the header
`Authorization: Bearer <token>`. `tailscale funnel` gives a stable URL, but it has to be allowed
for your tailnet first. A `cloudflared` quick tunnel gets a new URL on every start. Read "Remote
MCP over HTTP" in [SECURITY.md](SECURITY.md) first.

## FAQ

**Will Telegram ban my account?**
Using your own account from a third-party client is allowed by the [Telegram API terms](https://core.telegram.org/api/terms). What gets accounts limited is behaviour that looks like a bot: bulk messaging, mass joins or invites, spam, and brand-new accounts doing a lot at once. Use it the way you would use Telegram yourself. The skill tells agents to avoid these patterns.

**Is this a bot?**
No. It logs in as you over MTProto, like Telegram Desktop, and sees exactly what you see. Bots can't read your chats; this can.

**Can an agent send messages on its own?**
Only after you turn writes on. `telegram write-access on` asks you to confirm in the terminal or in a macOS dialog, which an agent can't answer. Writes then need an exact chat, and each one is logged. Over MCP, writing is a separate tool that clients can ask you to approve every time. Details are in [SECURITY.md](SECURITY.md).

**Does reading mark messages as read?**
No. `read`, `inbox` and `search` leave chats unread. Only `telegram mark-read` marks them.

**Do I need my own API keys?**
Yes, from [my.telegram.org/apps](https://my.telegram.org/apps). They are free and take a minute to create. With an invite from [better-tg-cli.com](https://better-tg-cli.com), `telegram auth --invite --qr` logs you in without them.

**Where is my session stored, and who can see my messages?**
The session is in the macOS Keychain, the Linux Secret Service or 1Password. The CLI talks to Telegram directly and has no analytics. The only other hosts are npm for a daily version check and the invite service at login. See [PRIVACY.md](PRIVACY.md).

**Can I use several accounts?**
Yes, with `TG_PROFILE`: each profile has its own login, config and Keychain items, for example `TG_PROFILE=work telegram auth --qr`. Switching accounts properly is tracked in [#5](https://github.com/TheVilfer/better-tg-cli/issues/5).

**Does it work on Windows?**
Yes, experimentally: `scoop install better-tg-cli` or npm. Secrets are stored with Windows DPAPI
and CI runs the tests on Windows, but live use there is less tested than on macOS and Linux. Please
report problems in the issues.

**Can I use it from Grok Bot, ChatGPT or another cloud agent?**
Cloud agents can't start a program on your computer, so run the MCP server over HTTP and reach it through a tunnel. See [Grok Bot](#grok-bot-remote-mcp-over-http).

**How do I update?**
Run `telegram update`. It uses the same channel you installed from: Homebrew, npm or a release binary.
If you installed the agent skill with `telegram skill install`, run that again to refresh it.

## Development

[DEVELOPMENT.md](DEVELOPMENT.md) covers:
- running from source (`scripts/tg-dev`);
- isolated dev profiles (`TG_PROFILE`) that never touch your real session;
- Telegram test servers;
- editor debugging and tests.

Releases are cut by `scripts/release.sh` (a release PR; the version comes from the PR titles), then `scripts/release.sh tag` after the merge. A tag builds the binaries and
publishes to GitHub Releases, npm (trusted publishing with provenance), the Homebrew tap and the
MCP Registry. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Uninstall

1. `telegram logout` deletes the saved session. To end it on Telegram's side too, terminate it in
   Telegram → Settings → Devices.
2. `telegram skill uninstall` removes the skill from the agents it was installed into.
3. Remove the program: `brew uninstall better-tg-cli`, `npm uninstall -g better-tg-cli` or
   `scoop uninstall better-tg-cli`. For a binary from Releases, delete `telegram` / `telegram.exe`.
4. Delete the config folder: `~/.config/tg` (`%APPDATA%\tg` on Windows), plus `~/.config/tg-<profile>`
   for any `TG_PROFILE` you used. On Windows this also removes the DPAPI secrets file. Elsewhere the
   api_hash and write-access flag stay in the secret store: delete the `tg-cli` items in Keychain
   Access (or `secret-tool clear service tg-cli`), or the item in your 1Password vault.

## Privacy

No analytics. The only service we run is the optional invite broker, which never sees your
messages or session. See [PRIVACY.md](PRIVACY.md) for the three hosts the CLI talks to and what it
stores locally.

## Code signing policy

Windows binaries are built from this repository by GitHub Actions only (`.github/workflows/release.yml`),
never on a personal machine. We have applied for free code signing from SignPath Foundation; once it
is in place, release binaries will carry: *Free code signing provided by
[SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).*
Until then the Windows `telegram.exe` is unsigned; macOS binaries are ad-hoc signed.

- Committers and reviewers: [@TheVilfer](https://github.com/TheVilfer)
- Approvers (each signed release): [@TheVilfer](https://github.com/TheVilfer)
- Privacy policy: [PRIVACY.md](PRIVACY.md). The CLI talks only to Telegram, to the invite broker
  when you log in with an invite, and to the npm registry for a daily update check in a terminal
  (off with `TG_NO_UPDATE_CHECK=1`).

## License

MIT, see [LICENSE](LICENSE). Based on [skillhq/telegram](https://github.com/skillhq/telegram) by
Derek Rein. Not affiliated with or endorsed by Telegram; "Telegram" is a trademark of its owner.
Use it in line with the [Telegram API Terms of Service](https://core.telegram.org/api/terms).
