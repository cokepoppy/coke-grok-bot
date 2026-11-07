import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = readFileSync(new URL('../deploy/vps/grok-bot.locations.conf', import.meta.url), 'utf8');
const grokBotLocation = config.match(/location \^~ \/grok-bot\/ \{([\s\S]*?)\n\}/)?.[1];

test('VPS Grok Bot proxy forwards WebSocket upgrades for computer takeover', () => {
  assert.ok(grokBotLocation, 'expected a /grok-bot/ proxy location');
  assert.match(grokBotLocation, /^\s*proxy_http_version 1\.1;$/m);
  assert.match(grokBotLocation, /^\s*proxy_set_header Upgrade \$http_upgrade;$/m);
  assert.match(grokBotLocation, /^\s*proxy_set_header Connection "upgrade";$/m);
  assert.match(grokBotLocation, /^\s*proxy_read_timeout 3600s;$/m);
  assert.match(grokBotLocation, /^\s*proxy_send_timeout 3600s;$/m);
});
