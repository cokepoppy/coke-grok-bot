const maxScreenSlots = 16;
const maxX11Dimension = 32_767;

export function parseDesktopResolution(value = '1440x900') {
  if (typeof value !== 'string' || !/^\d{3,4}x\d{3,4}$/.test(value)) throw new Error('Invalid desktop resolution');
  const [width, height] = value.split('x').map(Number);
  if (width < 640 || width > 3_840 || height < 480 || height > 2_160) throw new Error('Desktop resolution is outside the supported range');
  return { width, height };
}

export function parseDesktopScreenSlots(value = '8') {
  if (typeof value !== 'string' || !/^(?:[1-9]|1[0-6])$/.test(value)) throw new Error(`COKE_DESKTOP_SCREEN_SLOTS must be between 1 and ${maxScreenSlots}`);
  return Number(value);
}

export function createDesktopScreenLayout(resolution = '1440x900', slots = 8) {
  const { width, height } = typeof resolution === 'string' ? parseDesktopResolution(resolution) : resolution;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 640 || height < 480) throw new Error('Invalid desktop screen size');
  if (!Number.isSafeInteger(slots) || slots < 1 || slots > maxScreenSlots) throw new Error(`Desktop screen slots must be between 1 and ${maxScreenSlots}`);
  const stride = width + 32;
  const virtualWidth = stride * slots;
  if (virtualWidth > maxX11Dimension || height > maxX11Dimension) throw new Error('Desktop screen layout exceeds the X11 display limit');
  return Object.freeze({ width, height, slots, stride, virtualWidth, virtualHeight: height });
}

export function desktopScreenBounds(layout, slot) {
  if (!Number.isSafeInteger(slot) || slot < 0 || slot >= layout.slots) throw new Error('Invalid desktop screen slot');
  const left = slot * layout.stride;
  return { slot, left, top: 0, width: layout.width, height: layout.height };
}
