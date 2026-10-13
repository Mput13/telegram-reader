import { beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { EXCLUDED_COMMANDS, READ_COMMANDS, handleMessage, isWriteCommand, planCall, setKnownCommands, useWorkers } from '../src/mcp.js';

const CLI = 'dist/telegram.mjs';
// Unconfigured profile: nothing here can reach a real account
const env = { ...process.env, TG_PROFILE: 'mcp-test', TG_NO_UPDATE_CHECK: '1' };

function commandNames(): string[] {
  const out = spawnSync(process.execPath, [CLI, 'help-all'], { encoding: 'utf8', env }).stdout;
  return out.split('\n').filter(l => /^[a-z]/.test(l)).map(l => l.split(' ')[0]);
}

beforeAll(() => setKnownCommands(commandNames()));

describe('command classification', () => {
  it('every read or excluded name is a real command (no typos that silently disappear)', () => {
    const names = new Set([...commandNames(), 'help-all']);
    for (const c of [...READ_COMMANDS, ...EXCLUDED_COMMANDS]) expect(names, c).toContain(c);
  });

  it('commands that are obviously writes or local-file writers are not reads', () => {
    for (const c of ['send', 'reply', 'delete', 'forward', 'block', 'archive', 'kick', 'download', 'sync', 'avatar', 'invite-link']) {
      expect(isWriteCommand(c), c).toBe(true);
    }
  });
});

describe('planCall', () => {
  it('routes reads and writes to the right tool only', () => {
    expect(planCall('telegram_read', { args: ['inbox', '-n', '5'] })).toEqual({ argv: ['inbox', '-n', '5'], readOnly: true });
    expect(planCall('telegram_read', { args: ['send', 'me', 'x'] })).toMatch(/use telegram_write/);
    expect(planCall('telegram_write', { args: ['read', 'me'] })).toMatch(/use telegram_read/);
    expect(planCall('telegram_write', { args: ['send', 'me', '-'], stdin: 'hi' })).toEqual({ argv: ['send', 'me', '-'], readOnly: false, stdin: 'hi' });
  });

  it('refuses excluded, unknown, flag-first and unbounded calls', () => {
    expect(planCall('telegram_write', { args: ['auth'] })).toMatch(/not available over MCP/);
    expect(planCall('telegram_write', { args: ['transfer-owner', 'g', 'u'] })).toMatch(/not available/);
    expect(planCall('telegram_read', { args: ['write-access', 'on'] })).toMatch(/Only the user/);
    expect(planCall('telegram_read', { args: ['write-access'] })).toMatchObject({ readOnly: true });
    expect(planCall('telegram_read', { args: ['--help'] })).toMatch(/command name/);
    expect(planCall('telegram_read', { args: ['nope'] })).toMatch(/Unknown command/);
    expect(planCall('telegram_read', { args: ['watch', 'me'] })).toMatch(/-t/);
    expect(planCall('telegram_read', { args: ['watch', 'me', '-t', '30'] })).toMatchObject({ readOnly: true });
    expect(planCall('telegram_read', { args: [] })).toMatch(/non-empty/);
  });
});

describe('protocol', () => {
  it('negotiates the version and ignores notifications', async () => {
    const init = (await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })) as any;
    expect(init.result.protocolVersion).toBe('2025-06-18');
    const newer = (await handleMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } })) as any;
    expect(newer.result.protocolVersion).toBe('2025-11-25');
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined();
    expect(((await handleMessage({ jsonrpc: '2.0', id: 3, method: 'nope' })) as any).error.code).toBe(-32601);
  });

  it('the read tool can never run a guarded write, even if misrouted', () => {
    const r = spawnSync(process.execPath, [CLI, 'send', 'me', 'x'], { encoding: 'utf8', env: { ...env, TG_READ_ONLY: '1' } });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/cannot run as a read/);
  });
});

describe('worker mode', () => {
  it('runs calls in worker threads under Electron (Claude Desktop) or when forced', () => {
    expect(useWorkers({}, undefined)).toBe(false);
    expect(useWorkers({}, '44.4.3')).toBe(true);
    expect(useWorkers({ TG_MCP_WORKER: '1' }, undefined)).toBe(true);
  });
});

// Child processes everywhere else; worker threads inside Claude Desktop (forced here with TG_MCP_WORKER)
describe.each([
  ['child processes', {}],
  ['worker threads', { TG_MCP_WORKER: '1' }],
])('telegram mcp over stdio (%s)', (_mode, extraEnv) => {
  it('serves initialize, tools/list and real tool calls, then exits when stdin closes', async () => {
    const child = spawn(process.execPath, [CLI, 'mcp'], { env: { ...env, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines: any[] = [];
    let buf = '';
    child.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
    });
    const send = (m: object) => child.stdin.write(JSON.stringify(m) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'telegram_help', arguments: { grep: 'thread' } } });
    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'telegram_write', arguments: { args: ['send', 'me', '-'], stdin: 'hi' } } });
    send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'telegram_help', arguments: {} } });
    send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'telegram_read', arguments: { args: ['whoami'] } } });
    child.stdin.end();
    const code = await new Promise(r => child.on('close', r));

    expect(code).toBe(0);
    expect(lines.map(l => l.id)).toEqual([1, 2, 3, 4, 5, 6]); // in order, nothing for the notification
    expect(lines[1].result.tools.map((t: any) => t.name)).toEqual(['telegram_list_chats', 'telegram_read', 'telegram_search', 'telegram_prepare_send', 'telegram_send_approved']);
    // Legacy argv and helper surfaces are deliberately unavailable in the production endpoint.
    for (const result of lines.slice(2)) expect(result.result.isError).toBe(true);
    expect(lines[5].result.content[0].text).toMatch(/Unexpected argument|Missing chat_id/);
  }, 30_000);
});
