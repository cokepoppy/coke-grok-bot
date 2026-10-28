import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/extract-reference-frames.mjs');
function run(command, args) { return spawnSync(command, args, { encoding: 'utf8' }); }
test('extracts every source frame with its original timestamps and refuses overwrite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'grok-frame-test-'));
  try {
    const source = join(dir, 'source.mp4');
    const encoded = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=5:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
    assert.equal(encoded.status, 0, encoded.stderr);
    const out = join(dir, 'frames');
    const args = [script, '--input', source, '--start', '1.2', '--duration', '1', '--out', out];
    const result = run(process.execPath, args);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    assert.equal(manifest.frameCount, 5);
    assert.deepEqual(manifest.frames.map(frame => frame.sourceSeconds), [1.2, 1.4, 1.6, 1.8, 2]);
    assert.equal(manifest.source.video.width, 320);
    assert.equal(manifest.source.sha256.length, 64);
    assert.ok(manifest.frames.every(frame => /^[a-f0-9]{64}$/.test(frame.sha256)));
    assert.equal(readdirSync(out).filter(name => name.endsWith('.png')).length, 5);
    assert.equal(manifest.sheets.length, 1);
    assert.notEqual(run(process.execPath, args).status, 0);
    assert.equal(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')).frameCount, 5);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
