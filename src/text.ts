import { readFileSync } from 'fs';

/**
 * Message text argument: "-" reads it from stdin, so agents can pass long or
 * multi-line text without shell quoting (`cat msg.txt | telegram send @x -`).
 */
/**
 * Error text that is safe to send in an HTTP answer: the message of a real Error and nothing
 * else. Stringifying an arbitrary thrown value could put a stack trace or an object dump on the wire.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

export function readTextArg(value: string): string {
  if (value !== '-') return value;
  const text = readFileSync(0, 'utf-8').replace(/\r?\n$/, '');
  if (!text) throw new Error('Empty message on stdin');
  return text;
}
