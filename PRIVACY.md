# Privacy

better-tg-cli is a local program. It collects no analytics, and apart from the optional invite service
there are no servers of ours in the path. Nobody but you sees your messages or your session.

## Network connections

| To | When | What is sent |
|---|---|---|
| Telegram (MTProto data centers) | Every command | Everything a Telegram client sends, directly to Telegram |
| `registry.npmjs.org` | Once a day, only when run in a terminal (never for agents or pipes) | A request for the latest version number. Turn it off with `TG_NO_UPDATE_CHECK=1` |
| The invite service (`tg-cli-broker…workers.dev`, same service as `better-tg-cli.com`) | Only when you log in with an invite (`telegram auth --invite` or `telegram onboard`) | Your invite token, once, to receive the app's API keys |

The invite service stores invites by their SHA-256 hash with a use counter and never stores raw
tokens. Its request logging is off. It never sees your phone number, login code, session or
messages, because the login itself goes straight to Telegram.

If you get an invite from the signup page on the same service, it also stores the email you enter,
lowercased, next to that invite, with the page language (English, Spanish or Russian) so notices
come in that language. The email is used only to notify you about important updates or
revoked keys. It is never shared or used for marketing. Ask in a GitHub issue to have it deleted.
The page checks for bots with Cloudflare Turnstile.

## Data on your machine

- **Session, api_hash and the write-access flag:** macOS Keychain, the Linux Secret Service,
  1Password, or on Windows `%APPDATA%\tg\secrets.dpapi` encrypted with DPAPI for your Windows user
  (see [SECURITY.md](SECURITY.md)).
- **On Windows** the config dir below is `%APPDATA%\tg\` instead of `~/.config/tg/`.
- **`~/.config/tg/config.json5`:** api_id and preferences.
- **`~/.config/tg/audit.jsonl`:** one line per write, including the target chat and the text you
  sent. Delete it whenever you like.
- **Files you ask for** (`download`, `sync`, `avatar`): where you tell the CLI to save them.

`telegram logout` removes the session. Deleting `~/.config/tg/` and the `tg-cli` Keychain items
removes everything else.

## Agents

When an AI agent runs the CLI, the output (your messages) goes to that agent and its provider
under their privacy terms, not these.
