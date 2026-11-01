import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopScreenLayout, desktopScreenBounds, parseDesktopResolution, parseDesktopScreenSlots } from '../deploy/desktop/desktop-screen-layout.mjs';

test('desktop layout allocates fixed non-overlapping per-Bot screen regions', () => {
  const layout = createDesktopScreenLayout('1440x900', 8);
  assert.deepEqual(layout, { width: 1440, height: 900, slots: 8, stride: 1472, virtualWidth: 11776, virtualHeight: 900 });
  assert.deepEqual(desktopScreenBounds(layout, 0), { slot: 0, left: 0, top: 0, width: 1440, height: 900 });
  assert.deepEqual(desktopScreenBounds(layout, 7), { slot: 7, left: 10304, top: 0, width: 1440, height: 900 });
  assert.throws(() => desktopScreenBounds(layout, 8), /Invalid desktop screen slot/);
});

test('desktop screen layout validates display sizes and configured slot limits', () => {
  assert.deepEqual(parseDesktopResolution('1920x1080'), { width: 1920, height: 1080 });
  assert.equal(parseDesktopScreenSlots('8'), 8);
  assert.throws(() => parseDesktopResolution('480x400'), /supported range/);
  assert.throws(() => parseDesktopResolution('bad'), /Invalid desktop resolution/);
  assert.throws(() => parseDesktopScreenSlots('17'), /between 1 and 16/);
  assert.throws(() => createDesktopScreenLayout('3840x2160', 16), /X11 display limit/);
});
