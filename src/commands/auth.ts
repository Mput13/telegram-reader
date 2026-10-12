import { Command, Option } from 'commander';
import { authenticate } from '../auth.js';
import { fetchInviteCredentials } from '../broker.js';
import { getSessionString, isConfigured, saveConfig } from '../config.js';
import { promptHidden } from '../prompt.js';
import { readTextArg } from '../text.js';

/** Login key from --login-key <key|->, TG_LOGIN_KEY, or a hidden prompt (keeps it out of argv). */
async function resolveLoginKey(value: string | true): Promise<string> {
  if (typeof value === 'string') return readTextArg(value).trim();
  // TG_INVITE: the variable's name until 0.36
  const fromEnv = process.env.TG_LOGIN_KEY || process.env.TG_INVITE;
  if (fromEnv) return fromEnv.trim();
  return (await promptHidden('Paste your login key: ')).trim();
}

export const authCommand = new Command('auth')
  .description('Log in with your own api_id/api_hash, or with a login key from better-tg-cli.com (--login-key)')
  .option('--login-key [key]', 'Log in with a login key instead of your own API keys (omit the key to be prompted; "-" reads stdin)')
  // The flag's name until 0.36: scripts and older guides still pass it
  .addOption(new Option('--invite [key]').hideHelp())
  .option('--broker <url>', 'Login service URL (default: built-in, or TG_BROKER_URL)')
  .option('--op-vault <vault>', 'Set 1Password vault for secret storage')
  .option('--qr', 'Log in by scanning a QR code in the Telegram app instead of an SMS/app code')
  .option('--test-dc', "Log in on Telegram's test servers (for development; use with TG_PROFILE)")
  .action(async (opts: { loginKey?: string | true; invite?: string | true; broker?: string; opVault?: string; testDc?: boolean; qr?: boolean }) => {
    // Save op vault config if provided (before auth, so secrets route there)
    if (opts.opVault) {
      saveConfig({ opVault: opts.opVault });
      console.log(`1Password vault set to: ${opts.opVault}`);
    }

    // Never overwrite a working login; after `telegram logout` there is no session and auth proceeds
    if (isConfigured() && getSessionString()) {
      console.log('Already logged in. Run "telegram check" to verify your session.');
      console.log('To log in as someone else, run "telegram logout" first.');
      return;
    }

    try {
      let invite: { apiId: number; apiHash: string } | undefined;
      const keyOpt = opts.loginKey ?? opts.invite;
      if (keyOpt) {
        const key = await resolveLoginKey(keyOpt);
        if (!key) throw new Error('No login key given');
        invite = await fetchInviteCredentials(key, opts.broker);
        console.log('Login key accepted.');
      }
      const client = await authenticate(invite, !!opts.testDc, !!opts.qr);
      await client.disconnect();
    } catch (error) {
      console.error('Authentication failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
