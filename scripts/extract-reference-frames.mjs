#!/usr/bin/env node
// Extract every decoded source frame in a short interval, preserving source PTS.
// Research videos and generated images are local-only; see research/README.md.
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const usage = 'Usage: node scripts/extract-reference-frames.mjs --input VIDEO --start SECONDS --duration SECONDS --out NEW_DIRECTORY';
const values = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!['--input', '--start', '--duration', '--out'].includes(key) || process.argv[i + 1] === undefined || values[key] !== undefined) {
    throw new Error(usage);
  }
  values[key] = process.argv[i + 1];
}
if (!values['--input'] || !values['--out'] || values['--start'] === undefined || values['--duration'] === undefined) throw new Error(usage);
const start = Number(values['--start']);
const duration = Number(values['--duration']);
if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0 || duration > 5) {
  throw new Error('Start must be nonnegative and duration must be greater than zero and at most 5 seconds.');
}
const input = resolve(values['--input']);
const output = resolve(values['--out']);
if (/\.part$/i.test(input)) throw new Error('The source video is still downloading. Use a complete, stable file.');
const sourceBefore = statSync(input);
if (!sourceBefore.isFile()) throw new Error('The source must be a file.');

function run(command, args, maxBuffer = 16 * 1024 * 1024) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${(result.stderr || '').slice(-4000)}`);
  return result;
}
const probe = JSON.parse(run('ffprobe', [
  '-v', 'error', '-select_streams', 'v:0', '-show_entries',
  'stream=width,height,avg_frame_rate,r_frame_rate,time_base,start_time,duration:format=duration',
  '-of', 'json', input,
]).stdout);
if (!probe.streams?.[0]) throw new Error('No video stream found.');

const hash = createHash('sha256');
for await (const chunk of createReadStream(input)) hash.update(chunk);
const sha256 = hash.digest('hex');
const sourceAfter = statSync(input);
if (sourceBefore.size !== sourceAfter.size || sourceBefore.mtimeMs !== sourceAfter.mtimeMs) throw new Error('Source changed while being read.');

// A new directory prevents accidental overwrite or cleanup of prior evidence.
mkdirSync(output);
const framePattern = join(output, 'frame-%06d.png');
const extraction = run('ffmpeg', [
  '-hide_banner', '-nostdin', '-loglevel', 'info',
  '-ss', String(start), '-t', String(duration), '-copyts', '-i', input,
  '-map', '0:v:0', '-an', '-vf', 'showinfo', '-fps_mode', 'passthrough',
  '-start_number', '0', framePattern,
]);
const frames = [];
for (const line of extraction.stderr.split('\n')) {
  const match = line.match(/\bn:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:\s*(-?[\d.]+)/);
  if (!match) continue;
  const index = Number(match[1]);
  frames.push({ index, sourcePts: Number(match[2]), sourceSeconds: Number(match[3]), file: `frame-${String(index).padStart(6, '0')}.png` });
}
const images = readdirSync(output).filter(name => /^frame-\d{6}\.png$/.test(name)).sort();
if (frames.length === 0 || images.length !== frames.length || frames.some((frame, index) => frame.index !== index || frame.file !== images[index])) {
  throw new Error(`Frame and timestamp counts do not match: ${images.length} images, ${frames.length} timestamps.`);
}
for (const frame of frames) {
  const frameHash = createHash('sha256');
  for await (const chunk of createReadStream(join(output, frame.file))) frameHash.update(chunk);
  frame.sha256 = frameHash.digest('hex');
}

// The sheet is only an index. Full-size lossless PNGs remain beside it.
run('ffmpeg', [
  '-hide_banner', '-nostdin', '-loglevel', 'error', '-framerate', '30', '-start_number', '0', '-i', framePattern,
  '-vf', 'scale=320:-2,tile=5x5', '-fps_mode', 'passthrough', '-start_number', '0',
  '-q:v', '2', join(output, 'sheet-%04d.jpg'),
]);
const sheets = readdirSync(output).filter(name => /^sheet-\d{4}\.jpg$/.test(name)).sort();
if (sheets.length !== Math.ceil(frames.length / 25)) throw new Error('Contact sheet count does not match extracted frame count.');
const sourceFinal = statSync(input);
if (sourceBefore.size !== sourceFinal.size || sourceBefore.mtimeMs !== sourceFinal.mtimeMs) throw new Error('Source changed during extraction.');
const manifest = {
  source: { name: basename(input), sha256, bytes: sourceBefore.size, video: probe.streams[0], containerDurationSeconds: Number(probe.format?.duration) || null },
  requested: { startSeconds: start, durationSeconds: duration },
  frameCount: frames.length,
  frames,
  sheets: sheets.map((file, index) => ({ file, firstFrame: index * 25, lastFrame: Math.min(index * 25 + 24, frames.length - 1) })),
  note: 'PTS values are from the local source file. A clipped or rebased source requires independent alignment to the original video.',
};
writeFileSync(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output, frames: frames.length, firstSeconds: frames[0].sourceSeconds, lastSeconds: frames.at(-1).sourceSeconds, sheets: sheets.length, sourceSha256: sha256 }));
