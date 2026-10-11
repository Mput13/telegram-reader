import { Command } from 'commander';
import { getClient, getMe, disconnectClient } from '../client.js';
import { isConfigured, loadConfig } from '../config.js';
import { configDir, isMock, profile } from '../paths.js';
import { mockStatePath } from '../mock/world.js';
import { isSecretStoreAvailable } from '../secrets.js';
import { isOnePasswordAvailable } from '../onepassword.js';
import { isKeychainAvailable } from '../keychain.js';
import { isLibsecretAvailable } from '../libsecret.js';
import chalk from '../colors.js';
import ora from '../spinner.js';

function getSecretBackendLabel(): string {
  if (isOnePasswordAvailable()) return '1Password';
  if (isKeychainAvailable()) return 'macOS Keychain';
  if (isLibsecretAvailable()) return 'Secret Service (libsecret)';
  return 'config file (plaintext)';
}

export const checkCommand = new Command('check')
  .description('Verify session and credentials')
  .action(async () => {
    if (isMock()) {
      const me = await getMe(await getClient());
      console.log(chalk.green('Mock mode: no Telegram session is used'));
      console.log(`Logged in as: ${me.firstName || ''} ${me.lastName || ''} (@${me.username || 'no username'})`);
      console.log(`State file: ${mockStatePath()} (delete it to start over)`);
      await disconnectClient();
      return;
    }
    if (!isConfigured()) {
      const p = profile();
      console.log(chalk.red(p
        ? `Profile "${p}" is not configured. Run: TG_PROFILE=${p} telegram auth [--test-dc]`
        : 'Not configured. Run "telegram onboard" or "telegram auth --qr" first.'));
      process.exit(1);
    }

    const spinner = ora('Checking session...').start();

    try {
      const client = await getClient();
      const me = await getMe(client);

      spinner.succeed(chalk.green('Session valid'));
      console.log(`Logged in as: ${me.firstName || ''} ${me.lastName || ''} (@${me.username || 'no username'})`);
      console.log(`Secret storage: ${getSecretBackendLabel()}`);
      if (profile()) console.log(`Profile: ${profile()} (${configDir()})`);
      if (loadConfig(() => {}).testServers) console.log('Servers: TEST (not production)');

      await disconnectClient();
    } catch (error) {
      spinner.fail(chalk.red('Session invalid or expired'));
      console.error(error instanceof Error ? error.message : error);
      console.log('\nRun "telegram auth" to re-authenticate.');
      process.exit(1);
    }
  });
