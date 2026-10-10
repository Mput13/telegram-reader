#!/usr/bin/env node

import './env.js';
import { isMainThread } from 'node:worker_threads';
import { VERSION } from './version.js';
import { Command } from 'commander';
import { profile } from './paths.js';
import { startMcpServer } from './mcp.js';
import { mcpToken, startMcpHttpServer } from './mcp-http.js';
import { BACKGROUND_CHECK_COMMAND, maybeNotifyUpdate, runBackgroundCheck } from './update.js';
import {
  authCommand,
  logoutCommand,
  whoamiCommand,
  checkCommand,
  chatsCommand,
  readCommand,
  getCommand,
  infoCommand,
  topicsCommand,
  linkCommand,
  contactsCommand,
  searchCommand,
  sendCommand,
  replyCommand,
  inboxCommand,
  contactCommand,
  membersCommand,
  adminsCommand,
  groupsCommand,
  syncCommand,
  kickCommand,
  promoteCommand,
  transferOwnerCommand,
  muteCommand,
  unmuteCommand,
  foldersCommand,
  folderCommand,
  folderAddCommand,
  folderRemoveCommand,
  writeAccessCommand,
  downloadCommand,
  sendFileCommand,
  buttonsCommand,
  clickCommand,
  reactCommand,
  forwardCommand,
  pinCommand,
  unpinCommand,
  editCommand,
  deleteCommand,
  markReadCommand,
  pinnedCommand,
  pollCommand,
  voteCommand,
  reactionsCommand,
  blockCommand,
  unblockCommand,
  addContactCommand,
  delContactCommand,
  joinCommand,
  leaveCommand,
  inviteLinkCommand,
  archiveCommand,
  unarchiveCommand,
  createGroupCommand,
  createChannelCommand,
  typingCommand,
  setNameCommand,
  setBioCommand,
  setUsernameCommand,
  setAvatarCommand,
  avatarCommand,
  inlineCommand,
  storiesCommand,
  watchCommand,
  updateCommand,
  skillCommand,
  onboardCommand,
} from './commands/index.js';


const program = new Command();

program
  .name('tg')
  .description('Fast Telegram CLI for reading, searching, and sending messages')
  .version(VERSION);

// Auth commands
program.addCommand(authCommand);
program.addCommand(onboardCommand);
program.addCommand(logoutCommand);
program.addCommand(checkCommand);
program.addCommand(whoamiCommand);

// Read commands
program.addCommand(chatsCommand);
program.addCommand(readCommand);
program.addCommand(getCommand);
program.addCommand(infoCommand);
program.addCommand(topicsCommand);
program.addCommand(linkCommand);
program.addCommand(contactsCommand);
program.addCommand(searchCommand);
program.addCommand(inboxCommand);
program.addCommand(buttonsCommand);
program.addCommand(pinnedCommand);
program.addCommand(reactionsCommand);
program.addCommand(storiesCommand);
program.addCommand(avatarCommand);
program.addCommand(inlineCommand);
program.addCommand(watchCommand);

// Contact/group commands
program.addCommand(contactCommand);
program.addCommand(membersCommand);
program.addCommand(adminsCommand);
program.addCommand(groupsCommand);
program.addCommand(kickCommand);
program.addCommand(promoteCommand);
program.addCommand(transferOwnerCommand);
program.addCommand(muteCommand);
program.addCommand(unmuteCommand);

// Folder commands
program.addCommand(foldersCommand);
program.addCommand(folderCommand);
program.addCommand(folderAddCommand);
program.addCommand(folderRemoveCommand);

// Write commands
program.addCommand(sendCommand);
program.addCommand(replyCommand);
program.addCommand(sendFileCommand);
program.addCommand(clickCommand);
program.addCommand(reactCommand);
program.addCommand(forwardCommand);
program.addCommand(pinCommand);
program.addCommand(unpinCommand);
program.addCommand(editCommand);
program.addCommand(deleteCommand);
program.addCommand(markReadCommand);
program.addCommand(pollCommand);
program.addCommand(voteCommand);
program.addCommand(blockCommand);
program.addCommand(unblockCommand);
program.addCommand(addContactCommand);
program.addCommand(delContactCommand);
program.addCommand(joinCommand);
program.addCommand(leaveCommand);
program.addCommand(inviteLinkCommand);
program.addCommand(archiveCommand);
program.addCommand(unarchiveCommand);
program.addCommand(createGroupCommand);
program.addCommand(createChannelCommand);
program.addCommand(typingCommand);
program.addCommand(setNameCommand);
program.addCommand(setBioCommand);
program.addCommand(setUsernameCommand);
program.addCommand(setAvatarCommand);

