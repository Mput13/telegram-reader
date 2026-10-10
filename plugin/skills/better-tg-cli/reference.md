# Telegram CLI — behaviour reference

Every flag is listed by `telegram help-all` (or `telegram help-all -g <word>`), generated from the
code. This file only covers behaviour that the flag list can't tell you.

## Reading

- `read` pages through history, so `--since/--until/--before/--after` return exact ranges on busy
  chats. `-n` caps the count (default 50). Order is newest first; `--asc` flips it.
- `--unread` starts after the dialog's read marker and still obeys `-n`. It does not mark the
  messages read; use `mark-read <chat>` for that.
- `--thread <id>` reads comments under a channel post, or replies to a message in a group.
  Channel comments live in the linked discussion group, so the output reports `threadChatId`.
  Reply there with `telegram reply <threadChatId> <commentId> ...`.
- `--topic <id>` reads a forum topic. List topics with `telegram topics <chat>`.
- `--from` works with plain reads and threads. `search --from` needs `--chat`, because Telegram
  global search has no sender filter.
- `get <chat> <ids...>` fetches exact messages. Missing IDs go to stderr in text mode, or to a
  `missing` field in JSON.
- `search "" --chat X --type photo` lists every photo in a chat. Types: photo, video, media,
  document, url, voice, audio, gif, round, location, contact, pinned, mentions.
  `--type mentions` without `--chat` finds where you were @mentioned.
- Media shows as `[📷 photo]`, `[📎 document name.pdf · 1.2 MB]`, and so on. `download <chat> <id>`
  saves the file. In JSON, `media` has `kind`, `fileName`, `mimeType`, `size`, `width`, `height`
  and `duration`.
- A long post costs as many tokens as its text. Use `--max-text 200` for skimming, then
  `get <chat> <id>` for the posts that matter.

## Output

- Off a TTY (agents and pipes), output is compact: one line per item with the ID first, JSON on
  one line, and null or empty fields dropped. Set `TG_JSON_PRETTY=1` to indent JSON.
- Message line format: `#id YYYY-MM-DD HH:MM Sender ↩replyTo 💬comments: [media] text`. Continuation lines
  are indented. The sender is omitted when it is the chat itself, as in channel posts.
- Chat line format: `id type [muted,archived] unread=N Title @username | preview`.
- JSON shapes:

| Command | Shape |
|---|---|
| `chats`, `contacts`, `members` | array |
| `read`, `get` | `{chatTitle, messages[], threadChatId?, missing?}` |
| `search` | array of `{chatTitle?, messages[]}`; global hits add `chatId` and `chatTitle` to each message |
| `inbox` | `{totalUnread, chatsWithUnread, chats[]}` (totals cover all chats, `chats` is cut to `-n`) |
| `info` | object |
| `topics` | `{chatTitle, topics[]}` |

## Writing (needs write access; every write goes to `~/.config/tg/audit.jsonl`)

- `write-access on [--for 30m|2h|1d]` asks the user: a y/N prompt on a terminal, otherwise a macOS
  dialog (it times out as "no" after 2 minutes). `--for` switches writes off again automatically.
  `write-access off` needs no confirmation. The flag lives in Keychain, not in the config file.

- Pass `-` as the text argument (`send`, `reply`, `edit`, `send-file -c`) to read the text from
  stdin: `printf '%s' "$text" | telegram send @user -`. This avoids shell quoting problems.
- `--html` is the reliable formatting mode: `<b>`, `<i>`, `<a href>`, `<code>`, `<pre>`.
  `--markdown` uses the GramJS dialect (`**bold**`, `` `code` ``), where `[text](url)` links do
  NOT work.
- `send --schedule 2h` (or an ISO date) schedules a message. `--silent` sends without a
  notification sound.
- `delete` revokes for everyone by default. `--just-me` deletes only on your side. IDs are comma
  separated.
- `forward <from> <ids> <to>`: `--drop-author` hides the source.
- `pin` is silent by default (`--notify` pings members). `unpin <chat>` with no ID unpins
  everything.
- `poll <chat> "Q" A B C` takes `--multiple`, `--quiz --correct N` (1-based) and `--public`.
  `vote <chat> <id> 2` also counts options from 1.

### Bot buttons

`read` shows keyboards as `[index] label (type)`. Press one with `click <chat> <msgId> <index|label>`.
After a callback, `click` re-reads the message and prints the bot's toast/alert, the edited text,
new buttons and any new bot messages. Navigate bot menus by pressing a button and reading the new
menu.

| Button type | `click` does |
|---|---|
| callback | sends the callback, shows the answer and the updated message |
| game | returns the game URL |
| reply-keyboard text | sends the label as a message |
| url / url_auth / webview | prints the URL, never opens it |
| switch-inline | prints the query, does not send it |
| copy | prints the copied text |
| request phone / geo / poll / peer, buy | refused on purpose (privacy, payments) |

Buttons that need 2FA take `--password`. `--no-wait` skips waiting for the bot's reply.

### Admin

- `promote <group> <user>` takes `--rank "Title"` and `--add-admins`.
- `transfer-owner` is irreversible and interactive: it asks you to retype the group name (`-y`
  skips this) and prompts for your 2FA password. It works for supergroups and channels only.
  Telegram blocks it for about 24 hours after a new login and about 7 days after a 2FA change.
  Never script it.

