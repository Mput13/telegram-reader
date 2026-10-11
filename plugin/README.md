# Better-TG-CLI

An unofficial, open-source Telegram client for your own account, packaged for Claude. The plugin
adds the `better-tg-cli` skill, which teaches Claude to use the `telegram` command-line tool, and a
local MCP server (`telegram mcp`, started with `npx better-tg-cli@<pinned version>`). With it Claude
can read and search your chats, open threads and forum topics, press bot buttons, and, only if you
allow it, send, edit, react and forward.

Source code, full documentation and releases: https://github.com/TheVilfer/better-tg-cli

## Before you start

You need Node.js 20 or newer. Log in once, in your own terminal or through the guided page:

```bash
npm install -g better-tg-cli
telegram onboard      # opens a local page: get an invite or use your own API keys, scan a QR code
```

Claude never sees your login code, 2FA password, invite token or session. The session is stored in
the macOS Keychain, the Linux Secret Service, Windows DPAPI or 1Password.

## Safety

- Writing is off by default. `telegram write-access on` has to be confirmed by a person, in a
  terminal prompt or an OS dialog, and can expire (`--for 1h`). Every write is logged locally.
- The MCP server never exposes login, logout, account transfer or self-update.

## Where data goes

The plugin runs on your machine. It connects to:

- Telegram's own servers (MTProto), for everything a Telegram client does;
- the project's invite service (`tg-cli-broker.login-c2d.workers.dev`, also `better-tg-cli.com`),
  only when you log in with an invite, to exchange the invite for the app's API keys;
- `registry.npmjs.org`, once a day and only in an interactive terminal, to check for a newer version
  (turn off with `TG_NO_UPDATE_CHECK=1`).

No analytics. Privacy policy: https://github.com/TheVilfer/better-tg-cli/blob/main/PRIVACY.md

Not affiliated with or endorsed by Telegram. MIT license, see LICENSE.
