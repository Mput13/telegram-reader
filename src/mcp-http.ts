import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { handleMessage, setKnownCommands } from './mcp.js';
import { isSecretStoreAvailable, secretGet, secretSet } from './secrets.js';

/**
 * `telegram mcp --http`: the same MCP server over Streamable HTTP (one POST /mcp endpoint, JSON
 * responses, stateless), for hosts that can't start a local process: Grok Bot runs its connectors
 * in a cloud sandbox, so it reaches this Mac through a tunnel. The session, the write guard and
 * the audit log stay here. Every request needs the bearer token from `telegram mcp --token`.
 */

const TOKEN_KEY = 'mcpToken';
const MAX_BODY = 1_000_000;

/** The HTTP token lives in the secret store, never in the config file or the environment. */
export function mcpToken(options: { create?: boolean; rotate?: boolean } = {}): string | null {
  if (!isSecretStoreAvailable()) return null;
  const existing = options.rotate ? null : secretGet(TOKEN_KEY);
  if (existing || !(options.create || options.rotate)) return existing;
  const token = `tgmcp_${randomBytes(32).toString('base64url')}`;
  return secretSet(TOKEN_KEY, token) ? token : null;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

export function checkBearer(header: string | undefined, token: string): boolean {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return Boolean(match) && timingSafeEqual(digest(match![1]), digest(token));
}

type Json = Record<string, unknown>;

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { ...(payload ? { 'Content-Type': 'application/json' } : {}), ...headers });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** One line per call on stderr, without arguments or message text (they may be private). */
function logCall(msg: Json, status: string): void {
  const params = (msg.params ?? {}) as Json;
  const args = ((params.arguments ?? {}) as Json).args;
  const what = msg.method === 'tools/call' ? `${params.name} ${Array.isArray(args) ? String(args[0] ?? '') : ''}`.trim() : msg.method;
  console.error(`${new Date().toISOString()} ${what} ${status}`);
}

export type RpcReply = { status: number; body?: unknown };

/**
 * One MCP request body in, one HTTP-style answer out.
 * Calls run one at a time, like over stdio: parallel sessions steal updates and invite FLOOD_WAIT.
 */
export function createRpcProcessor(options: { readOnly?: boolean } = {}, run?: Parameters<typeof handleMessage>[1]) {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };

  return async (text: string): Promise<RpcReply> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } } };
    }
    const batch = Array.isArray(parsed);
    const messages = (batch ? parsed : [parsed]) as Json[];
    const replies: object[] = [];
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') {
        replies.push({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } });
        continue;
      }
      try {
        const reply = await serial(() => handleMessage(msg, run, { readOnly: options.readOnly }));
        if (msg.method === 'tools/call') logCall(msg, (reply as { result?: { isError?: boolean } })?.result?.isError ? 'error' : 'ok');
        if (reply) replies.push(reply);
      } catch (e) {
        replies.push({ jsonrpc: '2.0', id: (msg.id as string | number | undefined) ?? null, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } });
      }
    }
    if (!replies.length) return { status: 202 };
    return { status: 200, body: batch ? replies : replies[0] };
  };
}

export function createMcpHttpHandler(token: string, options: { readOnly?: boolean } = {}, run?: Parameters<typeof handleMessage>[1]) {
  const processRpc = createRpcProcessor(options, run);

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/mcp') return send(res, 404, { error: 'Not found; the MCP endpoint is /mcp' });
    // Browsers send Origin; a server-side MCP client doesn't. Refusing it blocks drive-by pages.
    if (req.headers.origin) return send(res, 403, { error: 'Browser requests are not allowed' });
    if (!checkBearer(req.headers.authorization, token)) {
      return send(res, 401, { error: 'Missing or wrong bearer token' }, { 'WWW-Authenticate': 'Bearer' });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' }, { Allow: 'POST' });

    let text: string;
    try {
      text = await readBody(req);
    } catch {
      return send(res, 413, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Request too large' } });
    }
    const reply = await processRpc(text);
    send(res, reply.status, reply.body);
  };
}

export function startMcpHttpServer(commands: Iterable<string>, options: { host: string; port: number; readOnly?: boolean }): void {
  const token = mcpToken({ create: true });
  if (!token) {
    console.error('The HTTP server needs a secret store for its token (macOS Keychain, Linux Secret Service, Windows DPAPI or 1Password).');
    process.exit(1);
  }
  setKnownCommands(commands);
  const server = createServer((req, res) => {
    createHandler(req, res).catch(e => send(res, 500, { error: e instanceof Error ? e.message : String(e) }));
  });
  const createHandler = createMcpHttpHandler(token, { readOnly: options.readOnly });
  server.listen(options.port, options.host, () => {
    console.error(`MCP over HTTP on http://${options.host}:${options.port}/mcp${options.readOnly ? ' (read-only: no telegram_write)' : ''}`);
    console.error('Clients send "Authorization: Bearer <token>"; print it with `telegram mcp --token`.');
    if (options.host !== '127.0.0.1' && options.host !== 'localhost' && options.host !== '::1') {
      console.error('Listening beyond localhost: anyone who can reach this port and has the token can use your account.');
    }
  });
  server.on('error', e => {
    console.error(`Could not start the HTTP server: ${e.message}`);
    process.exit(1);
  });
}
