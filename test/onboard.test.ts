import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { rpcCode, type LoginDriver } from '../src/auth.js';
import { RPCError } from 'teleproto/errors/index.js';
import { startOnboarding, type OnboardEvent, type OnboardSession } from '../src/onboard.js';
import { errorMessage } from '../src/text.js';

// Raw HTTP so the tests control Host and Origin exactly (fetch won't set Host)
function call(url: string, opts: { method?: string; host?: string; origin?: string; body?: unknown } = {}) {
  const u = new URL(url);
  return new Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
    const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = request({
      host: '127.0.0.1', port: u.port, path: u.pathname, method: opts.method ?? 'GET',
      headers: {
        host: opts.host ?? u.host,
        ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let b = '';
      res.on('data', c => (b += c));
      res.on('end', () => resolve({ status: res.statusCode!, body: b, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

/** A driver the test steers: it shows a QR, optionally asks for a password (wrong first), then succeeds or fails. */
function fakeDriver(plan: { password?: string; wrongFirst?: boolean; failFirst?: boolean } = {}) {
  const calls: { apiId: number; apiHash: string }[] = [];
  let attempt = 0;
  const driver: LoginDriver = {
    async login(creds, io) {
      calls.push(creds);
      attempt++;
      io.onQr('tg://login?token=abc');
      await new Promise(r => setTimeout(r, 20));
      if (plan.failFirst && attempt === 1) throw new Error('AUTH_TOKEN_EXPIRED');
      if (plan.password) {
        let pw = await io.password('my hint');
        if (plan.wrongFirst) {
          io.onPasswordError('PASSWORD_HASH_INVALID');
          pw = await io.password('my hint');
        }
        if (pw !== plan.password) throw new Error('unexpected password');
      }
      return { session: 'SESSION', user: { id: '1', name: 'Alice', username: 'alice' } };
    },
  };
  return { driver, calls };
}

let session: OnboardSession | undefined;
afterEach(() => session?.close());

async function start(plan?: Parameters<typeof fakeDriver>[0]) {
  const events: OnboardEvent[] = [];
  const saved: unknown[] = [];
  const redeemed: string[] = [];
  const { driver, calls } = fakeDriver(plan);
  session = await startOnboarding({
    driver,
    redeemInvite: async token => { redeemed.push(token); return { apiId: 42, apiHash: 'h'.repeat(32) }; },
    save: (s, creds, invite) => saved.push({ s, creds, invite }),
    emit: e => events.push(e),
    site: 'https://site.test',
  });
  const origin = new URL(session.url).origin;
  const post = (route: string, body: unknown, o = origin) => call(session!.url + route, { method: 'POST', origin: o, body });
  const state = async () => JSON.parse((await call(session!.url + 'state')).body);
  const until = async (step: string) => {
    for (let i = 0; i < 100; i++) {
      const s = await state();
      if (s.step === step) return s;
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error(`never reached ${step}: ${JSON.stringify(await state())}`);
  };
  return { events, saved, redeemed, calls, origin, post, state, until };
}

describe('telegram onboard server', () => {
  it('answers only on 127.0.0.1 under the secret path, with the right Host and Origin', async () => {
    const { origin, post } = await start();
    const url = new URL(session!.url);
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.pathname).toMatch(/^\/s\/[A-Za-z0-9_-]{43}\/$/);

    expect((await call(`${origin}/`)).status).toBe(404);
    expect((await call(`${origin}/s/guess/state`)).status).toBe(404);
    expect((await call(session!.url + 'state', { host: 'evil.example:80' })).status).toBe(421); // DNS rebinding
    expect((await call(session!.url + 'invite', { method: 'POST', body: { invite: 'x' } })).status).toBe(403); // no Origin
    expect((await post('invite', { invite: 'x' }, 'https://evil.example')).status).toBe(403);
  });

  it('serves the page with a nonce CSP, no referrer, and the return link to the invite site', async () => {
    await start();
    const res = await call(session!.url);
    expect(res.status).toBe(200);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(String(res.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    expect(res.body).toContain(`https://site.test/?return=${encodeURIComponent(session!.url + 'cb')}`);
    expect((await call(session!.url + 'cb')).status).toBe(200);
    // English, Spanish and Russian strings; the page picks one from navigator.languages
    for (const s of ['Get an invite', 'Obtener una invitación', 'Получить инвайт']) expect(res.body).toContain(s);
  });

  it('goes invite → QR → password → done, and saves only at the end', async () => {
    const { events, saved, redeemed, post, until } = await start({ password: 'secret' });
    expect((await post('invite', { invite: ' tgi_token ' })).status).toBe(202);
    expect(redeemed).toEqual(['tgi_token']);
    const pw = await until('password');
    expect(pw.hint).toBe('my hint');
    expect(saved).toEqual([]);
    expect((await post('password', { password: 'secret' })).status).toBe(202);
    const done = await until('done');
    expect(done.user).toEqual({ id: '1', name: 'Alice', username: 'alice' });
    expect(saved).toEqual([{ s: 'SESSION', creds: { apiId: 42, apiHash: 'h'.repeat(32), invite: true }, invite: true }]);
    expect(events.map(e => e.event)).toEqual(['url', 'waiting_invite', 'waiting_scan', 'need_password', 'done']);
    expect(JSON.stringify(events)).not.toContain('secret');
    await expect(session!.done).resolves.toMatchObject({ username: 'alice' });
    expect((await post('invite', { invite: 'again' })).status).toBe(409);
  });

  it('asks again after a wrong 2FA password and says so', async () => {
    const { post, until } = await start({ password: 'right', wrongFirst: true });
    await post('invite', { invite: 'tgi_token' });
    await until('password');
    await post('password', { password: 'nope' });
    await new Promise(r => setTimeout(r, 30));
    const again = await until('password');
    expect(again.error).toBe('wrong_password');
    await post('password', { password: 'right' });
    await until('done');
  });

  it('retries a failed attempt with the same credentials, without redeeming the invite again', async () => {
    const { post, until, redeemed, calls } = await start({ failFirst: true });
    await post('invite', { invite: 'tgi_token' });
    const failed = await until('error');
    expect(failed.error).toBe('AUTH_TOKEN_EXPIRED');
    expect((await post('retry', {})).status).toBe(202);
    await until('done');
    expect(redeemed).toEqual(['tgi_token']);
    expect(calls).toHaveLength(2);
  });

  it('takes own API keys and checks their shape', async () => {
    const { post, until, saved } = await start();
    expect((await post('invite', { apiId: 'abc', apiHash: 'x' })).status).toBe(400);
    expect((await post('invite', { apiId: '12345', apiHash: 'A'.repeat(32) })).status).toBe(202);
    await until('done');
    expect(saved).toEqual([{ s: 'SESSION', creds: { apiId: 12345, apiHash: 'A'.repeat(32), invite: false }, invite: false }]);
  });

  it('refuses a password nobody asked for', async () => {
    const { post } = await start();
    expect((await post('password', { password: 'x' })).status).toBe(409);
  });
});

describe('errors on the wire', () => {
  it('sends the message of an Error and never a stringified value', () => {
    expect(errorMessage(new Error('Invite expired'))).toBe('Invite expired');
    expect(errorMessage({ stack: 'at secret.ts:1', toString: () => 'dump' })).toBe('Unexpected error');
    expect(errorMessage('plain string')).toBe('Unexpected error');
    expect(errorMessage(undefined)).toBe('Unexpected error');
  });

  it('marks its JSON answers as not to be sniffed', async () => {
    const { state } = await start();
    await state();
    const res = await fetch(session!.url + 'state');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-type')).toBe('application/json');
  });
});

describe('rpcCode', () => {
  it('reads the RPC code, not the readable message', () => {
    const e = new RPCError('PASSWORD_HASH_INVALID', undefined, 400);
    Object.defineProperty(e, 'message', { value: 'The password (and thus its hash value) you entered is invalid' });
    expect(rpcCode(e)).toBe('PASSWORD_HASH_INVALID');
    expect(rpcCode(new Error('plain'))).toBe('plain');
  });
});
