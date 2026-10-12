/**
 * Credential broker (Cloudflare Worker in ./broker). Open-source users bring their own
 * api_id/api_hash; people with a login key get the maintainer's app keys here. The wire format
 * still says "invite" (the key's name until 0.36), so released versions keep working.
 */
export const DEFAULT_BROKER_URL = 'https://tg-cli-broker.login-c2d.workers.dev';

const ERRORS: Record<string, string> = {
  invalid_invite: 'This login key is not valid. Check that you pasted the whole key.',
  invite_revoked: 'This login key was revoked. Get a new one on better-tg-cli.com.',
  invite_used_up: 'This login key has been used the maximum number of times. Get a new one on better-tg-cli.com.',
  rate_limited: 'Too many attempts from your network. Wait a minute and try again.',
  broker_not_configured: 'The login service is not configured yet. Try again later.',
};

export async function fetchInviteCredentials(
  invite: string,
  brokerUrl = process.env.TG_BROKER_URL || DEFAULT_BROKER_URL,
  fetchImpl: typeof fetch = fetch
): Promise<{ apiId: number; apiHash: string }> {
  let res: Response;
  try {
    res = await fetchImpl(`${brokerUrl.replace(/\/$/, '')}/v1/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invite: invite.trim() }),
    });
  } catch (error) {
    throw new Error(`Could not reach the login service (${brokerUrl}): ${error instanceof Error ? error.message : error}`);
  }

  const body = (await res.json().catch(() => ({}))) as { apiId?: number; apiHash?: string; error?: string };
  if (!res.ok) {
    throw new Error(ERRORS[body.error ?? ''] ?? `Login service error (HTTP ${res.status}).`);
  }
  if (!body.apiId || !body.apiHash) throw new Error('The login service returned an unexpected response.');
  return { apiId: body.apiId, apiHash: body.apiHash };
}
