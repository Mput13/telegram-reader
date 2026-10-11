/**
 * Self-serve invites: the page at / trades a verified email (kept only for notifications) for a
 * one-login invite: a six-digit code goes to the address, and only the code gets the invite. Asking
 * again with the same address replaces the invite (a lost token, a session Telegram ended). This hands the maintainer's app keys to strangers, so every guard fails closed:
 * signups are off unless KV `config:signups` is "on", Turnstile must pass server-side, and there
 * are per-IP, per-email and daily caps (Worker secrets, see LIMIT_DEFAULTS). `invite.mjs signups off` closes the page; `/v1/credentials` and
 * invites already issued keep working.
 */
import { sha256Hex, type Env, type Invite } from './handler';
import { asLang, DICT, type Lang } from './i18n';

export const SIGNUPS_KEY = 'config:signups';
// Conservative fallbacks; the live limits are Worker secrets (SIGNUP_DAILY_CAP, SIGNUP_CODES_PER_IP,
// SIGNUP_CODES_PER_EMAIL) so the exact thresholds aren't published with the code
const LIMIT_DEFAULTS = { SIGNUP_DAILY_CAP: 10, SIGNUP_CODES_PER_IP: 4, SIGNUP_CODES_PER_EMAIL: 3 };

function limit(env: Env, name: keyof typeof LIMIT_DEFAULTS): number {
  const n = parseInt(env[name] ?? '', 10);
  return n > 0 ? n : LIMIT_DEFAULTS[name];
}
const DAY_SECONDS = 86_400;

export type SelfServeInvite = Invite & { source: 'self-serve' };
/** `lang` is the page language at signup, for notices in the same language later */
export interface EmailRecord { email: string; inviteKey: string; createdAt: string; lang?: Lang }

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function signupsOpen(env: Env): Promise<boolean> {
  // Verified email is required, so no mail sender means no signups
  return (await env.INVITES.get(SIGNUPS_KEY)) === 'on'
    && Boolean(env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY && env.EMAIL && env.MAIL_FROM);
}

/** Lowercased, trimmed, one @, a dot in the domain, no spaces; null when it doesn't look like an email. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export type TurnstileVerify = (secret: string, token: string, ip: string) => Promise<boolean>;

export const verifyTurnstile: TurnstileVerify = async (secret, token, ip) => {
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  body.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  if (!res.ok) return false;
  return ((await res.json()) as { success?: boolean }).success === true;
};

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return 'tgi_' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Soft counter in KV (eventually consistent, so caps may overshoot slightly under a burst). */
async function bump(env: Env, key: string, cap: number): Promise<boolean> {
  const n = parseInt((await env.INVITES.get(key)) ?? '0', 10) || 0;
  if (n >= cap) return false;
  await env.INVITES.put(key, String(n + 1), { expirationTtl: 2 * DAY_SECONDS });
  return true;
}

// A few logins, so a timed-out QR scan or a wrong 2FA password doesn't burn the invite
const SELF_SERVE_LOGINS = 3;
const CODE_TTL_SECONDS = 15 * 60;
const CODE_ATTEMPTS = 5;
const RESEND_AFTER_MS = 60_000;

interface PendingCode { codeHash: string; attempts: number; sentAt: string; lang?: Lang }

const codeHash = (email: string, code: string) => sha256Hex(`${email}:${code}`);

function newCode(): string {
  // Rejection sampling keeps the six digits uniform
  const buf = new Uint32Array(1);
  let n: number;
  do n = crypto.getRandomValues(buf)[0]; while (n >= 4_294_000_000);
  return String(n % 1_000_000).padStart(6, '0');
}

async function readJson<T>(request: Request): Promise<T | null> {
  try { return (await request.json()) as T; } catch { return null; }
}

/**
 * The invite this email already holds, if any. A revoked one stays a refusal: the maintainer
 * switched it off, and a new code must not undo that. So does one whose record is gone (deleted by
 * hand, or a stale KV read right after a re-issue), since it can't be shown to be unrevoked.
 */
async function previousInvite(env: Env, emailKey: string): Promise<{ key?: string; revoked?: boolean }> {
  const raw = await env.INVITES.get(emailKey);
  if (!raw) return {};
  const key = (JSON.parse(raw) as EmailRecord).inviteKey;
  const invite = await env.INVITES.get(key);
  return { key, revoked: !invite || (JSON.parse(invite) as Invite).revoked === true };
}

/** Shared gate for both steps: method, per-IP limiter, and signups open and fully configured. */
async function gate(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (env.SIGNUP_LIMITER && !(await env.SIGNUP_LIMITER.limit({ key: ip })).success) {
    return json(429, { error: 'rate_limited' });
  }
  if (!(await signupsOpen(env)) || !parseInt(env.API_ID, 10) || !env.API_HASH) {
    return json(503, { error: 'signups_closed' });
  }
  return null;
}

export function codeMail(code: string, lang: Lang) {
  const m = DICT[lang].mail;
  return {
    subject: m.subject(code),
    text: `${m.textIntro(code)}\n\n${m.enter}\n${m.ignore}\n\nhttps://github.com/TheVilfer/better-tg-cli`,
    html: `<div lang="${lang}" style="font:16px/1.5 system-ui,sans-serif;color:#111;max-width:480px">` +
      `<p>${m.intro}</p>` +
      `<p style="font:600 32px/1 ui-monospace,monospace;letter-spacing:6px;margin:20px 0">${code}</p>` +
      `<p>${m.enter}</p>` +
      `<p style="color:#666;font-size:14px">${m.ignore}</p></div>`,
  };
}

