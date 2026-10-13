# Telegram Reader

Personal fork of [TheVilfer/better-tg-cli](https://github.com/TheVilfer/better-tg-cli), pinned to v0.37.0.

The production MCP interface exposes only chats explicitly included in the Telegram folders **Lambda**, **NCSED** and **MAIL**. Folder membership is rechecked for each operation. Missing or duplicate folders, automatic category/exclusion rules, or an unresolved peer fail closed. Shared folders with explicit members are supported.

## MCP tools

- `telegram_list_chats`: permitted chat IDs and titles only.
- `telegram_read`: recent messages from one exact permitted chat ID; limit 1–100.
- `telegram_search`: search one permitted chat; no global search.
- `telegram_prepare_send`: create a local proposal containing exact recipient, text and optional reply ID. Sends nothing.
- `telegram_send_approved`: consume a locally approved proposal for one send attempt.

No arbitrary CLI arguments, inline bot queries, media uploads, deletion, editing, contact export, folder changes or linked discussion thread access are available over MCP. `--read-only` exposes only the first three tools.

## Build and login

Use this checkout, not the upstream npm package or plugin manifests (those install the upstream client).

```bash
npm ci --ignore-scripts
npm exec --yes --package=bun@1.4.3 -- bun scripts/bundle.mjs node
node dist/telegram.mjs onboard
```

Onboarding can use the upstream login-key service without registering an app on my.telegram.org. Enter the key and Telegram 2FA password only in the local onboarding page. The fork still trusts the upstream login service for issuing its app credentials; the actual Telegram session is created locally.

## Connect

```bash
TG_NO_UPDATE_CHECK=1 node dist/telegram.mjs mcp --http --read-only
```

The endpoint is `http://127.0.0.1:8787/mcp`. HTTP requires an OS secret store for the bearer token. Retrieve it locally with `node dist/telegram.mjs mcp --token`; do not put it in chat, source control, URLs or logs. A remote hub such as Upsy needs a protected HTTPS route and support for an Authorization header. This integration has not yet been tested against Upsy.

STDIO: configure the MCP client to execute `node /absolute/path/to/dist/telegram.mjs mcp --read-only`.

## Sending

Start MCP without `--read-only` to expose preparation and approved sending. This does not enable unrestricted sending.

1. Give an explicit instruction identifying recipient and text.
2. The agent calls `telegram_prepare_send`.
3. On the server machine, run `node dist/telegram.mjs approve-send REQUEST_ID`. Review the JSON-escaped recipient, text and reply ID and confirm locally.
4. The agent calls `telegram_send_approved` using only that ID. It cannot replace the recipient or text.

A proposal expires five minutes after preparation. An approval is consumed before the network call, so a timeout cannot result in an automatic replay. Inspect Telegram before preparing a replacement after an uncertain result. Folder access is rechecked immediately before sending.

## Security boundary and limitations

These protections restrict remote MCP clients, not malicious code running as the same OS user. The Telegram session still grants account-level authority. Keep it on a dedicated user or machine when agents also have shell access. The inherited CLI itself remains a general Telegram client; do not expose it as an unrestricted shell tool.

Approval files are local, mode 0600, and contain the proposed text. Keep the state directory private. The fork does not expose a remote approval tool. Upstream `telegram update` is disabled so it cannot silently replace the scoped build. Update this fork manually after review.

No live account has been used for validation yet. Folder scope and sending must be verified with a real session before production use.

## Validation

```bash
npm run typecheck
npm exec --yes --package=bun@1.4.3 -- bun scripts/bundle.mjs node
npm test
```

The security tests cover denied peers, marked ID collisions, excluded/pinned peers, missing/duplicate/automatic folders, live membership changes, rejected legacy CLI calls, bounded reads, production HTTP tool exposure, altered/expired proposals, replay and uncertain send failures.

MIT license and upstream attribution are retained. See [UPSTREAM-README.md](UPSTREAM-README.md) for inherited CLI features; its installation commands do not install this fork.
