import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicUrl } from '../src/server/public-url.ts';

test('public URL preserves a valid prefix and rejects ambiguous paths', () => {
  assert.equal(parsePublicUrl('https://example.test/grok-bot/').baseUrl, 'https://example.test/grok-bot');
  assert.equal(parsePublicUrl('http://127.0.0.1:3000/').prefix, '');
  for (const value of ['https://example.test//', 'https://example.test/a//b', 'https://example.test/%2F', 'http://example.test/', 'https://example.test/?x=1']) assert.throws(() => parsePublicUrl(value));
});
