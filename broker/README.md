# Invite broker

A Cloudflare Worker that gives invited users the maintainer's `api_id`/`api_hash` at login time
(`telegram auth --login-key`). Open-source users bring their own keys and never touch this.

People see an invite as a **login key** (the site, the CLI and the README call it that). The API,
KV, error codes and `scripts/invite.mjs` keep the word invite, because released versions of the CLI
speak that wire format.

- Endpoint: `POST /v1/credentials` with body `{"invite": "<token>"}`. It returns `{apiId, apiHash}`
  and `Cache-Control: no-store`.
- Errors: 403 for an unknown or revoked invite, 429 when an invite is used up, 400 for a malformed
  request.
- Invites live in KV (`INVITES`) under `invite:<sha256(token)>`. The raw token is never stored.
  Use counts are soft limits, because KV is eventually consistent.
- Secrets are `API_ID` and `API_HASH` (`wrangler secret put`). Logging is off, since request
  bodies carry invite tokens.
- `GET /` is the landing page (`src/landing.ts`: what the tool is, the install command, a link to the
  login page) and `GET /login` is the signup page (see below). `/invite` (its address until 0.36),
  `/?return=`, `/?mode=` and `/?agent=` redirect to `/login`, because released versions of
  `telegram onboard` and old links arrive there. There is no admin HTTP endpoint. Invites are managed locally through wrangler.
- Deployed at `https://tg-cli-broker.login-c2d.workers.dev` (Cloudflare account "Anything* team"); the
  pages are also on `https://better-tg-cli.com` (custom domain, `www` redirects there).

## Signup page

The page, the install guide and the code email come in English (default), Spanish and Russian
(`src/i18n.ts`): `?lang=en|es|ru` wins, then `Accept-Language`. The language links keep the rest
of the query, so `?return=` from `telegram onboard` survives a switch.

`GET /` serves a page where people trade a verified email for a self-serve invite: `POST /v1/invites`
(email + Turnstile) mails a six-digit code, and `POST /v1/invites/verify` (email + code) returns
the invite. Nothing invite-like exists until the code comes back; only a hash of the code is stored.
It hands the app keys to strangers, so it fails closed:

- Closed unless KV `config:signups` is `on` **and** the `TURNSTILE_SECRET` secret, the
  `TURNSTILE_SITE_KEY` var, the `EMAIL` send binding and the `MAIL_FROM` var are set. `MAIL_FROM`
  must be an address on a domain onboarded to Cloudflare Email Sending (Workers Paid): it is
  `invites@better-tg-cli.com`. Closed means a "signups closed" page and `503 signups_closed`.
- Cloudflare Turnstile is verified server-side (widget "better-tg-cli invites", Managed).
- Limits: a per-minute limiter per IP (`SIGNUP_LIMITER`), a 60-second resend wait, 5 tries per code
  (15 minutes), and daily caps per IP, per email and overall as soft KV counters. The daily caps
  are Worker secrets (`SIGNUP_DAILY_CAP`, `SIGNUP_CODES_PER_IP`, `SIGNUP_CODES_PER_EMAIL`), so the
  exact numbers aren't in the repo; without them the conservative fallbacks in `src/signup.ts`
  apply. Change one with `npx wrangler secret put SIGNUP_DAILY_CAP`.
- One invite per email. Each invite logs in up to 3 computers (6 credential requests: a spare one per
  computer for a failed QR scan or 2FA password) and is marked `source: "self-serve"`.
- The email is stored in plaintext under `email:<sha256(email)>` → `{email, inviteKey, createdAt}`,
  only for notifications.

```bash
node scripts/invite.mjs signups on|off|status   # open or close the page; issued invites keep working
node scripts/invite.mjs emails                  # CSV of signup emails
node scripts/invite.mjs revoke-all --self-serve # revoke only page invites
```

The page tells people to have their agent install the CLI and skill, and to run
`telegram auth --login-key` themselves. The token never goes into an agent prompt or argv.

Local run: put `TURNSTILE_SECRET=1x0000000000000000000000000000000AA` (Cloudflare's always-pass test
secret) with fake `API_ID`/`API_HASH` into `broker/.dev.vars` (gitignored), then
`npx wrangler dev --local --var TURNSTILE_SITE_KEY:1x00000000000000000000AA` and
`npx wrangler kv key put config:signups on --binding INVITES --local`. Add
`--var MAIL_FROM:invites@example.test`: locally, `wrangler dev` only logs the email (subject with the
code) instead of sending it.

## Invites

```bash
cd broker
node scripts/invite.mjs create "Alice" --max-uses 3   # prints the token once; send it privately
node scripts/invite.mjs list                          # name, state, uses, last use
node scripts/invite.mjs revoke "Alice"                # or a hash prefix from `list`
```

Revoking an invite blocks new logins with it. It does **not** log out people who already signed
in, because their session belongs to their Telegram account. To stop everyone, rotate the app
keys: create a new app on my.telegram.org, then run `wrangler secret put API_ID` / `API_HASH`.
Existing sessions of the old app keep working until Telegram revokes them.

## Deploy

```bash
cd broker
npx wrangler deploy
printf '%s' "$API_ID" | npx wrangler secret put API_ID
printf '%s' "$API_HASH" | npx wrangler secret put API_HASH
```

CI never deploys this. Tests live in `../test/broker.test.ts`.

## Incident response

**Someone is abusing the app keys** (spam reports, a leaked invite, a flood of logins in
`invite.mjs list`). The goal is to stop new logins first and investigate afterwards.

1. **Stop handing out keys (seconds):** `node scripts/invite.mjs panic`. This deletes the
   `API_HASH` secret, so the worker answers `503 broker_not_configured` to every request before it
   reads KV. The change can take up to a minute to reach every edge.
2. **Revoke invites:** `node scripts/invite.mjs revoke <name>` for the culprit, or
   `node scripts/invite.mjs revoke-all`.
3. **Restore when it's safe:** `npx wrangler secret put API_HASH` and paste the hash from
   my.telegram.org. Check with an invalid token: the answer should be `403 invalid_invite`, not `503`.

**What this can't do.** People who already logged in through an invite keep a working session:
it lives on their machine, and only they (with `telegram logout`) or Telegram can end it. The
api_hash is never stored on their machines, so they can't log in again after a revoke. If Telegram
blocks the app's `api_id`, every invite session stops working. Then create a new app, put its keys
into the broker (`API_ID` and `API_HASH`), and hand out new invites.

**Rate limiting and logs.** `[[ratelimits]]` in `wrangler.toml` allows 5 requests per minute per
IP. Request logging stays off (`observability.enabled = false`) because PRIVACY.md promises it.
Watch abuse through the per-invite `uses` and `last` columns of `invite.mjs list` instead.
