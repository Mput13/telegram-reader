import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { checkBearer, createMcpHttpHandler } from '../src/mcp-http.js';
import { setKnownCommands } from '../src/mcp.js';

const TOKEN = 'tgmcp_test-token';
const calls: string[][] = [];
// Stands in for the CLI: records argv, never touches an account
const fakeRun = async (plan: { argv: string[] }) => {
  calls.push(plan.argv);
  return { content: [{ type: 'text' as const, text: `ran ${plan.argv.join(' ')}` }] };
};

function serve(readOnly: boolean): Promise<{ server: Server; url: string }> {
  const handler = createMcpHttpHandler(TOKEN, { readOnly }, fakeRun);
  const server = createServer((req, res) => void handler(req, res));
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
  }));
}

const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const post = (url: string, body: unknown, headers: Record<string, string> = auth) =>
  fetch(`${url}/mcp`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

let full: { server: Server; url: string };
let readOnly: { server: Server; url: string };

beforeAll(async () => {
  setKnownCommands(['whoami', 'read', 'send', 'help-all']);
  full = await serve(false);
  readOnly = await serve(true);
});
afterAll(() => {
  full.server.close();
  readOnly.server.close();
});

describe('bearer check', () => {
  it('accepts only the exact token', () => {
    expect(checkBearer(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(checkBearer(`bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(checkBearer(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(checkBearer(TOKEN, TOKEN)).toBe(false);
    expect(checkBearer(undefined, TOKEN)).toBe(false);
  });
});

describe('telegram mcp --http', () => {
  it('refuses requests without the token, from browsers, on other paths and methods', async () => {
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
    expect((await post(full.url, init, { 'Content-Type': 'application/json' })).status).toBe(401);
    expect((await post(full.url, init, { ...auth, Authorization: 'Bearer nope' })).status).toBe(401);
    expect((await post(full.url, init, { ...auth, Origin: 'https://evil.example' })).status).toBe(403);
    expect((await fetch(`${full.url}/`, { method: 'POST', headers: auth, body: '{}' })).status).toBe(404);
    expect((await fetch(`${full.url}/mcp`, { headers: auth })).status).toBe(405);
    expect(calls).toEqual([]);
  });

  it('serves initialize, tools and calls; notifications get 202', async () => {
    const init = await post(full.url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
    expect(init.status).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe('better-tg-cli');
    expect((await post(full.url, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    const list = await (await post(full.url, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['telegram_help', 'telegram_read', 'telegram_write']);
    const read = await (await post(full.url, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'telegram_read', arguments: { args: ['whoami'] } } })).json();
    expect(read.result.content[0].text).toBe('ran whoami');
  });

  it('answers batches and bad JSON', async () => {
    const batch = await (await post(full.url, [
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
    ])).json();
    expect(batch.map((r: { id: number }) => r.id)).toEqual([1, 2]);
    const bad = await post(full.url, '{nope');
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe(-32700);
  });

  it('answers as JSON that is never sniffed, and keeps the details of an internal failure to itself', async () => {
    const ok = await post(full.url, { jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(ok.headers.get('content-type')).toBe('application/json');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await post(full.url, '{nope')).headers.get('x-content-type-options')).toBe('nosniff');

    // The CLI run blows up: that is our failure, so the client gets a fixed text and the log gets the rest
    const failing = createMcpHttpHandler(TOKEN, {}, async () => { throw new Error('<img src=x onerror=alert(1)> at /Users/me/secret.ts:1'); });
    const server = createServer((req, res) => void failing(req, res));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const logged: string[] = [];
    const error = console.error;
    console.error = (line: string) => void logged.push(line);
    try {
      const res = await post(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, {
        jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'telegram_read', arguments: { args: ['whoami'] } },
      });
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(await res.json()).toEqual({ jsonrpc: '2.0', id: 7, error: { code: -32603, message: 'Internal error' } });
      expect(logged.join('\n')).toContain('onerror=alert(1)');
    } finally {
      console.error = error;
      server.close();
    }
  });

  it('--read-only hides telegram_write and refuses it', async () => {
    const list = await (await post(readOnly.url, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['telegram_help', 'telegram_read']);
    const before = calls.length;
    const write = await (await post(readOnly.url, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'telegram_write', arguments: { args: ['send', 'me', 'x'] } } })).json();
    expect(write.result.isError).toBe(true);
    expect(write.result.content[0].text).toMatch(/read-only/);
    expect(calls.length).toBe(before);
  });
});
