import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BROKER_URL, fetchInviteCredentials } from '../src/broker.js';
import { authCommand } from '../src/commands/auth.js';

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('invite login client', () => {
  it('POSTs the invite in the body (never the URL) and returns credentials', async () => {
    const f = reply(200, { apiId: 7, apiHash: 'h' });
    expect(await fetchInviteCredentials('  tgi_abc  ', 'https://b.test/', f)).toEqual({ apiId: 7, apiHash: 'h' });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://b.test/v1/credentials');
    expect(url).not.toContain('tgi_abc');
    expect(JSON.parse(init.body)).toEqual({ invite: 'tgi_abc' });
  });

  it('uses the built-in broker by default', async () => {
    const f = reply(200, { apiId: 7, apiHash: 'h' });
    await fetchInviteCredentials('tgi_abc', undefined, f);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(`${DEFAULT_BROKER_URL}/v1/credentials`);
  });

  it('turns broker errors into readable messages', async () => {
    await expect(fetchInviteCredentials('x', 'https://b.test', reply(403, { error: 'invite_revoked' }))).rejects.toThrow(/revoked/);
    await expect(fetchInviteCredentials('x', 'https://b.test', reply(429, { error: 'invite_used_up' }))).rejects.toThrow(/maximum/);
    await expect(fetchInviteCredentials('x', 'https://b.test', reply(500, 'oops'))).rejects.toThrow(/HTTP 500/);
  });

  it('reports network failures with the broker URL', async () => {
    const f = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(fetchInviteCredentials('x', 'https://b.test', f)).rejects.toThrow(/b\.test.*ECONNREFUSED/);
  });
});

describe('telegram auth --login-key', () => {
  it('shows --login-key in help and keeps --invite, its name until 0.36, as a hidden synonym', () => {
    const option = (flag: string) => authCommand.options.find(o => o.long === flag);
    expect(option('--login-key')?.hidden).toBe(false);
    expect(option('--invite')?.hidden).toBe(true);
    expect(authCommand.helpInformation()).toContain('--login-key [key]');
    expect(authCommand.helpInformation()).not.toContain('--invite');
  });
});