// Configuration
program.addCommand(writeAccessCommand);

// Utilities
program.addCommand(syncCommand);
program.addCommand(downloadCommand);
program.addCommand(updateCommand);
program.addCommand(skillCommand);
program
  .command('mcp')
  .description('Run as an MCP server over stdio, or over HTTP with --http (tools: telegram_help, telegram_read, telegram_write)')
  .option('--http', 'Serve MCP over HTTP (POST /mcp, bearer token) for remote hosts such as Grok Bot')
  .option('--host <host>', 'With --http: address to listen on', '127.0.0.1')
  .option('--port <port>', 'With --http: port to listen on', '8787')
  .option('--read-only', 'Serve only telegram_help and telegram_read, never telegram_write')
  .option('--token', 'Print the HTTP bearer token (created on first use, kept in the secret store)')
  .option('--rotate-token', 'Replace the HTTP bearer token; clients using the old one stop working')
  .action((options: { http?: boolean; host: string; port: string; readOnly?: boolean; token?: boolean; rotateToken?: boolean }) => {
    const commands = program.commands.map(c => c.name());
    if (options.token || options.rotateToken) {
      const token = mcpToken({ create: true, rotate: options.rotateToken });
      if (!token) {
        console.error('No secret store for the token (macOS Keychain, Linux Secret Service, Windows DPAPI or 1Password).');
        process.exit(1);
      }
      console.log(token);
      return;
    }
    if (options.http) {
      const port = Number(options.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        console.error(`Invalid --port "${options.port}"`);
        process.exit(2);
      }
      startMcpHttpServer(commands, { host: options.host, port, readOnly: options.readOnly });
      return;
    }
    startMcpServer(commands, { readOnly: options.readOnly });
  });

// Dense reference of every command and flag, generated from the definitions
// above so it can never drift from the code. Cheaper for agents than N --help calls.
program
  .command('help-all')
  .description('Print every command with its arguments and flags (compact reference)')
  .option('-g, --grep <text>', 'Only commands whose name, description or flags mention this text')
  .action((options) => {
    const needle = options.grep?.toLowerCase();
    const lines: string[] = [];
    const emit = (cmd: Command, name: string): void => {
      // A group (e.g. `skill`) is listed through its subcommands
      if (cmd.commands.length) {
        for (const sub of cmd.commands) emit(sub, `${name} ${sub.name()}`);
        return;
      }
      const desc = cmd.description();
      const haystack = [name, desc, ...cmd.options.map(o => `${o.flags} ${o.description}`)].join(' ').toLowerCase();
      if (needle && !haystack.includes(needle)) return;
      const args = cmd.registeredArguments.map(a => (a.required ? `<${a.name()}${a.variadic ? '...' : ''}>` : `[${a.name()}${a.variadic ? '...' : ''}]`)).join(' ');
      lines.push(`${name}${args ? ' ' + args : ''} — ${desc}`);
      for (const opt of cmd.options) {
        if (opt.long === '--json' || opt.long === '--markdown') continue;
        const def = opt.defaultValue !== undefined && typeof opt.defaultValue !== 'boolean' ? ` (default ${opt.defaultValue})` : '';
        lines.push(`  ${opt.flags} — ${opt.description}${def}`);
      }
    };
    for (const cmd of program.commands) {
      if (cmd.name() !== 'help-all') emit(cmd, cmd.name());
    }
    lines.push('', 'Most read commands accept --json; --markdown where noted in `<cmd> --help`.');
    console.log(lines.join('\n'));
  });

try {
  profile();
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}

if (process.argv[2] === BACKGROUND_CHECK_COMMAND) {
  void runBackgroundCheck();
} else {
  maybeNotifyUpdate();
  // Always node-style argv: commander would read it Electron-style inside Claude Desktop's
  // built-in Node (an Electron utility process) and take the script path for a command
  if (isMainThread) {
    program.parse(process.argv, { from: 'node' });
  } else {
    // An MCP call in a worker thread (src/mcp.ts): its piped stdin keeps the thread alive,
    // so end it once the command is done, as a child process would exit on its own
    program.parseAsync(process.argv, { from: 'node' }).then(
      () => process.exit(process.exitCode ?? 0),
      (error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      },
    );
  }
}
