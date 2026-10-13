import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from 'teleproto';
import bigInt from 'big-integer';
import { folderPeers, handleScopedMessage, type ScopedDriver } from '../src/scoped-mcp.js';
import { createProposal, consumeApproval } from '../src/send-approval.js';
import { configDir } from '../src/paths.js';
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createMcpHttpHandler } from '../src/mcp-http.js';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const profile = `mock-reader-security-${process.pid}`;
process.env.TG_PROFILE = profile;
const folders = () => ['Lambda', 'NCSED', 'МАИ'].map(title => ({ title, includePeers: [new Api.InputPeerUser({ userId: bigInt(12), accessHash: bigInt(1) })], excludePeers: [] }));
const driver: ScopedDriver = {
  list: vi.fn(async () => [{ id: '12', title: 'Allowed' }]),
  read: vi.fn(async () => ['message']), search: vi.fn(async () => []), send: vi.fn(async () => ({ message_id: 1 })),
};
const call = (name: string, args: object = {}, readonly = false) => handleScopedMessage({ id: 1, method: 'tools/call', params: { name, arguments: args } }, { readOnly: readonly }, driver) as Promise<any>;
afterEach(() => { vi.clearAllMocks(); rmSync(join(configDir(), 'send-approvals'), { recursive: true, force: true }); });

describe('selected folders', () => {
  it('uses exact marked IDs, respects exclusions and pinned peers', () => {
    const f: any[] = folders();
    f[0].pinnedPeers = [new Api.InputPeerChannel({ channelId: bigInt(12), accessHash: bigInt(1) })];
    f[0].excludePeers = f[0].includePeers;
    expect([...folderPeers(f)].sort()).toEqual(['-10012', '12']);
    f[1].excludePeers = f[1].includePeers; f[2].excludePeers = f[2].includePeers;
    expect([...folderPeers(f)]).toEqual(['-10012']);
  });
  it('fails closed on missing, duplicate and automatic folders', () => {
    expect(() => folderPeers([])).toThrow(/missing/);
    expect(() => folderPeers([...folders(), folders()[0]])).toThrow(/ambiguous/);
    const f: any[] = folders(); f[0].groups = true;
    expect(() => folderPeers(f)).toThrow(/automatic/);
  });
  it('recomputes membership rather than caching a removed chat', () => {
    const f: any[] = folders(); expect(folderPeers(f).has('12')).toBe(true);
    for (const x of f) x.includePeers = [];
    expect(folderPeers(f).has('12')).toBe(false);
  });
});

describe('MCP boundary', () => {
  it('rejects outside peers, usernames and numeric peer-type collisions', async () => {
    for (const chat_id of ['13', '-12', '-10012', '@user', 'me']) {
      expect((await call('telegram_read', { chat_id })).result.isError).toBe(true);
    }
    expect(driver.read).not.toHaveBeenCalled();
  });
  it('rejects global search, arbitrary CLI, inline and injected extra flags', async () => {
    for (const [name, args] of [
      ['telegram_search', { query: 'private' }],
      ['telegram_write', { args: ['send', '12', 'x'] }],
      ['telegram_read', { args: ['inline', '@bot', 'private'] }],
      ['telegram_read', { chat_id: '12', thread: 13 }],
      ['telegram_search', { chat_id: '12', query: 'x', all: true }],
    ] as [string, object][]) expect((await call(name, args)).result.isError).toBe(true);
    expect(driver.read).not.toHaveBeenCalled(); expect(driver.search).not.toHaveBeenCalled();
  });
  it('reads and searches within one permitted peer with bounded output', async () => {
    expect((await call('telegram_read', { chat_id: '12', limit: 3 })).result.isError).toBeUndefined();
    expect(driver.read).toHaveBeenCalledWith('12', 3);
    await call('telegram_search', { chat_id: '12', query: 'x' });
    expect(driver.search).toHaveBeenCalledWith('12', 'x', 50);
    expect((await call('telegram_read', { chat_id: '12', limit: 101 })).result.isError).toBe(true);
  });
  it('preparation sends nothing; read-only rejects preparation and sending', async () => {
    const result = await call('telegram_prepare_send', { chat_id: '12', text: 'Exact text' });
    const p = JSON.parse(result.result.content[0].text);
    expect(p.text).toBe('Exact text'); expect(driver.send).not.toHaveBeenCalled();
    expect((await call('telegram_send_approved', { request_id: p.request_id })).result.isError).toBe(true);
    expect((await call('telegram_prepare_send', { chat_id: '12', text: 'x' }, true)).result.isError).toBe(true);
  });
  it('rejects replay, expiry, alteration and path traversal; consumes approval before an uncertain send', async () => {
    const p = createProposal({ chat_id: '12', title: 'Allowed', text: 'Approved text' });
    const file = (state: string) => join(configDir(), 'send-approvals', `${p.request_id}.${state}.json`);
    renameSync(file('pending'), file('approved')); // simulate local human approval
    const result = await call('telegram_send_approved', { request_id: p.request_id });
    expect(result.result.isError).toBeUndefined(); expect(driver.send).toHaveBeenCalledWith('12', 'Approved text', undefined);
    expect((await call('telegram_send_approved', { request_id: p.request_id })).result.isError).toBe(true);
    expect(() => consumeApproval('../escape')).toThrow();
    const q = createProposal({ chat_id: '12', title: 'Allowed', text: 'x' });
    const pending = join(configDir(), 'send-approvals', `${q.request_id}.pending.json`);
    const changed = JSON.parse(readFileSync(pending, 'utf8')); changed.proposal.text = 'changed';
    writeFileSync(pending, JSON.stringify(changed), { mode: 0o600 });
    renameSync(pending, pending.replace('.pending.', '.approved.'));
    expect(() => consumeApproval(q.request_id)).toThrow(/changed/);
    const r = createProposal({ chat_id: '12', title: 'Allowed', text: 'expired' });
    const rf = join(configDir(), 'send-approvals', `${r.request_id}.pending.json`);
    const expired = JSON.parse(readFileSync(rf, 'utf8')); expired.expires = 0;
    writeFileSync(rf, JSON.stringify(expired), { mode: 0o600 }); renameSync(rf, rf.replace('.pending.', '.approved.'));
    expect(() => consumeApproval(r.request_id)).toThrow(/expired/);
    const s = createProposal({ chat_id: '12', title: 'Allowed', text: 'timeout' });
    const sf = join(configDir(), 'send-approvals', `${s.request_id}.pending.json`); renameSync(sf, sf.replace('.pending.', '.approved.'));
    vi.mocked(driver.send).mockRejectedValueOnce(new Error('timeout'));
    expect((await call('telegram_send_approved', { request_id: s.request_id })).result.content[0].text).toMatch(/inspect Telegram/);
    expect(() => consumeApproval(s.request_id)).toThrow(/No unused/);
  });
  it('production HTTP exposes scoped tools and rejects the legacy argv interface', async () => {
    const handler = createMcpHttpHandler('secret', { readOnly: true });
    const server = createServer((req, res) => void handler(req, res));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
      const post = async (method: string, params = {}) => (await fetch(url, { method: 'POST', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }, body: JSON.stringify({ id: 1, method, params }) })).json() as Promise<any>;
      expect((await post('tools/list')).result.tools.map((t: any) => t.name)).toEqual(['telegram_list_chats', 'telegram_read', 'telegram_search']);
      expect((await post('tools/call', { name: 'telegram_read', arguments: { args: ['inline', '@bot', 'secret'] } })).result.isError).toBe(true);
    } finally { server.closeAllConnections(); server.close(); }
  });
});