/**
 * Step 1: email + Turnstile → a six-digit code by email. Nothing about the invite is created yet,
 * so a fake or someone else's address gets nowhere.
 */
export async function handleSignup(request: Request, env: Env, now = new Date(), verify = verifyTurnstile): Promise<Response> {
  const closed = await gate(request, env);
  if (closed) return closed;
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';

  const body = await readJson<{ email?: unknown; turnstile?: unknown; lang?: unknown }>(request);
  if (!body) return json(400, { error: 'bad_request' });
  const email = normalizeEmail(body.email);
  if (!email) return json(400, { error: 'bad_email' });
  if (typeof body.turnstile !== 'string' || !body.turnstile || body.turnstile.length > 4096) {
    return json(400, { error: 'captcha_failed' });
  }
  if (!(await verify(env.TURNSTILE_SECRET!, body.turnstile, ip))) return json(403, { error: 'captcha_failed' });

  const id = await sha256Hex(email);
  if ((await previousInvite(env, `email:${id}`)).revoked) return json(409, { error: 'email_used' });
  const pending = await env.INVITES.get(`verify:${id}`);
  if (pending && now.getTime() - Date.parse((JSON.parse(pending) as PendingCode).sentAt) < RESEND_AFTER_MS) {
    return json(429, { error: 'resend_wait' });
  }

  const day = now.toISOString().slice(0, 10);
  // Per-email first, so a refused resend doesn't also eat the IP's allowance
  if (!(await bump(env, `count:mail:${day}:${id}`, limit(env, 'SIGNUP_CODES_PER_EMAIL')))) return json(429, { error: 'rate_limited' });
  if (!(await bump(env, `count:ip:${day}:${await sha256Hex(ip)}`, limit(env, 'SIGNUP_CODES_PER_IP')))) {
    return json(429, { error: 'rate_limited' });
  }

  const code = newCode();
  const lang = asLang(body.lang);
  const record: PendingCode = { codeHash: await codeHash(email, code), attempts: 0, sentAt: now.toISOString(), lang };
  await env.INVITES.put(`verify:${id}`, JSON.stringify(record), { expirationTtl: CODE_TTL_SECONDS });
  try {
    await env.EMAIL!.send({ to: email, from: { email: env.MAIL_FROM!, name: 'Better-TG-CLI' }, ...codeMail(code, lang) });
  } catch {
    return json(502, { error: 'mail_failed' });
  }
  return json(202, { status: 'code_sent' });
}

/** Step 2: email + code → the one-login invite, replacing an earlier one. Five wrong codes burn the pending code. */
export async function handleVerify(request: Request, env: Env, now = new Date()): Promise<Response> {
  const closed = await gate(request, env);
  if (closed) return closed;

  const body = await readJson<{ email?: unknown; code?: unknown }>(request);
  if (!body) return json(400, { error: 'bad_request' });
  const email = normalizeEmail(body.email);
  const code = typeof body.code === 'string' ? body.code.replace(/\s/g, '') : '';
  if (!email || !/^\d{6}$/.test(code)) return json(400, { error: 'bad_code' });

  const id = await sha256Hex(email);
  const verifyKey = `verify:${id}`;
  const raw = await env.INVITES.get(verifyKey);
  if (!raw) return json(410, { error: 'code_expired' });
  const pending = JSON.parse(raw) as PendingCode;
  if (pending.attempts >= CODE_ATTEMPTS) {
    await env.INVITES.delete(verifyKey);
    return json(429, { error: 'too_many_attempts' });
  }
  if ((await codeHash(email, code)) !== pending.codeHash) {
    pending.attempts += 1;
    const left = CODE_TTL_SECONDS - Math.floor((now.getTime() - Date.parse(pending.sentAt)) / 1000);
    await env.INVITES.put(verifyKey, JSON.stringify(pending), { expirationTtl: Math.max(60, left) });
    return json(403, { error: 'bad_code' });
  }
  await env.INVITES.delete(verifyKey);

  const emailKey = `email:${id}`;
  const previous = await previousInvite(env, emailKey);
  if (previous.revoked) return json(409, { error: 'email_used' });
  const day = now.toISOString().slice(0, 10);
  if (!(await bump(env, `count:day:${day}`, limit(env, 'SIGNUP_DAILY_CAP')))) return json(429, { error: 'daily_limit' });

  const token = newToken();
  const inviteKey = `invite:${await sha256Hex(token)}`;
  const createdAt = now.toISOString();
  const invite: SelfServeInvite = { name: email, createdAt, uses: 0, maxUses: SELF_SERVE_LOGINS, source: 'self-serve' };
  await env.INVITES.put(inviteKey, JSON.stringify(invite));
  // One email, one working invite: the new one replaces the old
  if (previous.key) await env.INVITES.delete(previous.key);
  const record: EmailRecord = { email, inviteKey, createdAt, lang: pending.lang ?? 'en' };
  await env.INVITES.put(emailKey, JSON.stringify(record));
  return json(201, { invite: token });
}
