import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotVoiceCallDuration } from '../src/web/voice-chat.tsx';
import { realtimeInputTranscriptText, upsertInputTranscript } from '../src/web/voice-transcript.ts';

test('voice call duration freezes the timestamp captured when hanging up', () => {
  assert.equal(snapshotVoiceCallDuration(1_000, 4_999, null), 3);
  assert.equal(snapshotVoiceCallDuration(1_000, 90_000, 3), 3);
});

test('voice call duration is non-negative and absent calls are not saved with elapsed time', () => {
  assert.equal(snapshotVoiceCallDuration(5_000, 4_000, null), 0);
  assert.equal(snapshotVoiceCallDuration(null, 99_000, null), 0);
});

test('realtime ASR deltas update one live user line and final text replaces the draft', () => {
  let lines = [] as ReturnType<typeof upsertInputTranscript>;
  let active = false;
  let partial = realtimeInputTranscriptText('Hello', ' wor');
  lines = upsertInputTranscript(lines, partial, active); active = true;
  partial = realtimeInputTranscriptText('Hello ', 'world');
  lines = upsertInputTranscript(lines, partial, active);
  assert.deepEqual(lines, [{ role: 'you', text: 'Hello world' }]);
  lines = upsertInputTranscript(lines, 'Hello world!', active); active = false;
  assert.deepEqual(lines, [{ role: 'you', text: 'Hello world!' }]);
  lines = upsertInputTranscript(lines, 'A second turn', active);
  assert.deepEqual(lines, [{ role: 'you', text: 'Hello world!' }, { role: 'you', text: 'A second turn' }]);
});

test('realtime ASR delta combines confirmed text and tentative stash with a bounded length', () => {
  assert.equal(realtimeInputTranscriptText('confirmed ', 'draft'), 'confirmed draft');
  assert.equal(realtimeInputTranscriptText(7, null), '');
  assert.equal(realtimeInputTranscriptText('x'.repeat(10_001), '' ).length, 10_000);
});
