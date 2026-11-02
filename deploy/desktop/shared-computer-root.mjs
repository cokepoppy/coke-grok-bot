import { chmod, lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

/** Keep the desktop/Agent shared folder group-writable while protecting control state from Agent writes. */
export async function ensureSharedComputerRoots(workspaceValue) {
  const workspace = await realpath(path.resolve(String(workspaceValue || '/workspace')));
  const shared = path.join(workspace, 'shared');
  await mkdir(shared, { recursive: true, mode: 0o770 });
  const sharedInfo = await lstat(shared);
  if (sharedInfo.isSymbolicLink() || !sharedInfo.isDirectory() || await realpath(shared) !== shared) throw new Error('Shared computer directory is not available');
  if (sharedDirectoryModeAction(sharedInfo, process.getuid?.(), [process.getgid?.(), ...(process.getgroups?.() || [])]) === 'normalize') await chmod(shared, 0o770);

  const screenState = path.join(shared, 'computer-screens');
  await mkdir(screenState, { recursive: true, mode: 0o750 });
  const screenInfo = await lstat(screenState);
  if (screenInfo.isSymbolicLink() || !screenInfo.isDirectory() || await realpath(screenState) !== screenState) throw new Error('Computer screen state directory is not available');
  if (screenInfo.uid !== process.getuid?.()) throw new Error('Computer screen state directory is not controlled by the desktop');
  if ((screenInfo.mode & 0o777) !== 0o750) await chmod(screenState, 0o750);
  return screenState;
}

/** A Desktop process may share a group-writable directory owned by the Agent; it must not chmod another user's directory. */
export function sharedDirectoryModeAction(stat, uid = process.getuid?.(), groups = [process.getgid?.(), ...(process.getgroups?.() || [])]) {
  const mode = stat.mode & 0o777;
  if (stat.uid === uid) return mode === 0o770 ? 'keep' : 'normalize';
  const groupHasAccess = groups.includes(stat.gid) && (mode & 0o070) === 0o070 && (mode & 0o007) === 0;
  if (groupHasAccess) return 'keep';
  throw new Error('Shared computer directory is not writable by the desktop group');
}
