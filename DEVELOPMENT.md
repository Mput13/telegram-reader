# Development

Needs Node >= 20, [Bun](https://bun.sh) and `npm install`.

## Running from source

`scripts/tg-dev <args>` (or `npm run dev -- <args>`) runs `src/index.ts` with Bun. There is no build
step and startup takes about 0.3 s. It never writes `dist/`. That matters because an installed
`telegram` that points at this checkout runs `dist/telegram.mjs` live, and agents use it.

```bash
scripts/tg-dev check                        # profile "dev"
scripts/tg-dev read me -n 5 --json
TG_PROFILE= scripts/tg-dev inbox            # your real account (the default profile)
TG_LOG_LEVEL=debug scripts/tg-dev check     # MTProto log on stderr (none|error|warn|info|debug)
```

To put it on PATH, run `ln -s "$PWD/scripts/tg-dev" /opt/homebrew/bin/tg-dev`.

## Mock mode: no account at all

`TG_MOCK=1` replaces Telegram with a small fake account, so most work needs neither a login nor
real chats:

```bash
TG_MOCK=1 scripts/tg-dev inbox
TG_MOCK=1 scripts/tg-dev send -1004001 "ship it"     # no write-access step: nothing real to approve
TG_MOCK=1 scripts/tg-dev click @demo_bot 2 Catalog   # a scripted bot with every button kind
TG_MOCK=/tmp/scenario.json scripts/tg-dev chats      # your own state file (created from the seed)
```

`getClient()` then returns `MockClient` (`src/mock/client.ts`) instead of a `TelegramClient`. It
answers the same calls with real `Api.*` objects built from plain data (`src/mock/world.ts`), so
`src/client.ts`, the formatters, the commands and the MCP server all run unchanged; only the
network is gone. The built-in account has one of everything the commands tell apart: Saved
Messages, private chats (unread, muted), a bot, a basic group, supergroups (two with similar
titles), a forum with topics, a channel with comments in a discussion group, an archived chat, a
folder and contacts.

- **State.** Writes are saved, so `send` followed by `read` shows the message. `TG_MOCK=1` keeps
  the state in `~/.config/tg-mock/mock-state.json`; any other value is the path of a state file.
  Delete the file to start over. Seed messages store their age, so `--since 1d` keeps working.
- **Isolation.** Mock mode forces the profile `mock` (or your `TG_PROFILE` if it starts with
  `mock`), which keeps its audit log away from real profiles. `clientParams()` throws under
  `TG_MOCK`, and every real client is built with it, so a mock run cannot open a connection.
  `auth`, `onboard`, `logout`, `write-access` and `update` refuse to run.
- **The write guard is skipped**, because a mock write only changes that local file. This is the
  one exception to "no way to skip the confirmation"; the strict chat matching of writes stays.
- **Not covered:** `watch`, polls, stories, inline bots, admin actions (kick, promote, create,
  join, leave) and profile edits. They fail with `mock: … is not implemented`; add a handler to
  `MockClient.invoke()`, or test them against a dev profile.
- **Tests.** `test/mock.test.ts` drives the real client functions and the CLI through the mock.
  Use `new MockClient(seedWorld())` in a test instead of hand-written fakes when the code under
  test needs more than one call.

## Profiles: keep dev away from your real session

`TG_PROFILE=<name>` gives each profile its own state:

| State | Default profile | `TG_PROFILE=dev` |
|---|---|---|
| Config, audit log, update cache | `~/.config/tg/` | `~/.config/tg-dev/` |
| Keychain service (session, api_hash, write access) | `tg-cli` | `tg-cli-dev` |
| 1Password items | `tg-cli-<key>` | `tg-cli-dev-<key>` |

`scripts/tg-dev` and every `npm run dev*` script default to `dev`. An empty `TG_PROFILE=` means the
default profile.

A profile starts logged out and read-only. Log in with `scripts/tg-dev auth`. Writing needs
`scripts/tg-dev write-access on --for 1h`, which a human confirms, exactly as in production. On
purpose, there is no way to skip that.

A dev profile can use:
- **A second account (recommended).** Log in with any other number. Writes land on that account
  and cannot touch your real chats.
- **Telegram's test servers.** Run `scripts/tg-dev auth --test-dc`. The flag is saved in the
  profile, and `check` prints `Servers: TEST`. Since mid-2025 the `99966XYYYY` test numbers with
  code `XXXXX` from the docs have been rejected with `PHONE_CODE_INVALID` for ordinary apps (see
  [tdlib#3361](https://github.com/tdlib/td/issues/3361)). Instead, create the test account with a
  real number in an official mobile app's hidden test mode first (the maintainer's advice in that
  thread). On iOS this reportedly means tapping the Settings tab about 10 times, then Accounts →
  Login to another account → Test. After that, the code arrives in that app.
- **Your real account, read-only.** This is the default profile plus the write guard. It is good for
  debugging reads, because you get real data.

## Debugging

- **Cursor / VS Code**: open Run and Debug.
  - *CLI: telegram \<args\>* asks for the arguments and runs `src/` through tsx under Node, with
    breakpoints in `.ts` and the dev profile.
  - *…MTProto debug log* is the same with `TG_LOG_LEVEL=debug`.
  - *Tests: current file* runs vitest on the open file.
  - *Attach* attaches to `npm run dev:debug -- <args>` on port 9229 (it runs `tsx --inspect-brk`).

  The built-in debugger can't attach to Bun, which is why these entries use Node and tsx.
- `bun --inspect-wait src/index.ts <args>` gives a debug.bun.sh URL, if you prefer Bun's inspector.
- teleproto logs go to stderr only, so `--json` output stays parseable at any `TG_LOG_LEVEL`.
- **MCP in Claude Desktop.** The `.mcpb` extension (`node scripts/mcpb.mjs <out>` after a build)
  runs on Claude's built-in Node, an Electron utility process: its `execPath` is an app helper that
  won't start as Node, so there `telegram mcp` runs each call in a worker thread instead of a child
  process. `TG_MCP_WORKER=1` forces that path anywhere (the stdio e2e test runs both). Server logs:
  `~/Library/Logs/Claude/mcp-server-Telegram (better-tg-cli).log`. Never launch binaries from
  inside `Claude.app` to test this: it starts a second copy of the app.

## TypeScript

`tsc` is TypeScript 7 (the native compiler, `@typescript/native`). It has no JS API and no
tsserver, so `typescript` in devDependencies is an alias for TypeScript 6 (`tsc6`), used by editors
and any tool that imports the compiler. `.vscode/settings.json` points the editor at it. Accept
"Use Workspace Version" if Cursor asks.

## Checks

```bash
npm test                # vitest, offline (no session, no network)
npm run test:watch
npm run typecheck       # or typecheck:watch
npm run dev:dist -- check   # build the real bundle and run it (dev profile)
```

Source mode skips the bundle's shrink plugin (TL re-encoding, stubs). Run `npm run dev:dist` or
`npm run build && npm test` before a release. `test/bundle-shrink.test.ts` and
`test/sync-and-cli.test.ts` cover the bundle.

Releasing is described in `CLAUDE.md` (`scripts/release.sh`, which picks the version from the PR titles, then `scripts/release.sh tag`).
