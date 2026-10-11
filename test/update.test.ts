import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions, detectInstall, updateCommandFor } from '../src/update.js';

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.17.0', '0.17.0')).toBe(0);
    expect(compareVersions('0.17.0', '1.0.0')).toBe(-1);
  });

  it('puts a release candidate before its release and orders candidates by number', () => {
    expect(compareVersions('0.35.0-rc.1', '0.35.0')).toBe(-1);
    expect(compareVersions('0.35.0', '0.35.0-rc.2')).toBe(1);
    expect(compareVersions('0.35.0-rc.10', '0.35.0-rc.9')).toBe(1);
    expect(compareVersions('0.35.0-rc.1', '0.35.0-rc.1')).toBe(0);
    // Someone on a candidate is not told to "update" to the older stable version
    expect(compareVersions('0.34.0', '0.35.0-rc.1')).toBe(-1);
  });
});

describe('detectInstall', () => {
  it('standalone binary under the Homebrew Cellar → brew', () => {
    expect(detectInstall('/opt/homebrew/Cellar/better-tg-cli/0.17.0/bin/telegram', '', true)).toEqual({ kind: 'brew' });
    expect(detectInstall('/home/linuxbrew/.linuxbrew/Cellar/better-tg-cli/0.17.0/bin/telegram', '', true).kind).toBe('brew');
  });

  it('standalone binary elsewhere → manual download', () => {
    expect(detectInstall('/usr/local/bin/telegram', '', true)).toEqual({ kind: 'binary', path: '/usr/local/bin/telegram' });
    expect(updateCommandFor({ kind: 'binary', path: '/x' })).toMatch(/releases\/latest/);
  });

  it('script inside node_modules → npm', () => {
    expect(detectInstall('/usr/bin/node', '/usr/lib/node_modules/better-tg-cli/dist/telegram.mjs', false)).toEqual({ kind: 'npm' });
  });

  it('script inside a git checkout → source', () => {
    const root = mkdtempSync(join(tmpdir(), 'btg-'));
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'dist'));
    const got = detectInstall('/usr/bin/node', join(root, 'dist', 'telegram.mjs'), false);
    expect(got.kind).toBe('source');
    expect(updateCommandFor(got)).toContain('pull --ff-only');
  });
});

describe('detectInstall on Windows', () => {
  it('knows Scoop and npm paths with backslashes', () => {
    expect(detectInstall('C:\\Users\\a\\scoop\\apps\\better-tg-cli\\current\\telegram.exe', '', true)).toEqual({ kind: 'scoop' });
    expect(updateCommandFor({ kind: 'scoop' })).toBe('scoop update better-tg-cli');
    expect(detectInstall('C:\\Program Files\\nodejs\\node.exe',
      'C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\better-tg-cli\\dist\\telegram.mjs', false)).toEqual({ kind: 'npm' });
    expect(detectInstall('C:\\tools\\telegram.exe', '', true)).toEqual({ kind: 'binary', path: 'C:\\tools\\telegram.exe' });
  });
});

describe('isCompiledBinary', () => {
  it('only the embedded /$bunfs path counts, not `bun src/index.ts`', async () => {
    const { isCompiledBinary } = await import('../src/update.js');
    const had = process.versions.bun;
    Object.defineProperty(process.versions, 'bun', { value: '1.3.0', configurable: true });
    try {
      expect(isCompiledBinary('/$bunfs/root/telegram')).toBe(true);
      expect(isCompiledBinary('/Users/x/better-tg-cli/src/index.ts')).toBe(false);
    } finally {
      if (had === undefined) delete (process.versions as Record<string, string>).bun;
    }
  });
});