## Live and export

- `watch [chat] -t 30 -n 10 --json` streams new messages as JSON lines. Always pass `-t` or `-n`
  when running unattended. A second `telegram` process that writes while `watch` runs can steal
  its update stream.
- `sync --chat X --output DIR` writes markdown. It takes `--days N` (default 7),
  `--since/--until` and `--all` for full history. `--media` downloads files into `<chat>/media/`.
- `sync --resume` is incremental. Checkpoints are per chat ID in `DIR/.sync-meta.json`. A resumed
  run fetches everything after the checkpoint and ignores the default `--days` window.

## MCP server (`telegram mcp`)

- **Tools:**
  - `telegram_help {grep?}`;
  - `telegram_read {args}`, marked `readOnlyHint`;
  - `telegram_write {args, stdin?}`, marked `destructiveHint`.

  `args` is the CLI argv with the command first, for example `["read","@x","-n","20"]`. `stdin`
  fills a `-` text argument.
- **What runs where:**
  - Read tool: only the read commands.
  - Write tool: everything that changes the account or writes local files (`download`, `sync`,
    `avatar`).
  - Never over MCP: `auth`, `onboard`, `logout`, `transfer-owner`, `update`, `skill`, and changing `write-access`.
    Showing its status is allowed.
- **Safety:** the read tool runs with `TG_READ_ONLY=1`, which blocks every guarded write even if a
  command were misclassified.
- **Execution:** each call is a separate CLI process with no stdin (a worker thread inside Claude
  Desktop). Calls run one at a time, time out after 120 s, and output is capped at 100 KB.
  `watch` needs `-t` or `-n`.
- **Protocol:** MCP 2025-11-25 with the `initialize` handshake. Newer clients fall back to it.
- **HTTP:** `telegram mcp --http [--host 127.0.0.1] [--port 8787]` serves the same tools on
  `POST /mcp` (stateless, JSON responses) for remote hosts such as Grok Bot. Every request needs
  `Authorization: Bearer <token>` (`telegram mcp --token`, `--rotate-token`). Requests with an
  `Origin` header are refused. `--read-only` drops `telegram_write` (also works over stdio).

## Chat identifiers

`me` / `self` / `saved` / `Saved Messages` / `Избранное` → your Saved Messages. A numeric ID must
exactly match a dialog ID (the `id` from `chats`). `@username` resolves exactly. Anything else
matches titles.

- **Reads:** an exact title first, then a substring.
- **Writes** (every command gated by write access) accept only an exact, unique title. A substring
  or a title shared by several chats is refused with up to 5 candidates (`id type title @username`).
  Retry with the ID.

## Troubleshooting

- `Not configured`: run `telegram onboard --json`. It serves a one-shot page on 127.0.0.1 (random
  secret path, closes when done, `--timeout` 15 min by default) where the user gets an invite from
  better-tg-cli.com (it comes back to the page by itself), or enters their own keys, then scans a QR
  code and types their 2FA password. Events: `url`, `waiting_invite`, `waiting_scan`, `need_password`,
  `done` (exit 0), `error`, `timeout` (exit 1); `already_logged_in` exits 0 without changes.
  `--no-open` only prints the URL. You never get tokens, codes or passwords, and you must not ask
  for them or fill in the page. Without a browser on this machine (SSH), the user runs
  `telegram auth --qr` (own keys) or `telegram auth --invite --qr` in their terminal; that is
  interactive, so never run it for them. `--qr` logs in by scanning a QR code in the Telegram app instead of
  typing a code (`TG_QR_INVERT=1` for light terminals).

- `command not found: telegram`: run `brew install thevilfer/tap/better-tg-cli`, `scoop install better-tg-cli` (Windows, after `scoop bucket add thevilfer https://github.com/TheVilfer/scoop-bucket`) or `npm install -g better-tg-cli`, or build this folder (`npm install && npm run build && npm install -g .`, needs Bun)
  `telegram update` upgrades an existing install (brew, npm or git checkout); `update --check` only reports.
  `telegram skill install|status|uninstall [-a <agent>...]` copies this skill into coding agents' global
  skills folders; only run it when the user asks.
  Never install `@skillhq/telegram` from npm: it is the old GramJS build, and bot replies show
  as `(no text)`.
- `Write access is disabled`: the account is read-only on purpose, or a `--for` window expired. Ask
  the user, then run `telegram write-access on --for 1h`; they confirm it in a dialog.
- `FLOOD_WAIT` (rate limit): waits of up to 60 s are retried automatically, and stderr says
  `Telegram rate limit on <method>: waiting Ns`. Longer waits fail with the wait in the error
  message. `TG_FLOOD_WAIT_MAX=<seconds>` changes the limit: `0` fails fast, a larger value suits
  long `sync` runs. Don't retry in a loop, because Telegram extends the ban.
- `CHANNELS_TOO_MUCH` on `join`: the account hit Telegram's channel limit, so leave some first.
- `Could not find the input entity`: the ID is not in your dialogs. Use `@username` or open the
  chat first.
- Bot reply shows as `(no text)` with `MessageMediaUnsupported`: the TL layer is behind, so bump
  `teleproto`.
