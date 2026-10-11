import { Logger, LogLevel } from 'teleproto/extensions/Logger.js';
import { loadConfig } from './config.js';
import { isMock } from './paths.js';

const LEVELS: Record<string, LogLevel> = {
  none: LogLevel.NONE, error: LogLevel.ERROR, warn: LogLevel.WARN, info: LogLevel.INFO, debug: LogLevel.DEBUG,
};

/**
 * teleproto's logger prints to stdout, which would corrupt --json and `watch --json`;
 * every line goes to stderr instead. TG_LOG_LEVEL=debug shows the MTProto traffic.
 */
export function createLogger(level = process.env.TG_LOG_LEVEL?.toLowerCase()): Logger {
  const logger = new Logger(LEVELS[level ?? ''] ?? LogLevel.ERROR);
  const quiet = level === 'none';
  // Flood waits are retried silently at INFO; surface them so a long pause doesn't look like a hang.
  const info = logger.info.bind(logger);
  logger.info = (message: string, error?: Error) => {
    const m = /^Sleeping for (\d+)s on flood wait \(Caused by ([\w.]+)\)/.exec(message);
    if (m && !quiet && !logger.canSend(LogLevel.INFO)) {
      process.stderr.write(`Telegram rate limit on ${m[2]}: waiting ${m[1]}s, then retrying\n`);
    }
    info(message, error);
  };
  logger.log = (lvl, message, error) => {
    process.stderr.write(`[${lvl}] ${message}\n`);
    if (error !== undefined) process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  };
  return logger;
}

/**
 * Options for every TelegramClient. `testServers` comes from the profile's config
 * (set by `telegram auth --test-dc`): a session belongs to one environment.
 */
export function clientParams(testServers = !!loadConfig(() => {}).testServers) {
  // Every real TelegramClient is built with these options, so this one check keeps TG_MOCK offline
  if (isMock()) {
    throw new Error('This needs a real Telegram connection, which mock mode (TG_MOCK) never opens. Unset TG_MOCK to use a real account.');
  }
  return { connectionRetries: 5, baseLogger: createLogger(), testServers, floodSleepThreshold: floodWaitMax() };
}

/**
 * Longest FLOOD_WAIT (seconds) retried automatically; longer ones fail with the wait in the
 * message. TG_FLOOD_WAIT_MAX=0 fails fast (useful for agents), larger values suit long syncs.
 */
export function floodWaitMax(value = process.env.TG_FLOOD_WAIT_MAX): number {
  const n = value === undefined || value === '' ? NaN : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 3600) : 60;
}
