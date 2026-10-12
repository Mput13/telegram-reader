import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { renderSVG } from 'uqr';
import type { LoginDriver, LoginUser } from './auth.js';
import { onboardPage } from './onboard-page.js';
import { errorMessage } from './text.js';

/**
 * `telegram onboard`: a one-shot page on 127.0.0.1 where the person logs in, so an agent can start
 * the whole setup without ever seeing a login key, API hash, QR code or 2FA password. The agent
 * runs the command; the human gets a login key (better-tg-cli.com hands it back here), scans the QR
 * and types the password on the page.
 *
 * Any site in the same browser can send requests to 127.0.0.1, so the server answers only under a
 * random secret path, checks Host (DNS rebinding) and Origin (cross-site POSTs), keeps nothing on
 * disk until Telegram accepts the login, and shuts down when done.
 */

export const ONBOARD_SITE = 'https://better-tg-cli.com';
const MAX_BODY = 16_000;

export type OnboardStep = 'invite' | 'connecting' | 'scan' | 'password' | 'done' | 'error';

export interface OnboardState {
  step: OnboardStep;
  qrSvg?: string;
  hint?: string;
  error?: string;
  user?: LoginUser;
}

export type OnboardEvent =
  | { event: 'url'; url: string }
  | { event: 'waiting_invite' }
  | { event: 'waiting_scan' }
  | { event: 'need_password' }
  | { event: 'done'; user: LoginUser }
  | { event: 'error'; message: string };

export interface OnboardOptions {
  driver: LoginDriver;
  /** Turns a login key into app credentials (the broker); called once per session */
  redeemInvite(token: string): Promise<{ apiId: number; apiHash: string }>;
  /** Stores the finished login */
  save(session: string, creds: { apiId: number; apiHash: string }, invite: boolean): void;
  emit(event: OnboardEvent): void;
  site?: string;
  port?: number;
}

export interface OnboardSession {
  url: string;
  /** Resolves with the user once the login is saved */
  done: Promise<LoginUser>;
  close(): void;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

export async function startOnboarding(options: OnboardOptions): Promise<OnboardSession> {
  const secret = randomBytes(32).toString('base64url');
  const state: OnboardState = { step: 'invite' };
  const abort = new AbortController();
  let creds: { apiId: number; apiHash: string; invite: boolean } | undefined;
  let running = false;
  let passwordWaiter: ((password: string) => void) | undefined;
  let resolveDone!: (user: LoginUser) => void;
  const done = new Promise<LoginUser>(r => (resolveDone = r));

  const set = (patch: Partial<OnboardState>) => Object.assign(state, { error: undefined }, patch);

  async function runLogin(): Promise<void> {
    if (!creds || running) return;
    running = true;
    set({ step: 'connecting', qrSvg: undefined });
    try {
      const result = await options.driver.login(creds, {
        onQr: url => {
          const first = state.step !== 'scan';
          set({ step: 'scan', qrSvg: renderSVG(url, { border: 2 }) });
          if (first) options.emit({ event: 'waiting_scan' });
        },
        password: hint => new Promise<string>(resolve => {
          // Keep "wrong password" from the previous try visible on the page
          const wrong = state.error === 'wrong_password';
          set({ step: 'password', hint, qrSvg: undefined });
          if (wrong) state.error = 'wrong_password';
          options.emit({ event: 'need_password' });
          passwordWaiter = resolve;
        }),
        onPasswordError: () => { state.error = 'wrong_password'; },
        signal: abort.signal,
      });
      options.save(result.session, creds, creds.invite);
      set({ step: 'done', user: result.user, qrSvg: undefined });
      options.emit({ event: 'done', user: result.user });
      resolveDone(result.user);
    } catch (e) {
      if (abort.signal.aborted) return;
      const message = errorMessage(e);
      set({ step: 'error', error: message, qrSvg: undefined });
      options.emit({ event: 'error', message });
    } finally {
      running = false;
    }
  }

  let origin = '';
  const base = `/s/${secret}/`;

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Only our exact host: a rebinding domain pointing at 127.0.0.1 sends its own Host
    if (req.headers.host !== origin.slice('http://'.length)) return json(res, 421, { error: 'wrong_host' });
    const path = (req.url ?? '').split('?')[0];
    if (!path.startsWith(base)) return json(res, 404, { error: 'not_found' });
    const route = path.slice(base.length);

    if (req.method === 'GET' && (route === '' || route === 'cb')) {
      const { html, csp } = onboardPage({ site: options.site ?? ONBOARD_SITE, returnTo: `${origin}${base}cb` });
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': csp,
        // The URL carries the secret; never send it along to another site
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      });
      res.end(html);
      return;
    }
    if (req.method === 'GET' && route === 'state') return json(res, 200, state);
    if (req.method !== 'POST') return json(res, 404, { error: 'not_found' });
    // Same-origin page only; browsers always send Origin on POST
    if (req.headers.origin !== origin) return json(res, 403, { error: 'wrong_origin' });

    let body: Record<string, unknown>;
    try {
      body = (await readBody(req)) as Record<string, unknown>;
    } catch {
      return json(res, 400, { error: 'bad_request' });
    }

    if (route === 'invite') {
      if (creds) return json(res, 409, { error: 'already_started' });
      try {
        if (typeof body.invite === 'string' && body.invite.trim()) {
          creds = { ...(await options.redeemInvite(body.invite.trim())), invite: true };
        } else {
          const apiId = Number(body.apiId);
          const apiHash = typeof body.apiHash === 'string' ? body.apiHash.trim() : '';
          if (!Number.isInteger(apiId) || apiId <= 0 || !/^[0-9a-f]{32}$/i.test(apiHash)) {
            return json(res, 400, { error: 'bad_keys' });
          }
          creds = { apiId, apiHash, invite: false };
        }
      } catch (e) {
        return json(res, 400, { error: 'invite_failed', message: errorMessage(e) });
      }
      void runLogin();
      return json(res, 202, { ok: true });
    }
    if (route === 'password') {
      if (state.step !== 'password' || !passwordWaiter || typeof body.password !== 'string' || !body.password) {
        return json(res, 409, { error: 'not_waiting_for_password' });
      }
      const give = passwordWaiter;
      passwordWaiter = undefined;
      set({ step: 'connecting' });
      give(body.password);
      return json(res, 202, { ok: true });
    }
    if (route === 'retry') {
      // Same credentials, no new invite use: a timed-out scan or a failed attempt starts over
      if (!creds || running || state.step !== 'error') return json(res, 409, { error: 'nothing_to_retry' });
      void runLogin();
      return json(res, 202, { ok: true });
    }
    return json(res, 404, { error: 'not_found' });
  };

  const server: Server = createServer((req, res) => {
    handler(req, res).catch(() => json(res, 500, { error: 'internal' }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;
  const url = `${origin}${base}`;
  options.emit({ event: 'url', url });
  options.emit({ event: 'waiting_invite' });

  const close = () => {
    abort.abort();
    server.closeAllConnections?.();
    server.close();
  };
  return { url, done, close };
}
