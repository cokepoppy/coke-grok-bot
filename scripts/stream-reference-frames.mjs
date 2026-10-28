#!/usr/bin/env node
// Decode source-timestamped frames from a public YouTube video without saving its signed stream URL.
// Run with Node's --use-env-proxy if the current environment needs a command-scoped proxy.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';

const usage = 'Usage: node --use-env-proxy scripts/stream-reference-frames.mjs --video YOUTUBE_ID --start SECONDS --duration SECONDS --out NEW_DIRECTORY [--format ITAG] [--yt-dlp PATH]';
const values = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!['--video', '--start', '--duration', '--out', '--format', '--yt-dlp'].includes(key) || process.argv[i + 1] === undefined || values[key] !== undefined) throw new Error(usage);
  values[key] = process.argv[i + 1];
}
const id = values['--video'];
const itag = values['--format'] || '248';
const start = Number(values['--start']);
const duration = Number(values['--duration']);
if (!/^[A-Za-z0-9_-]{11}$/.test(id || '') || !/^\d+$/.test(itag) || values['--start'] === undefined || values['--duration'] === undefined || !values['--out'] || !Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0 || duration > 5) throw new Error(usage);
const output = resolve(values['--out']);
const downloader = values['--yt-dlp'] || 'yt-dlp';
const originalUrl = `https://www.youtube.com/watch?v=${id}`;
const yt = spawnSync(downloader, ['--ignore-config', '--no-playlist', '--no-warnings', '--js-runtimes', `node:${process.execPath}`, '-f', itag, '--get-url', originalUrl], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
if (yt.error || yt.status !== 0) throw new Error('Unable to obtain the public video stream; verify yt-dlp, network access and the requested format.');
const streamUrl = yt.stdout.trim().split('\n')[0];
const parsed = new URL(streamUrl);
if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.googlevideo.com')) throw new Error('Unexpected video stream host.');

// Never write the signed upstream URL to disk, console, or FFmpeg arguments.
const server = http.createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
  const headers = {};
  if (req.headers.range) headers.Range = req.headers.range;
  try {
    const upstream = await fetch(streamUrl, { method: req.method, headers, signal: AbortSignal.timeout(90000) });
    const outgoing = {};
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value) outgoing[name] = value;
    }
    res.writeHead(upstream.status, outgoing);
    if (!upstream.body || req.method === 'HEAD') return res.end();
    const body = Readable.fromWeb(upstream.body);
    body.on('error', () => res.destroy());
    res.on('close', () => body.destroy());
    body.pipe(res);
  } catch {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  }
});
await new Promise((accept, reject) => server.listen(0, '127.0.0.1', accept).once('error', reject));
let stderr = '';
try {
  // A new directory prevents accidental overwrite or removal of prior evidence.
  mkdirSync(output);
  const localUrl = `http://127.0.0.1:${server.address().port}/video`;
  const env = { ...process.env, NO_PROXY: [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(','), no_proxy: [process.env.no_proxy, '127.0.0.1', 'localhost'].filter(Boolean).join(',') };
  const child = spawn('ffmpeg', [
    '-hide_banner', '-nostdin', '-loglevel', 'info', '-ss', String(start), '-t', String(duration), '-copyts', '-i', localUrl,
    '-map', '0:v:0', '-an', '-vf', 'showinfo', '-fps_mode', 'passthrough', '-start_number', '0', join(output, 'frame-%06d.png'),
  ], { stdio: ['ignore', 'ignore', 'pipe'], env });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((accept, reject) => { child.on('error', reject); child.on('close', accept); });
  if (code !== 0) throw new Error(`FFmpeg could not decode the requested interval (${code}).`);
  const frames = [];
  for (const line of stderr.split('\n')) {
    const match = line.match(/\bn:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:\s*(-?[\d.]+)/);
    if (!match) continue;
    const index = Number(match[1]);
    frames.push({ index, sourcePts: Number(match[2]), sourceSeconds: Number(match[3]), file: `frame-${String(index).padStart(6, '0')}.png` });
  }
  const images = readdirSync(output).filter(name => /^frame-\d{6}\.png$/.test(name)).sort();
  if (!frames.length || frames.length !== images.length || frames.some((frame, index) => frame.index !== index || frame.file !== images[index])) throw new Error(`Frame/timestamp count mismatch (${images.length}/${frames.length}).`);
  for (const frame of frames) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(join(output, frame.file))) hash.update(chunk);
    frame.sha256 = hash.digest('hex');
  }
  const sheetsResult = spawnSync('ffmpeg', [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-framerate', '30', '-start_number', '0', '-i', join(output, 'frame-%06d.png'),
    '-vf', 'scale=320:-2,tile=5x5', '-fps_mode', 'passthrough', '-start_number', '0', '-q:v', '2', join(output, 'sheet-%04d.jpg'),
  ], { encoding: 'utf8' });
  if (sheetsResult.error || sheetsResult.status !== 0) throw new Error('Unable to create contact sheets.');
  const sheets = readdirSync(output).filter(name => /^sheet-\d{4}\.jpg$/.test(name)).sort();
  if (sheets.length !== Math.ceil(frames.length / 25)) throw new Error('Contact sheet count does not match frames.');
  const dimensions = stderr.match(/\bs:(\d+)x(\d+)\s/);
  const manifest = {
    source: { videoId: id, url: originalUrl, itag, capturedAt: new Date().toISOString(), width: dimensions ? Number(dimensions[1]) : null, height: dimensions ? Number(dimensions[2]) : null, fullVideoSha256: null },
    requested: { startSeconds: start, durationSeconds: duration }, frameCount: frames.length, frames,
    sheets: sheets.map((file, index) => ({ file, firstFrame: index * 25, lastFrame: Math.min(index * 25 + 24, frames.length - 1) })),
    note: 'Frames use the original stream timestamps and individual SHA-256 hashes. The full video was not hashed by this streaming capture.',
  };
  writeFileSync(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ videoId: id, output, frames: frames.length, firstSeconds: frames[0].sourceSeconds, lastSeconds: frames.at(-1).sourceSeconds, sheets: sheets.length }));
} finally {
  server.closeAllConnections();
  server.close();
}
