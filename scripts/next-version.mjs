// Works out the next version from the squash-merged PR titles since the last stable tag, so
// nobody picks a version by hand. `Add …` (a feature) or a breaking marker (`!`, `BREAKING`) →
// minor (breaking is still minor before 1.0); anything else → patch; only `Release v…` commits →
// nothing.
// Usage: node scripts/next-version.mjs               → minor | patch, or nothing to release
//        node scripts/next-version.mjs pre [level]   → the next pre-release, e.g. 0.35.0-rc.2
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function bumpFor(subjects) {
  const changes = subjects.map(s => s.trim()).filter(s => s && !/^Release v\d/.test(s));
  if (!changes.length) return null;
  return changes.some(s => /^Add\b/.test(s) || /^[\w-]+(\([^)]*\))?!:/.test(s) || /\bBREAKING\b/.test(s)) ? 'minor' : 'patch';
}

/** `0.34.0` + `minor` → `0.35.0`. */
export function bump(version, level) {
  const [major, minor, patch] = version.split('-')[0].split('.').map(Number);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  if (level === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown release level "${level}": use patch, minor or major`);
}

/**
 * The next release candidate of the coming version: `<base>-rc.<n>`, where n continues the rc
 * tags that already exist for that base. The base moves when a later PR raises the level
 * (0.34.1-rc.1, then an `Add …` PR → 0.35.0-rc.1).
 */
export function nextPrerelease(current, level, tags) {
  const base = bump(current, level);
  const taken = tags
    .map(t => new RegExp(`^v${base.replaceAll('.', '\\.')}-rc\\.(\\d+)$`).exec(t.trim()))
    .filter(Boolean)
    .map(m => Number(m[1]));
  return `${base}-rc.${Math.max(0, ...taken) + 1}`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  // Release candidates are tagged too; the level is always counted from the last stable release
  const last = git('describe', '--tags', '--abbrev=0', '--match', 'v*', '--exclude', '*-rc.*');
  const level = bumpFor(git('log', '--format=%s', `${last}..HEAD`).split('\n'));
  if (process.argv[2] === 'pre') {
    const chosen = process.argv[3] ?? level;
    if (chosen) {
      const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
      console.log(nextPrerelease(version, chosen, git('tag', '--list', 'v*-rc.*').split('\n')));
    }
  } else if (level) {
    console.log(level);
  }
}
