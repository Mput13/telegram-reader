import { secretGet, isSecretStoreAvailable } from './secrets.js';
import { parseWriteState } from './write-state.js';
import chalk from './colors.js';
import { setStrictChatResolution } from './resolve-mode.js';
import { isMock } from './paths.js';

export function assertWriteEnabled(): void {
  // Set by the MCP read tool: a hard stop even if a write command was misclassified as a read
  if (process.env.TG_READ_ONLY) {
    console.error(chalk.red('This command changes something; it cannot run as a read (use telegram_write).'));
    process.exit(1);
  }
  // A mock write only changes a local file: getClient() hands out the mock under the same check,
  // so there is nothing for a human to approve. Strict chat matching stays, as for real writes.
  if (isMock()) {
    setStrictChatResolution(true);
    return;
  }
  if (!isSecretStoreAvailable()) {
    console.error(chalk.red('Write access requires a secret store (macOS Keychain, Linux Secret Service, Windows DPAPI or 1Password).'));
    console.error(chalk.gray('This ensures write permissions cannot be tampered with via config files.'));
    process.exit(1);
  }

  const state = parseWriteState(secretGet('writeEnabled'));
  if (!state.enabled) {
    const why = state.expired ? `expired at ${state.until!.toLocaleString()}` : 'read-only mode';
    console.error(chalk.red(`Write access is disabled (${why}).`));
    console.error(chalk.gray('Ask the user to run: telegram write-access on [--for 1h] (needs their confirmation)'));
    process.exit(1);
  }
  setStrictChatResolution(true);
}
