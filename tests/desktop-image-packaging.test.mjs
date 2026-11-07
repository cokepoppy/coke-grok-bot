import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

const dockerfile = fs.readFileSync(new URL('../deploy/desktop/Dockerfile', import.meta.url), 'utf8');
const dockerignore = fs.readFileSync(new URL('../deploy/desktop/Dockerfile.dockerignore', import.meta.url), 'utf8');

test('desktop image copies the Bot screen manager and real desktop I/O modules beside the worker', () => {
  assert.match(dockerfile, /COPY --chmod=0644 deploy\/desktop\/bot-screen-pages\.mjs \/opt\/coke-dots\/bot-screen-pages\.mjs/);
  assert.match(dockerignore, /^!deploy\/desktop\/bot-screen-pages\.mjs$/m);
  assert.match(dockerfile, /COPY --chmod=0644 deploy\/desktop\/desktop-screen-layout\.mjs \/opt\/coke-dots\/desktop-screen-layout\.mjs/);
  assert.match(dockerignore, /^!deploy\/desktop\/desktop-screen-layout\.mjs$/m);
  assert.match(dockerfile, /COPY --chmod=0644 deploy\/desktop\/desktop-input\.mjs \/opt\/coke-dots\/desktop-input\.mjs/);
  assert.match(dockerignore, /^!deploy\/desktop\/desktop-input\.mjs$/m);
  assert.match(dockerfile, /COPY --chmod=0644 deploy\/desktop\/shared-computer-root\.mjs \/opt\/coke-dots\/shared-computer-root\.mjs/);
  assert.match(dockerignore, /^!deploy\/desktop\/shared-computer-root\.mjs$/m);
  assert.match(dockerfile, /COPY --chmod=0644 deploy\/desktop\/active-tab-extension\/manifest\.json \/opt\/coke-grok\/active-tab-extension\/manifest\.json/);
  assert.match(dockerfile, /COPY --chmod=0644 deploy\/desktop\/active-tab-extension\/service-worker\.js \/opt\/coke-grok\/active-tab-extension\/service-worker\.js/);
  assert.match(dockerfile, /COPY --chmod=0644 deploy\/desktop\/active-tab-extension\/runtime-config\.js \/opt\/coke-grok\/active-tab-extension\/runtime-config\.js/);
  assert.match(dockerignore, /^!deploy\/desktop\/active-tab-extension\/manifest\.json$/m);
  assert.match(dockerignore, /^!deploy\/desktop\/active-tab-extension\/service-worker\.js$/m);
  assert.match(dockerignore, /^!deploy\/desktop\/active-tab-extension\/runtime-config\.js$/m);
  assert.match(fs.readFileSync(new URL('../deploy/desktop/start-desktop.sh', import.meta.url), 'utf8'), /--load-extension=\/opt\/coke-grok\/active-tab-extension/);
  assert.match(fs.readFileSync(new URL('../deploy/desktop/active-tab-extension/service-worker.js', import.meta.url), 'utf8'), /importScripts\('runtime-config\.js'\)/);
  assert.match(fs.readFileSync(new URL('../deploy/desktop/active-tab-extension/service-worker.js', import.meta.url), 'utf8'), /authorization: `Bearer \$\{self\.COKE_GROK_ACTIVE_TAB_BRIDGE_TOKEN\}`/);
  const manifest = JSON.parse(fs.readFileSync(new URL('../deploy/desktop/active-tab-extension/manifest.json', import.meta.url), 'utf8'));
  const extensionId = [...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)].map(nibble => String.fromCharCode(97 + Number.parseInt(nibble, 16))).join('');
  assert.ok(fs.readFileSync(new URL('../deploy/desktop/computer-worker.mjs', import.meta.url), 'utf8').includes(`chrome-extension://${extensionId}`));
});
