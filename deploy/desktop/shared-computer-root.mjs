import { chmod, lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

/** Keep the desktop/Agent shared folder group-writable while protecting control state from Agent writes. */
export async function ensureSharedComputerRoots(workspaceValue) {
  const workspace = await realpath(path.resolve(String(workspaceValue || '/workspace')));
  const shared = path.join(workspace, 'shared');
  await mkdir(shared, { recursive: true, mode: 0o770 });
  const sharedInfo = await lstat(shared);
  if (sharedInfo.isSymbolicLink() || !sharedInfo.isDirectory() || await realpath(shared) !== shared) throw new Error('Shared computer directory is not available');
  await chmod(shared, 0o770);

  const screenState = path.join(shared, 'computer-screens');
  await mkdir(screenState, { recursive: true, mode: 0o750 });
  const screenInfo = await lstat(screenState);
  if (screenInfo.isSymbolicLink() || !screenInfo.isDirectory() || await realpath(screenState) !== screenState) throw new Error('Computer screen state directory is not available');
  await chmod(screenState, 0o750);
  return screenState;
}
