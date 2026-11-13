import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cleanUploadName, uploadExtension, validateUploadSize, WorkspaceFileStore } from '../src/server/file-store.ts';

test('attachment names and limits match the documented desktop bounds', () => {
  assert.equal(cleanUploadName('folder\\notes.txt'), 'notes.txt');
  assert.equal(cleanUploadName('../报告.pdf'), '报告.pdf');
  assert.equal(uploadExtension('Report.PDF'), 'pdf');
  assert.equal(uploadExtension('no extension'), '');
  assert.throws(() => cleanUploadName('bad\nname.txt'), /Invalid attachment name/);

  validateUploadSize('image/png', 25 * 1024 * 1024);
  assert.throws(() => validateUploadSize('image/png', 25 * 1024 * 1024 + 1), /too large/);
  validateUploadSize('video/mp4', 1024 * 1024 * 1024);
  assert.throws(() => validateUploadSize('video/mp4', 1024 * 1024 * 1024 + 1), /too large/);
  validateUploadSize('application/pdf', 250 * 1024 * 1024);
  assert.throws(() => validateUploadSize('application/pdf', 250 * 1024 * 1024 + 1), /too large/);
  assert.throws(() => validateUploadSize('text/plain', 0), /Invalid attachment size/);
});

test('a message accepts at most 20 distinct valid file references', () => {
  const ids = Array.from({ length: 20 }, () => randomUUID());
  assert.deepEqual(WorkspaceFileStore.validateFileIds(ids), ids);
  assert.throws(() => WorkspaceFileStore.validateFileIds([...ids, randomUUID()]), /Invalid attachment list/);
  assert.throws(() => WorkspaceFileStore.validateFileIds([ids[0], ids[0]]), /Invalid attachment list/);
  assert.throws(() => WorkspaceFileStore.validateFileIds(['../../secrets']), /Invalid attachment list/);
});

test('completed task artifact metadata preserves safe nested paths for explicit group handoff',()=>{
  const runId=randomUUID(),sha256='a'.repeat(64),bytes=Buffer.from('<h1>BSE preview</h1>');
  const files=WorkspaceFileStore.validateArtifacts([{name:'bse-demo/index.html',mimeType:'text/html',size:bytes.length,sha256,storageKey:`tasks/${runId}/artifacts/bse-demo/index.html`}],runId);
  assert.deepEqual(files,[{name:'bse-demo/index.html',mimeType:'text/html',size:bytes.length,sha256,storageKey:`tasks/${runId}/artifacts/bse-demo/index.html`}]);
  for(const name of ['../index.html','bse-demo/../index.html','bse-demo/.secret','/etc/passwd','bse-demo\\index.html']){
    assert.throws(()=>WorkspaceFileStore.validateArtifacts([{name,mimeType:'text/html',size:bytes.length,sha256,storageKey:`tasks/${runId}/artifacts/${name}`}],runId),/Invalid result file/);
  }
});
