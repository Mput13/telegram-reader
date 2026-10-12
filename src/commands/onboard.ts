import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { qrLoginDriver, saveLogin } from '../auth.js';
import { fetchInviteCredentials } from '../broker.js';
import { getSessionString, isConfigured } from '../config.js';
import { ONBOARD_SITE, startOnboarding, type OnboardEvent } from '../onboard.js';

const HUMAN: Record<OnboardEvent['event'], (e: never) => string> = {
  url: (e: { url: string }) => `Open this page to log in (it stays on this computer): ${e.url}`,
  waiting_invite: () => 'Waiting for a login key or API keys on the page…',
  waiting_scan: () => 'Waiting for the QR scan (Telegram → Settings → Devices → Link Desktop Device)…',
  need_password: () => 'Waiting for the two-step verification password on the page…',
  done: (e: { user: { name: string; username?: string } }) =>
    `Logged in as ${e.user.name}${e.user.username ? ` (@${e.user.username})` : ''}. Session saved.`,
  error: (e: { message: string }) => `Login failed: ${e.message}. The page offers a retry.`,
};

function openBrowser(url: string): void {
  const [cmd, ...args] = process.platform === 'darwin' ? ['open', url]
    // explorer.exe mangles URLs with query strings; the URL protocol handler opens the default browser
    : process.platform === 'win32' ? ['rundll32', 'url.dll,FileProtocolHandler', url]
    : ['xdg-open', url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref();
  } catch { /* the URL is printed anyway */ }
}

export const onboardCommand = new Command('onboard')
  .description('Guided login for agents: opens a local page where you get a login key (or use your own keys), scan a QR code and enter your 2FA password; the agent never sees any of it')
  .option('--json', 'Print progress as JSON lines (events: url, waiting_invite, waiting_scan, need_password, done, error)')
  .option('--no-open', "Don't open the browser, just print the URL")
  .option('--timeout <minutes>', 'Give up after this many minutes', '15')
  .option('--broker <url>', 'Login service URL (default: built-in, or TG_BROKER_URL)')
  .option('--test-dc', "Log in on Telegram's test servers (for development; use with TG_PROFILE)")
  .action(async (opts: { json?: boolean; open: boolean; timeout: string; broker?: string; testDc?: boolean }) => {
    const emit = (e: OnboardEvent) => {
      console.log(opts.json ? JSON.stringify(e) : (HUMAN[e.event] as (x: OnboardEvent) => string)(e));
    };

    // Never replace a working login, same as `telegram auth`
    if (isConfigured() && getSessionString()) {
      console.log(opts.json
        ? JSON.stringify({ event: 'already_logged_in' })
        : 'Already logged in. Check with "telegram whoami"; "telegram logout" first to switch accounts.');
      return;
    }
    const minutes = Number(opts.timeout);
    if (!(minutes > 0)) {
      console.error(`Invalid --timeout "${opts.timeout}"`);
      process.exit(2);
    }
    if (process.env.SSH_CONNECTION) {
      console.error('Note: over SSH the page on 127.0.0.1 is only reachable on this machine. Forward the port ' +
        '(ssh -L <port>:127.0.0.1:<port>) or run "telegram auth --qr" in a terminal here instead.');
    }

    const session = await startOnboarding({
      driver: qrLoginDriver(!!opts.testDc),
      redeemInvite: token => fetchInviteCredentials(token, opts.broker),
      save: (s, creds, invite) => saveLogin(s, creds, invite, !!opts.testDc),
      emit,
      site: process.env.TG_ONBOARD_SITE || ONBOARD_SITE,
    });
    if (opts.open) openBrowser(session.url);

    const timer = setTimeout(() => {
      console.log(opts.json ? JSON.stringify({ event: 'timeout' }) : `Timed out after ${minutes} min; run "telegram onboard" again.`);
      session.close();
      process.exit(1);
    }, minutes * 60_000);
    const onSignal = () => { session.close(); process.exit(130); };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    await session.done;
    clearTimeout(timer);
    // Let the page see "done" on its next poll before the server goes away
    await new Promise(r => setTimeout(r, 2500));
    session.close();
    process.exit(0);
  });
