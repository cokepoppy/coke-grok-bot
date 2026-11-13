import { appendFile, chmod, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const screenIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const owners = new Set(['agent', 'user']);
const sources = new Set(['take-control', 'return-to-bot']);

export function computerScreenKey(screenId) {
  if (typeof screenId !== 'string' || !screenIdPattern.test(screenId)) throw new Error('Invalid Bot screen id');
  return createHash('sha256').update(screenId.toLowerCase()).digest('hex').slice(0, 16);
}

/** Append a private, persistent audit event after a Bot screen control transition succeeds. */
export async function appendControlOwnerEvent(directory, { screenId, fromOwner, toOwner, source, at = new Date().toISOString() }) {
  if (!owners.has(fromOwner) || !owners.has(toOwner) || !sources.has(source) || fromOwner === toOwner || typeof at !== 'string' || !Number.isFinite(Date.parse(at))) {
    throw new Error('Invalid computer control audit event');
  }
  const screenKey = computerScreenKey(screenId);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Computer control audit directory is unavailable');
  const file = path.join(directory, `${screenKey}.control.jsonl`);
  try {
    const existing = await lstat(file);
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('Computer control audit file is unavailable');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const event = { at, screenKey, fromOwner, toOwner, source };
  await appendFile(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(file, 0o600);
  return event;
}
