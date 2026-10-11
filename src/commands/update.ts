import { Command } from 'commander';
import { formatJson } from '../formatters/json.js';
import { VERSION } from '../version.js';
import {
  compareVersions, detectInstall, fetchLatestVersion, runUpdate, updateCommandFor, writeCache,
} from '../update.js';

export const updateCommand = new Command('update')
  .description('Update Better-TG-CLI the way it was installed (brew, npm or a git checkout)')
  .option('--check', 'Only report whether a newer version exists')
  .option('--json', 'Output as JSON (with --check)')
  .action(async (options) => {
    const method = detectInstall();
    let latest: string;
    try {
      latest = await fetchLatestVersion();
      writeCache({ checkedAt: Date.now(), latest });
    } catch (error) {
      console.error(`Could not check for updates: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
    const newer = compareVersions(latest, VERSION) > 0;
    const command = updateCommandFor(method);

    if (options.check) {
      if (options.json) {
        console.log(formatJson({ current: VERSION, latest, updateAvailable: newer, install: method.kind, command }));
      } else {
        console.log(newer ? `${VERSION} → ${latest} available (${method.kind}): ${command}` : `${VERSION} is up to date (latest ${latest})`);
      }
      return;
    }

    // A git checkout may carry unreleased commits, so it is pulled even without a newer release.
    if (!newer && method.kind !== 'source') {
      console.log(`${VERSION} is up to date`);
      return;
    }
    if (method.kind === 'binary') {
      console.error(`This is a standalone binary: ${command}`);
      process.exit(1);
    }
    console.error(`Updating via ${method.kind}: ${command}`);
    process.exit(runUpdate(method));
  });
