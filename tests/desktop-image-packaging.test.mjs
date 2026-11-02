import assert from 'node:assert/strict';
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
});
