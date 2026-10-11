// Packs dist/telegram.mjs as a Claude Desktop extension (MCP Bundle, https://github.com/modelcontextprotocol/mcpb):
//   node scripts/mcpb.mjs [outfile]   (default release/better-tg-cli.mcpb; run `npm run build` first)
// Claude Desktop runs it on its built-in Node, so users need no Node, npm or brew.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const out = resolve(process.argv[2] ?? join(root, 'release', 'better-tg-cli.mcpb'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const repo = 'https://github.com/TheVilfer/better-tg-cli';

const manifest = {
  manifest_version: '0.3',
  name: 'better-tg-cli',
  display_name: 'Telegram (Better-TG-CLI)',
  version: pkg.version,
  description: 'Read, search and send Telegram messages on your own account. Read-only until you allow writes.',
  long_description:
    'Telegram on your own account (MTProto, not a bot), through the `telegram` CLI.\n\n' +
    '**Log in first** in a terminal: `npx better-tg-cli auth --qr`. The session is kept in the macOS Keychain ' +
    'or the Linux Secret Service, and this extension reuses it.\n\n' +
    'Writes stay off until you run `telegram write-access on --for 1h` and confirm it yourself. ' +
    'Message text is written by other people: keep the approval prompt on for `telegram_write`.',
  author: { name: 'Sergei Polin', url: 'https://github.com/TheVilfer' },
  repository: { type: 'git', url: `${repo}.git` },
  homepage: repo,
  documentation: `${repo}#mcp-server`,
  support: `${repo}/issues`,
  icon: 'icon.png',
  server: {
    type: 'node',
    entry_point: 'server/telegram.mjs',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/telegram.mjs', 'mcp'],
      env: { TG_PROFILE: '${user_config.profile}' },
    },
  },
  tools: [
    { name: 'telegram_help', description: 'Searchable reference of CLI commands and flags' },
    { name: 'telegram_read', description: 'Read-only commands: inbox, chats, read, search, info and more' },
    { name: 'telegram_write', description: 'Send, edit, react, manage chats; needs write access from you' },
  ],
  keywords: ['telegram', 'mtproto', 'messages', 'chat', 'cli'],
  license: 'MIT',
  privacy_policies: [`${repo}/blob/main/PRIVACY.md`],
  compatibility: { platforms: ['darwin', 'linux', 'win32'], runtimes: { node: '>=20.0.0' } },
  user_config: {
    profile: {
      type: 'string',
      title: 'Profile (optional)',
      description: 'TG_PROFILE for a separate session, e.g. "work". Leave empty to use your main login.',
      required: false,
      default: '',
    },
  },
};

const stage = mkdtempSync(join(tmpdir(), 'tg-mcpb-'));
try {
  mkdirSync(join(stage, 'server'));
  copyFileSync(join(root, 'dist', 'telegram.mjs'), join(stage, 'server', 'telegram.mjs'));
  copyFileSync(join(root, 'assets', 'icon-512.png'), join(stage, 'icon.png'));
  copyFileSync(join(root, 'LICENSE'), join(stage, 'LICENSE'));
  writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { force: true });
  execFileSync('zip', ['-qrX', out, '.'], { cwd: stage, stdio: 'inherit' });
  console.log(out);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
