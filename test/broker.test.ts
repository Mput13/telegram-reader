import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { handle, sha256Hex, type Env, type Invite } from '../broker/src/handler.js';
import { handleSignup, handleVerify, normalizeEmail, SIGNUPS_KEY } from '../broker/src/signup.js';
import { loopbackReturn } from '../broker/src/page.js';
import { pickLang } from '../broker/src/i18n.js';

const TOKEN = 'tok_' + 'x'.repeat(40);

async function env(invite?: Partial<Invite>, over: Partial<Env> = {}) {
  const store = new Map<string, string>();
  if (invite) {
    store.set(
      `invite:${await sha256Hex(TOKEN)}`,
      JSON.stringify({ name: 'alice', createdAt: '2026-09-27', uses: 0, maxUses: 2, ...invite })
    );
  }
  const e: Env = {
    INVITES: { get: async k => store.get(k) ?? null, put: async (k, v) => void store.set(k, v), delete: async k => void store.delete(k) },
    API_ID: '12345',
    API_HASH: 'hash123',
    ...over,
  };
  return { e, store };
}

const post = (body: unknown) =>
  new Request('https://broker.test/v1/credentials', { method: 'POST', body: JSON.stringify(body) });

describe('credential broker', () => {
  it('returns credentials for a valid invite and counts the use', async () => {
    const { e, store } = await env({});
    const res = await handle(post({ invite: TOKEN }), e);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ apiId: 12345, apiHash: 'hash123' });
    const rec = JSON.parse([...store.values()][0]);
    expect(rec.uses).toBe(1);
    expect(rec.lastUsedAt).toBeTruthy();
  });

  it('stores only the token hash, never the raw token', async () => {
    const { store } = await env({});
    expect([...store.keys()].join()).not.toContain(TOKEN);
  });

  it('rejects unknown, revoked and used-up invites', async () => {
    expect((await handle(post({ invite: 'tok_' + 'y'.repeat(40) }), (await env({})).e)).status).toBe(403);
    expect((await handle(post({ invite: TOKEN }), (await env({ revoked: true })).e)).status).toBe(403);
    expect((await handle(post({ invite: TOKEN }), (await env({ uses: 2 })).e)).status).toBe(429);
  });

  it('rejects malformed requests and other routes', async () => {
    const { e } = await env({});
    expect((await handle(post({ invite: 'short' }), e)).status).toBe(400);
    expect((await handle(new Request('https://broker.test/v1/credentials?invite=' + TOKEN), e)).status).toBe(405);
    expect((await handle(new Request('https://broker.test/nope'), e)).status).toBe(404);
    // / is the signup page now (see the signup tests below)
  });

  it('does not burn an invite use when the broker is misconfigured', async () => {
    const { e, store } = await env({}, { API_HASH: '' });
    expect((await handle(post({ invite: TOKEN }), e)).status).toBe(503);
    expect(JSON.parse([...store.values()][0]).uses).toBe(0);
  });
  it('rate-limits per IP before touching KV', async () => {
    const seen: string[] = [];
    const { e, store } = await env({});
    e.LIMITER = { limit: async ({ key }) => { seen.push(key); return { success: false }; } };
    const req = new Request('https://broker.test/v1/credentials', {
      method: 'POST', body: JSON.stringify({ invite: 'x'.repeat(30) }), headers: { 'cf-connecting-ip': '203.0.113.9' },
    });
    const res = await handle(req, e);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(seen).toEqual(['203.0.113.9']);
    expect(JSON.parse(store.values().next().value!).uses).toBe(0); // no use consumed
  });
});

