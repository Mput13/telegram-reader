#!/usr/bin/env bun
// Build the shipped artifacts with Bun, shrinking teleproto on the way:
//   bun scripts/bundle.mjs node            → dist/telegram.mjs (single file for npm, no deps)
//   bun scripts/bundle.mjs <bun-target> <outfile>   → standalone binary (bun-darwin-arm64, …)
import { compactModuleSource, loadOriginalDefinitions } from './tl-compact.mjs';
import { compactErrorsSource } from './errors-compact.mjs';
import { mimeStubSource } from './mime-stub.mjs';

const stub = contents => () => ({ contents, loader: 'js' });


const shrink = {
  name: 'shrink-teleproto',
  setup(build) {
    // 1.8 MB verbose schema → ~0.3 MB compact encoding decoded at load (identical objects)
    build.onLoad({ filter: /teleproto[\\/]tl[\\/]generated[\\/]api-definitions\.js$/ }, () => ({
      contents: compactModuleSource(loadOriginalDefinitions()),
      loader: 'js',
    }));
    // ~700 generated error classes → a table plus one generator (same classes and messages)
    build.onLoad({ filter: /teleproto[\\/]errors[\\/]RPCErrorList\.js$/ }, async args => ({
      contents: compactErrorsSource(await Bun.file(args.path).text()),
      loader: 'js',
    }));
    // Unused session backend: pulls store2 + node-localstorage (the source of Node's localStorage warning)
    build.onLoad(
      { filter: /teleproto[\\/]sessions[\\/]StoreSession\.js$/ },
      stub(`"use strict";Object.defineProperty(exports,"__esModule",{value:true});
class StoreSession{constructor(){throw new Error("StoreSession is not bundled; use StringSession")}}
exports.StoreSession=StoreSession;`)
    );
    // Proxies are not supported by the CLI: drop socks, ip-address, smart-buffer
    build.onResolve({ filter: /^socks$/ }, () => ({ path: 'socks-stub', namespace: 'stub' }));
    build.onLoad(
      { filter: /^socks-stub$/, namespace: 'stub' },
      stub(`exports.SocksClient={createConnection(){throw new Error("SOCKS proxies are not supported in this build")}};`)
    );
    build.onResolve({ filter: /^mime$/ }, () => ({ path: 'mime-stub', namespace: 'stub' }));
    build.onLoad(
      { filter: /^mime-stub$/, namespace: 'stub' },
      stub(mimeStubSource)
    );
  },
};

const [mode, outfile] = process.argv.slice(2);
if (!mode || (mode !== 'node' && !outfile)) {
  console.error('Usage: bun scripts/bundle.mjs node | <bun-target> <outfile>');
  process.exit(1);
}

// 1. Bundle the CLI (CommonJS, minified, teleproto shrunk) in memory
const result = await Bun.build({
  entrypoints: ['src/index.ts'],
  target: 'node',
  format: 'cjs',
  minify: true,
  plugins: [shrink],
  metafile: !!process.env.BUNDLE_META,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
if (process.env.BUNDLE_META) await Bun.write(process.env.BUNDLE_META, JSON.stringify(result.metafile));
const code = (await result.outputs[0].text()).replace(/^#!.*\n/, '');

// 2. Brotli it (max quality) and wrap it in a tiny loader that inflates and runs it
const { brotliCompressSync, constants } = await import('node:zlib');
const packed = brotliCompressSync(code, {
  params: {
    [constants.BROTLI_PARAM_QUALITY]: 11,
    [constants.BROTLI_PARAM_LGWIN]: 24,
    [constants.BROTLI_PARAM_SIZE_HINT]: code.length,
  },
}).toString('base64');

const loader = `#!/usr/bin/env node
// better-tg-cli — the CLI below is minified and brotli-compressed to keep installs small.
// Readable source: https://github.com/TheVilfer/better-tg-cli (built by scripts/bundle.mjs).
import { brotliDecompressSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const file = fileURLToPath(import.meta.url);
const code = brotliDecompressSync(Buffer.from(${JSON.stringify(packed)}, 'base64')).toString('utf8');
const module = { exports: {} };
new Function('exports', 'require', 'module', '__filename', '__dirname', code)(module.exports, createRequire(file), module, file, dirname(file));
`;

const mb = n => (n / 1048576).toFixed(2) + ' MB';
console.error(`bundle ${mb(code.length)} → brotli+base64 ${mb(packed.length)}`);

// 3. Emit: the npm entry point, or a standalone binary built from the same loader
if (mode === 'node') {
  await Bun.write('dist/telegram.mjs', loader);
  (await import('node:fs')).chmodSync('dist/telegram.mjs', 0o755);
  console.log(`dist/telegram.mjs  ${mb(loader.length)}`);
} else {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'tg-bundle-'));
  try {
    writeFileSync(join(dir, 'telegram.mjs'), loader);
    const { version } = JSON.parse((await import('node:fs')).readFileSync('package.json', 'utf8'));
    // Windows version resource: code signing (SignPath) checks product name and version
    const windows = mode.includes('windows') ? {
      title: 'better-tg-cli',
      publisher: 'better-tg-cli',
      // Four numeric parts only: a release candidate carries the version it leads to
      version: `${version.split('-')[0]}.0`,
      description: 'Telegram on your own account for the terminal and AI agents',
      copyright: 'MIT License, (c) 2026 Derek Rein, Sergei Polin',
    } : undefined;
    const bin = await Bun.build({ entrypoints: [join(dir, 'telegram.mjs')], compile: { target: mode, outfile, windows } });
    if (!bin.success) {
      for (const log of bin.logs) console.error(log);
      process.exit(1);
    }
    // Windows targets get .exe appended; report the file Bun actually wrote
    const out = bin.outputs[0]?.path ?? outfile;
    console.log(`${out}  ${mb((await import('node:fs')).statSync(out).size)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
