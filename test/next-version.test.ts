import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { bump, bumpFor, nextPrerelease } from '../scripts/next-version.mjs';

describe('next-version', () => {
  it('is minor when a PR adds something, patch otherwise, nothing after only a release', () => {
    expect(bumpFor(['Fix the QR timeout (#20)', 'Add Spanish to the onboard page (#12)'])).toBe('minor');
    expect(bumpFor(['Fix the QR timeout (#20)', 'Update README (#21)', 'Wait longer for npm (#11)'])).toBe('patch');
    expect(bumpFor(['feat!: drop Node 18', 'Fix typo'])).toBe('minor');
    expect(bumpFor(['Change the config format (BREAKING)'])).toBe('minor');
    expect(bumpFor(['Addendum to docs'])).toBe('patch');
    expect(bumpFor(['Release v0.30.0 (#13)', ''])).toBeNull();
    expect(bumpFor([])).toBeNull();
  });

  it('bumps a version by level', () => {
    expect(bump('0.34.0', 'patch')).toBe('0.34.1');
    expect(bump('0.34.7', 'minor')).toBe('0.35.0');
    expect(bump('0.34.7', 'major')).toBe('1.0.0');
    expect(() => bump('0.34.0', 'huge')).toThrow(/Unknown release level/);
  });

  it('numbers release candidates per coming version', () => {
    expect(nextPrerelease('0.34.0', 'minor', [])).toBe('0.35.0-rc.1');
    expect(nextPrerelease('0.34.0', 'minor', ['v0.35.0-rc.1', 'v0.35.0-rc.2', ''])).toBe('0.35.0-rc.3');
    expect(nextPrerelease('0.34.0', 'minor', ['v0.35.0-rc.9', 'v0.35.0-rc.10'])).toBe('0.35.0-rc.11');
    // A later `Add …` PR raises the level: the new base starts its own numbering
    expect(nextPrerelease('0.34.0', 'minor', ['v0.34.1-rc.1', 'v0.34.1-rc.2'])).toBe('0.35.0-rc.1');
    expect(nextPrerelease('0.34.0', 'patch', ['v0.34.1-rc.1', 'v0.33.1-rc.5'])).toBe('0.34.1-rc.2');
  });
});
