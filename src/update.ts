import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { configFile } from './paths.js';
import { VERSION } from './version.js';

export const PACKAGE = 'better-tg-cli';
const WIN = process.platform === 'win32';
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE}/latest`;
const RELEASES_URL = 'https://github.com/TheVilfer/better-tg-cli/releases/latest';
const CHECK_INTERVAL_MS = 24 * 3600e3;
export const BACKGROUND_CHECK_COMMAND = '__update-check';

export type InstallMethod =
  | { kind: 'brew' }
  | { kind: 'npm' }
  | { kind: 'scoop' }
  | { kind: 'source'; root: string }
  | { kind: 'binary'; path: string };

/**
 * Compares versions numerically. A pre-release (`0.35.0-rc.2`, from `npm i -g better-tg-cli@next`)
 * is older than its release and ordered by its number, so the release replaces it.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.split('-', 2);
    const parts = core.split('.').slice(0, 3).map(Number);
    return { parts, pre: pre === undefined ? Infinity : Number(/(\d+)$/.exec(pre)?.[1] ?? 0) };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa.parts[i] || 0) - (pb.parts[i] || 0);
    if (d) return Math.sign(d);
  }
  return pa.pre === pb.pre ? 0 : pa.pre > pb.pre ? 1 : -1;
}

/** `bun build --compile` output; `bun src/index.ts` also sets process.versions.bun, so check the embedded path. */
export function isCompiledBinary(scriptPath = process.argv[1] ?? ''): boolean {
  return !!process.versions.bun && (scriptPath.startsWith('/$bunfs/') || scriptPath.startsWith('B:/~BUN/'));
}

/** Works out how this copy was installed from where the running file lives. */
export function detectInstall(
  execPath = process.execPath,
  scriptPath = process.argv[1] ?? '',
  isBinary = isCompiledBinary(scriptPath),
): InstallMethod {
  if (isBinary) {
    if (/\/(Cellar|linuxbrew)\//.test(execPath)) return { kind: 'brew' };
    if (/[\\/]scoop[\\/]apps[\\/]/i.test(execPath)) return { kind: 'scoop' };
    return { kind: 'binary', path: execPath };
  }
  let script = scriptPath;
  try { script = realpathSync(scriptPath); } catch { /* keep as given */ }
  if (new RegExp(`[\\\\/]node_modules[\\\\/]${PACKAGE}[\\\\/]`).test(script)) return { kind: 'npm' };
  // dist/telegram.mjs inside a checkout
  const root = dirname(dirname(script));
  if (existsSync(join(root, '.git'))) return { kind: 'source', root };
  return { kind: 'npm' };
}

export async function fetchLatestVersion(timeoutMs = 5000): Promise<string> {
  const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`npm registry answered ${res.status}`);
  const { version } = (await res.json()) as { version?: string };
  if (!version) throw new Error('npm registry returned no version');
  return version;
}

export function updateCommandFor(method: InstallMethod): string {
  switch (method.kind) {
    case 'brew': return 'brew upgrade better-tg-cli';
    case 'scoop': return 'scoop update better-tg-cli';
    case 'npm': return `npm install -g ${PACKAGE}@latest`;
    case 'source': return `git -C ${JSON.stringify(method.root)} pull --ff-only && npm --prefix ${JSON.stringify(method.root)} run build`;
    case 'binary': return `download the archive from ${RELEASES_URL} and replace ${method.path}`;
  }
}

// ---- once-a-day notice -------------------------------------------------------

interface CheckCache { checkedAt: number; latest?: string }

export function cachePath(): string {
  return process.env.TG_UPDATE_CACHE ?? configFile('update-check.json');
}

function readCache(): CheckCache | undefined {
  try { return JSON.parse(readFileSync(cachePath(), 'utf8')); } catch { return undefined; }
}

export function writeCache(cache: CheckCache): void {
  try {
    mkdirSync(dirname(cachePath()), { recursive: true });
    writeFileSync(cachePath(), JSON.stringify(cache));
  } catch { /* the notice is best effort */ }
}

/** Hidden command run in a detached child: refresh the cache and exit. */
export async function runBackgroundCheck(): Promise<void> {
  try {
    writeCache({ checkedAt: Date.now(), latest: await fetchLatestVersion(10_000) });
  } catch {
    writeCache({ checkedAt: Date.now(), latest: readCache()?.latest });
  }
}

/**
 * Only for humans at a terminal: agents and pipes never see the notice, so it
 * costs them no tokens and cannot break parsed output. The network check runs in
 * a detached child, so it never delays the command itself.
 */
export function maybeNotifyUpdate(argv = process.argv.slice(2)): void {
  if (!process.stderr.isTTY || process.env.TG_NO_UPDATE_CHECK || process.env.CI) return;
  const cmd = argv[0];
  if (cmd === 'update' || cmd === BACKGROUND_CHECK_COMMAND || cmd === '--version' || cmd === '-V') return;

  const cache = readCache();
  if (cache?.latest && compareVersions(cache.latest, VERSION) > 0) {
    process.stderr.write(`better-tg-cli ${cache.latest} is available (you have ${VERSION}): run \`telegram update\`\n`);
  }
  if (!cache || Date.now() - cache.checkedAt > CHECK_INTERVAL_MS) {
    // Mark first so parallel runs don't all spawn a check.
    writeCache({ checkedAt: Date.now(), latest: cache?.latest });
    const args = isCompiledBinary() ? [BACKGROUND_CHECK_COMMAND] : [process.argv[1], BACKGROUND_CHECK_COMMAND];
    try {
      spawn(process.execPath, args, { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, TG_NO_UPDATE_CHECK: '1' } }).unref();
    } catch { /* offline or sandboxed: skip */ }
  }
}

export function runUpdate(method: InstallMethod): number {
  if (method.kind === 'binary') return 1;
  if (method.kind === 'source') {
    const dirty = spawnSync('git', ['-C', method.root, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' });
    if (dirty.stdout?.trim()) {
      process.stderr.write(`${method.root} has uncommitted changes; commit or stash them, then run: ${updateCommandFor(method)}\n`);
      return 1;
    }
    const pull = spawnSync('git', ['-C', method.root, 'pull', '--ff-only'], { stdio: 'inherit' });
    if (pull.status !== 0) return pull.status ?? 1;
    return spawnSync('npm', ['--prefix', method.root, 'run', 'build'], { stdio: 'inherit', shell: WIN }).status ?? 1;
  }
  const [bin, ...args] = method.kind === 'brew'
    ? ['brew', 'upgrade', 'better-tg-cli']
    : method.kind === 'scoop'
      ? ['scoop', 'update', 'better-tg-cli']
      : ['npm', 'install', '-g', `${PACKAGE}@latest`];
  // npm and scoop are .cmd/.ps1 shims on Windows, which Node only starts through a shell;
  // the arguments are constants, so the shell is safe here
  return spawnSync(bin, args, { stdio: 'inherit', shell: WIN }).status ?? 1;
}
