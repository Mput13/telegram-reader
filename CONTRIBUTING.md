# Contributing

Issues and pull requests are welcome.

- **Setup, running from source, dev profiles and debugging:** see [DEVELOPMENT.md](DEVELOPMENT.md).
  Test against a dev profile (`scripts/tg-dev`), never your main account.
- **Open the PR against `next`**, not `main`: `main` is the last stable release, and `next`
  collects what goes into the following one.
- **Before a PR:** run `npm run build && npm test`. CI runs both on Node 22 and 24. Tests are
  offline and need no Telegram session. Add one for any behaviour you change.
- **Style:** match the surrounding code. Commits use `Add …`, `Fix …` or `Update …`.
- **Agent-facing output is an API.** Plain output off a TTY and `--json` shapes are parsed by
  agents, so a format change needs a note in `skills/better-tg-cli/reference.md`, and in its `SKILL.md` when it affects
  common use.
- **Writes stay behind the guard.** New commands that change anything on the account must call
  the write-access check and write to the audit log, like the existing write commands.
- **Releases** are done by the maintainer with `scripts/release.sh`. Don't bump the version in PRs.

Bugs in the MTProto layer (`teleproto`) or Telegram limits (`FLOOD_WAIT`, `CHANNELS_TOO_MUCH`)
are usually not bugs in this CLI. Check `TG_LOG_LEVEL=debug` output first.
