// Non-AI tone and color adjustments, computed in the browser. Each control runs from -100 to 100, and 0 changes nothing.
export type AdjustControl = { key: AdjustKey; label: string; low: string; high: string };
export type AdjustKey = 'brightness' | 'contrast' | 'highlights' | 'shadows' | 'whites' | 'blacks' | 'temperature' | 'tint' | 'vibrance' | 'saturation';
export type AdjustValues = Record<AdjustKey, number>;

export const lightControls: AdjustControl[] = [
  { key: 'brightness', label: 'Brightness', low: 'Darker', high: 'Brighter' },
  { key: 'contrast', label: 'Contrast', low: 'Flatter', high: 'Punchier' },
  { key: 'highlights', label: 'Highlights', low: 'Recover', high: 'Brighten' },
  { key: 'shadows', label: 'Shadows', low: 'Deepen', high: 'Lift' },
  { key: 'whites', label: 'Whites', low: 'Lower', high: 'Raise' },
  { key: 'blacks', label: 'Blacks', low: 'Deepen', high: 'Lift' },
];
export const colorControls: AdjustControl[] = [
  { key: 'temperature', label: 'Temperature', low: 'Cool', high: 'Warm' },
  { key: 'tint', label: 'Tint', low: 'Green', high: 'Magenta' },
  { key: 'vibrance', label: 'Vibrance', low: 'Muted', high: 'Vivid' },
  { key: 'saturation', label: 'Saturation', low: 'Gray', high: 'Vivid' },
];
export const adjustControls = [...lightControls, ...colorControls];

export const defaultAdjust = (): AdjustValues => Object.fromEntries(adjustControls.map(c => [c.key, 0])) as AdjustValues;
export const isIdentity = (values: AdjustValues) => adjustControls.every(c => !values[c.key]);

// Labels such as "Brightness +20" for every control that is not 0.
export function changedAdjustments(values: AdjustValues): string[] {
  return adjustControls.filter(c => values[c.key]).map(c => `${c.label} ${values[c.key] > 0 ? '+' : ''}${values[c.key]}`);
}

const clamp = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;
const smoothstep = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Adjusts RGBA pixel data in place. Tone controls move a pixel's luminance and shift all three channels by the same
// amount, so hues stay put. Each tone control is weighted to its own range of brightness.
export function adjustPixels(data: Uint8ClampedArray, values: AdjustValues): void {
  const v = Object.fromEntries(adjustControls.map(c => [c.key, (values[c.key] ?? 0) / 100])) as AdjustValues;
  const gamma = 2 ** -v.brightness;
  const contrast = v.contrast >= 0 ? 1 + v.contrast : 1 + v.contrast * 0.7;
  // Temperature trades red against blue. Tint trades green against red and blue (magenta).
  const gainR = (1 + 0.2 * v.temperature) * (1 + 0.08 * v.tint), gainG = 1 - 0.15 * v.tint, gainB = (1 - 0.2 * v.temperature) * (1 + 0.08 * v.tint);
  // White balance and brightness act on each channel alone, so they are precomputed for all 256 input values.
  const table = (gain: number) => Float64Array.from({ length: 256 }, (_, n) => gamma === 1 ? n / 255 * gain : clamp(n / 255 * gain) ** gamma);
  const tableR = table(gainR), tableG = table(gainG), tableB = table(gainB);
  for (let i = 0; i < data.length; i += 4) {
    let r = tableR[data[i]], g = tableG[data[i + 1]], b = tableB[data[i + 2]];
    const before = luma(r, g, b);
    let l = before;
    l = 0.5 + (l - 0.5) * contrast;
    l += 0.3 * v.highlights * smoothstep(0.5, 1, l);
    l += 0.3 * v.shadows * (1 - smoothstep(0, 0.5, l));
    l += 0.25 * v.whites * smoothstep(0.7, 1, l);
    l += 0.25 * v.blacks * (1 - smoothstep(0, 0.3, l));
    const shift = l - before;
    r += shift; g += shift; b += shift;
    // Saturation scales every color's distance from gray. Vibrance does the same, weighted towards dull colors.
    const gray = luma(r, g, b), chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const scale = Math.max(0, (1 + v.saturation) * (1 + v.vibrance * (1 - clamp(chroma))));
    data[i] = Math.round(clamp(gray + (r - gray) * scale) * 255);
    data[i + 1] = Math.round(clamp(gray + (g - gray) * scale) * 255);
    data[i + 2] = Math.round(clamp(gray + (b - gray) * scale) * 255);
  }
}

export const adjustLongSide = 2048;

// Decoded input pixels, scaled to at most adjustLongSide, kept per input so slider moves skip decoding.
const decoded = new Map<Blob, Promise<ImageData>>();
function decode(blob: Blob): Promise<ImageData> {
  let pixels = decoded.get(blob);
  if (!pixels) {
    pixels = (async () => {
      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(1, adjustLongSide / Math.max(bitmap.width, bitmap.height));
      const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      return context.getImageData(0, 0, canvas.width, canvas.height);
    })();
    decoded.set(blob, pixels);
    if (decoded.size > 8) decoded.delete(decoded.keys().next().value!);
  }
  return pixels;
}

// Renders an adjusted copy of an image in the browser, as a JPEG of at most adjustLongSide.
export async function renderAdjusted(blob: Blob, values: AdjustValues): Promise<{ blob: Blob; width: number; height: number }> {
  const source = await decode(blob);
  const pixels = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  adjustPixels(pixels.data, values);
  const canvas = new OffscreenCanvas(pixels.width, pixels.height);
  canvas.getContext('2d')!.putImageData(pixels, 0, 0);
  return { blob: await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 }), width: pixels.width, height: pixels.height };
}
