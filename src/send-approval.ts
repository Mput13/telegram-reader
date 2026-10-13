import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from './paths.js';
import { confirmByHuman } from './confirm.js';

export interface Proposal { chat_id: string; title: string; text: string; reply_to?: number }
type Record = { proposal: Proposal; digest: string; expires: number };
const TTL = 5 * 60_000;
const digest = (p: Proposal) => createHash('sha256').update(JSON.stringify(p)).digest('hex');
function dir() { const p = join(configDir(), 'send-approvals'); mkdirSync(p, { recursive: true, mode: 0o700 }); return p; }
function path(id: string, state: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid request ID.');
  return join(dir(), `${id}.${state}.json`);
}
function read(file: string): Record {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('Unsafe approval file permissions.');
  const record = JSON.parse(readFileSync(file, 'utf8')) as Record;
  if (!record.proposal || record.digest !== digest(record.proposal) || !Number.isFinite(record.expires) || record.expires <= Date.now()) throw new Error('Approval is expired or changed.');
  return record;
}
export function createProposal(proposal: Proposal) {
  const id = randomBytes(16).toString('hex');
  writeFileSync(path(id, 'pending'), JSON.stringify({ proposal, digest: digest(proposal), expires: Date.now() + TTL }), { mode: 0o600, flag: 'wx' });
  return { request_id: id, recipient: proposal.title, chat_id: proposal.chat_id, text: proposal.text, reply_to: proposal.reply_to, approval: `Run locally: telegram approve-send ${id}`, expires_in_seconds: 300 };
}
export async function approveProposal(id: string) {
  const pending = path(id, 'pending');
  const record = read(pending);
  // JSON escapes control characters; terminal text cannot erase or hide the recipient.
  if (!await confirmByHuman(`Send exactly this message?\n${JSON.stringify(record.proposal, null, 2)}`)) throw new Error('Not approved.');
  const checked = read(pending);
  if (checked.digest !== record.digest) throw new Error('Proposal changed during confirmation.');
  renameSync(pending, path(id, 'approved'));
}
export function consumeApproval(id: string): Proposal {
  const approved = path(id, 'approved');
  const claimed = path(id, 'consumed');
  // Rename claims the approval once, even for concurrent callers. Never restore it after failure.
  try { renameSync(approved, claimed); } catch { throw new Error('No unused local approval for this request.'); }
  return read(claimed).proposal;
}