describe('self-serve signup', () => {
  const NOW = new Date('2026-09-28T12:00:00Z');
  const later = (ms: number) => new Date(NOW.getTime() + ms);
  type Mail = { to: string; subject: string; text: string };
  const open = async (over: Partial<Env> = {}) => {
    const mails: Mail[] = [];
    const r = await env(undefined, {
      TURNSTILE_SECRET: 'ts-secret', TURNSTILE_SITE_KEY: 'site-key', MAIL_FROM: 'invites@example.test',
      EMAIL: { send: async m => void mails.push(m) }, ...over,
    });
    r.store.set(SIGNUPS_KEY, 'on');
    return { ...r, mails };
  };
  const req = (path: string, body: unknown, ip = '198.51.100.7') =>
    new Request(`https://broker.test${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'cf-connecting-ip': ip } });
  const pass = async () => true;
  const ask = (e: Env, email: string, ip?: string, at = NOW, verify = pass) =>
    handleSignup(req('/v1/invites', { email, turnstile: 't' }, ip), e, at, verify);
  const confirm = (e: Env, email: string, code: string, at = NOW) =>
    handleVerify(req('/v1/invites/verify', { email, code }), e, at);
  const codeOf = (mails: Mail[]) => /(\d{6})/.exec(mails.at(-1)!.subject)![1];
  const keysBesides = (store: Map<string, string>) => [...store.keys()].filter(k => k !== SIGNUPS_KEY && !k.startsWith('count:'));

  it('is closed unless switched on and Turnstile and mail are configured', async () => {
    const off = await env(undefined, { TURNSTILE_SECRET: 's', TURNSTILE_SITE_KEY: 'k', MAIL_FROM: 'a@b.co', EMAIL: { send: async () => {} } });
    expect((await ask(off.e, 'a@b.co')).status).toBe(503);
    for (const over of [{ TURNSTILE_SECRET: undefined }, { EMAIL: undefined }, { MAIL_FROM: undefined }, { API_HASH: '' }]) {
      const { e } = await open(over);
      expect((await ask(e, 'a@b.co')).status).toBe(503);
      expect((await confirm(e, 'a@b.co', '123456')).status).toBe(503);
    }
    const page = await handle(new Request('https://broker.test/'), off.e);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Signups are closed right now');
  });

  it('serves the form with a nonce CSP when open', async () => {
    const { e } = await open();
    const res = await handle(new Request('https://broker.test/'), e);
    const html = await res.text();
    expect(html).toContain('data-sitekey="site-key"');
    expect(html).toContain('autocomplete="one-time-code"');
    const csp = res.headers.get('content-security-policy')!;
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('shows the install guide (Auto and PRO, one PRO tab per agent), open or closed', async () => {
    for (const { e } of [await open(), await env()]) {
      const html = await (await handle(new Request('https://broker.test/'), e)).text();
      const tabs = [...html.matchAll(/role="tab" id="tab-([a-z-]+)"/g)].map(m => m[1]);
      expect(tabs).toEqual(['auto', 'pro', 'claude-code', 'codex', 'cursor', 'claude-desktop']);
      expect(html).toContain('telegram onboard --json'); // the Auto prompt
      expect(html).toContain('telegram auth --invite --qr');
      expect(html).not.toMatch(/ style="/); // blocked by the nonce CSP
    }
  });

  it('refuses a failed captcha and bad emails without storing or sending anything', async () => {
    const { e, store, mails } = await open();
    expect((await ask(e, 'a@b.co', undefined, NOW, async () => false)).status).toBe(403);
    expect((await ask(e, 'nope')).status).toBe(400);
    expect((await handleSignup(req('/v1/invites', { email: 'a@b.co' }), e, NOW, pass)).status).toBe(400);
    expect([...store.keys()]).toEqual([SIGNUPS_KEY]);
    expect(mails).toEqual([]);
  });

  it('mails a code and gives a one-login invite only for the right code', async () => {
    const { e, store, mails } = await open();
    const sent = await ask(e, '  Alice@Example.COM ');
    expect(sent.status).toBe(202);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe('alice@example.com');
    const code = codeOf(mails);
    expect(mails[0].text).toContain(code);
    // Nothing invite-like exists until the code comes back, and the code itself is not stored
    expect(keysBesides(store).every(k => k.startsWith('verify:'))).toBe(true);
    expect([...store.values()].join()).not.toContain(code);

    const wrong = code === '000000' ? '000001' : '000000';
    expect((await confirm(e, 'alice@example.com', wrong)).status).toBe(403);
    const ok = await confirm(e, 'ALICE@example.com', code.slice(0, 3) + ' ' + code.slice(3));
    expect(ok.status).toBe(201);
    const { invite } = (await ok.json()) as { invite: string };
    expect(invite).toMatch(/^tgi_[A-Za-z0-9_-]{43}$/);
    expect([...store.keys()].join()).not.toContain(invite);
    expect(keysBesides(store).some(k => k.startsWith('verify:'))).toBe(false); // the code is spent

    const rec = JSON.parse(store.get(`invite:${await sha256Hex(invite)}`)!);
    expect(rec).toMatchObject({ name: 'alice@example.com', maxUses: 3, uses: 0, source: 'self-serve' });
    const email = JSON.parse(store.get(`email:${await sha256Hex('alice@example.com')}`)!);
    expect(email).toMatchObject({ email: 'alice@example.com', inviteKey: `invite:${await sha256Hex(invite)}` });

    expect((await confirm(e, 'alice@example.com', code)).status).toBe(410);
    // A few logins, so a failed QR scan or a wrong 2FA password doesn't burn the invite
    for (let i = 0; i < 3; i++) expect((await handle(post({ invite }), e)).status).toBe(200);
    expect((await handle(post({ invite }), e)).status).toBe(429);
  });

  it('replaces the invite when the same email asks again, unless it was revoked', async () => {
    const { e, store, mails } = await open();
    const issue = async (at: Date) => {
      expect((await ask(e, 'a@b.co', undefined, at)).status).toBe(202);
      const res = await confirm(e, 'a@b.co', codeOf(mails), at);
      expect(res.status).toBe(201);
      return ((await res.json()) as { invite: string }).invite;
    };
    const first = await issue(NOW);
    const second = await issue(later(61_000));
    expect(second).not.toBe(first);
    expect(keysBesides(store).filter(k => k.startsWith('invite:'))).toEqual([`invite:${await sha256Hex(second)}`]);
    expect((await handle(post({ invite: first }), e)).status).toBe(403);
    expect((await handle(post({ invite: second }), e)).status).toBe(200);

    const key = `invite:${await sha256Hex(second)}`;
    store.set(key, JSON.stringify({ ...JSON.parse(store.get(key)!), revoked: true }));
    const refused = await ask(e, 'a@b.co', undefined, later(122_000));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'email_used' });
    expect(mails).toHaveLength(2);

    // A missing invite record can't be shown to be unrevoked, so it refuses too
    store.delete(key);
    expect((await ask(e, 'a@b.co', undefined, later(183_000))).status).toBe(409);
    expect(mails).toHaveLength(2);
  });

  it('refuses the code as well when the invite was revoked after the code went out', async () => {
    const { e, store, mails } = await open();
    await ask(e, 'a@b.co');
    const { invite } = (await (await confirm(e, 'a@b.co', codeOf(mails))).json()) as { invite: string };
    expect((await ask(e, 'a@b.co', undefined, later(61_000))).status).toBe(202);
    const key = `invite:${await sha256Hex(invite)}`;
    store.set(key, JSON.stringify({ ...JSON.parse(store.get(key)!), revoked: true }));
    const res = await confirm(e, 'a@b.co', codeOf(mails), later(62_000));
    expect(res.status).toBe(409);
    expect(keysBesides(store).filter(k => k.startsWith('invite:'))).toEqual([key]);
  });

  it('burns the code after five wrong tries', async () => {
    const { e, mails } = await open();
    await ask(e, 'a@b.co');
    const code = codeOf(mails);
    const wrong = code === '111111' ? '222222' : '111111';
    for (let i = 0; i < 5; i++) expect((await confirm(e, 'a@b.co', wrong)).status).toBe(403);
    expect((await confirm(e, 'a@b.co', code)).status).toBe(429);
    expect((await confirm(e, 'a@b.co', code)).status).toBe(410);
    expect((await confirm(e, 'a@b.co', '12345')).status).toBe(400);
  });

  it('limits resends per email and codes per IP, and caps invites per day', async () => {
    const { e, mails } = await open({ SIGNUP_DAILY_CAP: '1', SIGNUP_CODES_PER_IP: '6', SIGNUP_CODES_PER_EMAIL: '3' });
    expect((await ask(e, 'a@b.co')).status).toBe(202);
    expect((await ask(e, 'a@b.co')).status).toBe(429); // resend_wait
    expect((await ask(e, 'a@b.co', undefined, later(61_000))).status).toBe(202);
    expect((await ask(e, 'a@b.co', undefined, later(122_000))).status).toBe(202);
    expect((await ask(e, 'a@b.co', undefined, later(183_000))).status).toBe(429); // 3 codes per email per day
    expect((await ask(e, 'c@b.co', undefined)).status).toBe(202);
    expect((await ask(e, 'd@b.co', undefined)).status).toBe(202);
    expect((await ask(e, 'x@b.co', undefined)).status).toBe(202);
    expect((await ask(e, 'y@b.co', undefined)).status).toBe(429); // 6 codes per IP per day

    expect((await confirm(e, 'c@b.co', codeOf(mails.filter(m => m.to === 'c@b.co')))).status).toBe(201);
    const capped = await confirm(e, 'd@b.co', codeOf(mails.filter(m => m.to === 'd@b.co')));
    expect(capped.status).toBe(429);
    expect(await capped.json()).toEqual({ error: 'daily_limit' });
  });

  it('falls back to conservative limits when the secrets are missing', async () => {
    const { e } = await open();
    const codes = [];
    for (const who of ['a', 'b', 'c', 'd', 'e']) codes.push((await ask(e, `${who}@b.co`)).status);
    expect(codes).toEqual([202, 202, 202, 202, 429]); // 4 codes per IP per day by default
  });

  it('reports a mail failure', async () => {
    const { e } = await open({ EMAIL: { send: async () => { throw new Error('E_SENDER_NOT_VERIFIED'); } } });
    const res = await ask(e, 'a@b.co');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'mail_failed' });
  });

  it('rate-limits per IP before any other work', async () => {
    const { e, store, mails } = await open();
    e.SIGNUP_LIMITER = { limit: async () => ({ success: false }) };
    let verified = false;
    const res = await ask(e, 'a@b.co', undefined, NOW, async () => (verified = true));
    expect(res.status).toBe(429);
    expect((await confirm(e, 'a@b.co', '123456')).status).toBe(429);
    expect(verified).toBe(false);
    expect([...store.keys()]).toEqual([SIGNUPS_KEY]);
    expect(mails).toEqual([]);
  });

  it('accepts only a telegram onboard loopback callback as ?return=', async () => {
    const good = 'http://127.0.0.1:54321/s/' + 'a'.repeat(43) + '/cb';
    expect(loopbackReturn(good)).toBe(good);
    for (const bad of [
      null, '', 'https://evil.example/cb', 'http://localhost:54321/s/' + 'a'.repeat(43) + '/cb',
      'http://127.0.0.1:54321/s/short/cb', 'http://127.0.0.1:80/s/' + 'a'.repeat(43) + '/cb',
      good + '?x=1', good + '/', 'http://127.0.0.1:54321@evil.example/s/' + 'a'.repeat(43) + '/cb',
      'http://127.0.0.1:99999/s/' + 'a'.repeat(43) + '/cb', 'javascript:alert(1)//http://127.0.0.1:5000/s/' + 'a'.repeat(43) + '/cb',
    ]) expect(loopbackReturn(bad)).toBeNull();

    const { e } = await open();
    const html = async (q: string) => (await handle(new Request(`https://broker.test/?return=${encodeURIComponent(q)}`), e)).text();
    expect(await html(good)).toContain(`data-return="${good}"`);
    expect(await html('https://evil.example/cb')).not.toContain('data-return');
  });

  it('serves link-preview tags, the og image and the favicon', async () => {
    const { e } = await open();
    const html = await (await handle(new Request('https://broker.test/'), e)).text();
    expect(html).toContain('<meta property="og:image" content="https://better-tg-cli.com/og.png">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('<meta property="og:url" content="https://better-tg-cli.com/">');
    expect(html).toContain('rel="icon" href="/favicon.svg"');
    expect(html).not.toContain('noindex');
    const es = await (await handle(new Request('https://broker.test/?lang=es'), e)).text();
    expect(es).toContain('<meta property="og:locale" content="es_ES">');
    expect(es).toContain('<link rel="canonical" href="https://better-tg-cli.com/?lang=es">');
    const cli = `http://127.0.0.1:54321/s/${'a'.repeat(43)}/cb`;
    const fromCli = await (await handle(new Request(`https://broker.test/?return=${encodeURIComponent(cli)}`), e)).text();
    expect(fromCli).toContain('noindex');

    const png = await handle(new Request('https://broker.test/og.png'), e);
    expect(png.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await png.arrayBuffer());
    expect(Buffer.from(bytes).equals(readFileSync('assets/social-preview.png'))).toBe(true);
    const icon = await handle(new Request('https://broker.test/favicon.svg'), e);
    expect(icon.headers.get('content-type')).toBe('image/svg+xml');
    expect(await icon.text()).toBe(readFileSync('assets/icon.svg', 'utf8').trim());
    expect(await (await handle(new Request('https://broker.test/robots.txt'), e)).text()).toContain('Disallow: /v1/');
  });

  describe('languages', () => {
    const CYRILLIC = /[А-Яа-яЁё]/;
    const get = async (e: Env, q = '', accept?: string) =>
      handle(new Request(`https://broker.test/${q}`, { headers: accept ? { 'accept-language': accept } : {} }), e);

    it('picks ?lang=, then Accept-Language, then English', () => {
      expect(pickLang(null, null)).toBe('en');
      expect(pickLang(null, 'es-419,es;q=0.9,en;q=0.8')).toBe('es');
      expect(pickLang(null, 'de-DE,de;q=0.9,ru;q=0.8,en;q=0.7')).toBe('ru');
      expect(pickLang(null, 'fr, en;q=0.1, es;q=0.5')).toBe('es');
      expect(pickLang(null, 'ja,zh')).toBe('en');
      expect(pickLang('RU', 'es')).toBe('ru');
      expect(pickLang('xx', 'es')).toBe('es');
    });

    it('renders English and Spanish pages without a single Russian string, open, closed and from the CLI', async () => {
      const onboard = '?return=' + encodeURIComponent('http://127.0.0.1:54321/s/' + 'a'.repeat(43) + '/cb');
      for (const { e } of [await open(), await env()]) {
        for (const [accept, lang] of [[undefined, 'en'], ['es-ES,es;q=0.9', 'es']] as const) {
          for (const q of ['', onboard]) {
            const res = await get(e, q, accept);
            const html = await res.text();
            expect(res.headers.get('vary')).toBe('Accept-Language');
            expect(html).toContain(`<html lang="${lang}">`);
            // Only the language switcher names Russian
            expect(html.replace('>Русский</a>', '')).not.toMatch(CYRILLIC);
          }
        }
      }
      expect(await (await get((await open()).e, '', 'ru')).text()).toContain('Получить код на почту');
    });

    it('keeps ?return= and the other parameters in the language links', async () => {
      const { e } = await open();
      const back = 'http://127.0.0.1:54321/s/' + 'a'.repeat(43) + '/cb';
      const html = await (await get(e, `?return=${encodeURIComponent(back)}&agent=codex`)).text();
      const links = [...html.matchAll(/<a href="\/\?([^"]+)" hreflang="(\w+)"/g)];
      expect(links.map(m => m[2])).toEqual(['es', 'ru']);
      for (const [, q, l] of links) {
        const params = new URLSearchParams(q.replace(/&amp;/g, '&'));
        expect(params.get('return')).toBe(back);
        expect(params.get('agent')).toBe('codex');
        expect(params.get('lang')).toBe(l);
      }
    });

    it('mails the code in the page language and remembers it', async () => {
      const { e, store, mails } = await open();
      const send = (email: string, lang?: string) =>
        handleSignup(req('/v1/invites', { email, turnstile: 't', lang }), e, NOW, pass);
      await send('es@b.co', 'es');
      expect(mails.at(-1)!.subject).toMatch(/^Tu código de invitación/);
      await send('ru@b.co', 'ru');
      expect(mails.at(-1)!.subject).toMatch(/^Код для инвайта/);
      await send('xx@b.co', 'fr');
      expect(mails.at(-1)!.subject).toMatch(/^Your better-tg-cli invite code/);
      expect(mails[2].text).not.toMatch(CYRILLIC);
      expect((await confirm(e, 'es@b.co', codeOf(mails.filter(m => m.to === 'es@b.co')))).status).toBe(201);
      expect(JSON.parse(store.get(`email:${await sha256Hex('es@b.co')}`)!).lang).toBe('es');
    });
  });

  it('normalizes emails', () => {
    expect(normalizeEmail(' X@Y.Io ')).toBe('x@y.io');
    for (const bad of ['', 'a@b', 'a b@c.io', '@c.io', 'a@@c.io', 42, 'a@' + 'b'.repeat(260) + '.io']) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });
});
