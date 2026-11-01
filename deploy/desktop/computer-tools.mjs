import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { mkdir, open, lstat, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';

const maxSharedFileBytes = 256 * 1024;
const maxCommandBytes = 2400;
const maxOutputBytes = 32 * 1024;
const maxRuntimeMs = 120_000;
const activeTerminals = new Set();

export async function listSharedFiles(workspaceValue, relativeDirectory = '') {
  const root = await sharedRoot(workspaceValue);
  const target = await resolveSharedPath(root, relativeDirectory, true);
  const info = await lstat(target);
  if (!info.isDirectory()) throw new Error('Shared workspace path is not a directory');
  const names = await readdir(target, { withFileTypes: true });
  return Promise.all(names.filter(item => item.name !== '.' && item.name !== '..').slice(0, 100).map(async item => {
    const filePath = path.join(target, item.name);
    const meta = await lstat(filePath);
    if (meta.isSymbolicLink()) return null;
    return { name: item.name, kind: meta.isDirectory() ? 'directory' : meta.isFile() ? 'file' : 'other', size: meta.isFile() ? meta.size : null };
  })).then(items => items.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)));
}

export async function readSharedFile(workspaceValue, relativeFile) {
  const root = await sharedRoot(workspaceValue);
  const target = await resolveSharedPath(root, relativeFile, false);
  const info = await lstat(target);
  if (info.isSymbolicLink() || !info.isFile() || info.size > maxSharedFileBytes) throw new Error('Shared workspace file is not available as text');
  const handle = await open(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
  try {
    const bytes = await handle.readFile();
    if (bytes.length > maxSharedFileBytes || bytes.includes(0)) throw new Error('Shared workspace file is not available as text');
    return bytes.toString('utf8');
  } finally { await handle.close(); }
}

export async function runApprovedTerminal({ command, directory }, { workspaceValue, taskDirectory, signal }) {
  if (typeof command !== 'string' || !command.trim() || Buffer.byteLength(command, 'utf8') > maxCommandBytes || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(command)) throw new Error('Terminal command is invalid');
  if (!['task', 'shared'].includes(directory)) throw new Error('Terminal working directory is invalid');
  if (signal?.aborted) throw signal.reason || new Error('Task was stopped');
  const cwd = directory === 'task' ? await checkedDirectory(taskDirectory) : await sharedRoot(workspaceValue);
  const child = spawn('/bin/bash', ['--noprofile', '--norc', '-c', command], {
    cwd,
    env: { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', HOME: cwd, TMPDIR: '/tmp', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TERM: 'dumb' },
    shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  activeTerminals.add(child);
  const stdout = [], stderr = [];
  let outputBytes = 0, overflow = false, timedOut = false;
  const terminate = (signalName = 'SIGTERM') => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signalName); } catch { child.kill(signalName); }
  };
  const capture = (target, chunk) => {
    const bytes = Buffer.from(chunk);
    outputBytes += bytes.length;
    if (outputBytes > maxOutputBytes) { overflow = true; terminate('SIGKILL'); return; }
    target.push(bytes);
  };
  child.stdout.on('data', chunk => capture(stdout, chunk));
  child.stderr.on('data', chunk => capture(stderr, chunk));
  let abortListener;
  const timer = setTimeout(() => { timedOut = true; terminate('SIGTERM'); setTimeout(() => terminate('SIGKILL'), 1000).unref(); }, maxRuntimeMs);
  const onAbort = () => terminate('SIGTERM');
  if (signal) {
    abortListener = onAbort;
    signal.addEventListener('abort', abortListener, { once: true });
    if (signal.aborted) onAbort();
  }
  // Keep the Agent runtime environment immutable for concurrent tasks. The child
  // already receives a minimal allowlist; these values are used only to redact output.
  const sensitiveValues = Object.entries(process.env)
    .filter(([key]) => /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key))
    .map(([, value]) => value);
  try {
    const [code] = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', value => resolve([value ?? 1]));
    });
    if (signal?.aborted) throw signal.reason || new Error('Task was stopped');
    if (overflow) throw new Error('Terminal output exceeded 32 KiB');
    const redact = value => {
      let text = value;
      for (const secret of sensitiveValues) if (typeof secret === 'string' && secret.length >= 4) text = text.split(secret).join('[redacted]');
      return text;
    };
    const result = { directory, exitCode: code, timedOut, stdout: redact(Buffer.concat(stdout).toString('utf8')), stderr: redact(Buffer.concat(stderr).toString('utf8')) };
    if (timedOut) result.stderr = `${result.stderr}${result.stderr ? '\n' : ''}Terminal command timed out after 120 seconds`;
    return result;
  } finally {
    clearTimeout(timer);
    if (abortListener) signal.removeEventListener('abort', abortListener);
    activeTerminals.delete(child);
    terminate('SIGKILL');
  }
}

export function stopActiveTerminals() {
  for (const child of activeTerminals) {
    if (!child.pid) continue;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  }
}

async function sharedRoot(workspaceValue) {
  const workspace = path.resolve(String(workspaceValue || '/workspace'));
  const workspaceReal = await realpath(workspace);
  const target = path.join(workspaceReal, 'shared');
  await mkdir(target, { recursive: true, mode: 0o770 });
  const info = await lstat(target);
  if (info.isSymbolicLink() || !info.isDirectory() || await realpath(target) !== target) throw new Error('Shared workspace root is invalid');
  return target;
}

async function resolveSharedPath(root, relativeValue, directoryAllowed) {
  const relative = String(relativeValue ?? '');
  if (relative.length > 500 || relative.includes('\\') || path.posix.isAbsolute(relative) || (relative && relative.split('/').some(part => !part || part === '.' || part === '..')) || (!directoryAllowed && !relative)) throw new Error('Shared workspace path is invalid');
  let target = root;
  for (const part of relative.split('/').filter(Boolean)) {
    target = path.join(target, part);
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error('Shared workspace symbolic links are not available');
    const real = await realpath(target);
    if (real !== target || !real.startsWith(`${root}${path.sep}`)) throw new Error('Shared workspace path is outside the user computer');
  }
  return target;
}

async function checkedDirectory(value) {
  const target = path.resolve(String(value || ''));
  const info = await lstat(target);
  if (info.isSymbolicLink() || !info.isDirectory() || await realpath(target) !== target) throw new Error('Task working directory is invalid');
  return target;
}

process.once('SIGTERM', stopActiveTerminals);
process.once('SIGINT', stopActiveTerminals);
