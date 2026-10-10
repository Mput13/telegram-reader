import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { platform } from 'node:os';
import { encodedCommand } from './dpapi.js';
import { prompt } from './prompt.js';
import chalk from './colors.js';

/**
 * Some decisions must be a human's, not something an agent can make on its own: a y/N prompt on a
 * real terminal, or a macOS / Windows dialog the user has to click. Both give up as "no".
 */
export async function confirmByHuman(what: string): Promise<boolean> {
  const os = platform();
  const hasTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (hasTty) {
    const answer = await prompt(`${what} [y/N] `);
    return /^(y|yes|д|да)$/i.test(answer);
  }
  if (os === 'win32') return confirmOnWindows(what);
  if (os !== 'darwin') {
    console.error(chalk.red('No terminal to confirm on. Run this command yourself in a terminal.'));
    return false;
  }
  const text = `${what}\n\nЕсли об этом просит агент, а вы не ожидали — нажмите «Отмена».`;
  const script =
    `display dialog ${JSON.stringify(text)} with title "Telegram CLI" ` +
    'buttons {"Отмена", "Разрешить"} default button "Отмена" cancel button "Отмена" ' +
    'with icon caution giving up after 120';
  const out = await run('/usr/bin/osascript', ['-e', script], 125_000);
  return out !== null && out.includes('button returned:Разрешить') && !out.includes('gave up:true');
}

/**
 * The Windows counterpart of the macOS dialog: a topmost Yes/No box with "No" as the default.
 * MessageBox has no timeout of its own, so the spawn gives up after ~2 minutes and that counts as No.
 */
export function windowsConfirmScript(text: string): string {
  const quoted = "'" + text.replace(/'/g, "''") + "'";
  return 'Add-Type -AssemblyName System.Windows.Forms;' +
    // A hidden topmost owner keeps the box above the agent's window instead of behind it
    '$owner = New-Object System.Windows.Forms.Form; $owner.TopMost = $true; $owner.ShowInTaskbar = $false;' +
    `$r = [System.Windows.Forms.MessageBox]::Show($owner, ${quoted}, 'Telegram CLI', 'YesNo', 'Warning', 'Button2');` +
    "if ($r -eq 'Yes') { [Console]::Out.Write('ALLOW') } else { [Console]::Out.Write('DENY') }";
}

async function confirmOnWindows(what: string): Promise<boolean> {
  const text = `${what}\n\nЕсли об этом просит агент, а вы не ожидали — нажмите «Нет».`;
  const ps = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const out = await run(ps, ['-NoProfile', '-NonInteractive', '-NoLogo', '-STA', '-EncodedCommand', encodedCommand(windowsConfirmScript(text))], 125_000);
  return out?.trim() === 'ALLOW';
}

/** stdout of a finished process, or null on a non-zero exit, a timeout or a spawn error (Cancel). */
function run(file: string, args: string[], timeout: number): Promise<string | null> {
  return new Promise(resolve => {
    execFile(file, args, { encoding: 'utf8', timeout, windowsHide: true }, (error, stdout) => resolve(error ? null : stdout));
  });
}
