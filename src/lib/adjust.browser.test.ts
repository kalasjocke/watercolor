// Runs in Chrome (Vitest browser mode), because the adjustments are a WebGL2 shader.
import { describe, expect, it } from 'vitest';
import { defaultAdjust, gpuAdjuster, renderAdjusted, type AdjustValues } from './adjust';

// Draws a row of RGB pixels through the shader and returns the adjusted RGB values.
function adjust(pixels: [number, number, number][], changes: Partial<AdjustValues>) {
  const data = new Uint8ClampedArray(pixels.flatMap(p => [...p, 255]));
  const gpu = gpuAdjuster();
  gpu.draw(new ImageData(data, pixels.length, 1), { ...defaultAdjust(), ...changes });
  const out = gpu.pixels();
  return pixels.map((_, i) => [out[i * 4], out[i * 4 + 1], out[i * 4 + 2]]);
}
const one = (rgb: [number, number, number], changes: Partial<AdjustValues>) => adjust([rgb], changes)[0];
const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const spread = (rgb: number[]) => Math.max(...rgb) - Math.min(...rgb);
const gray = (v: number): [number, number, number] => [v, v, v];
const near = (actual: number[], expected: number[], tolerance = 1) => actual.forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThanOrEqual(tolerance));

describe('GPU adjustments', () => {
  it('leaves pixels unchanged at the defaults', () => {
    const pixels: [number, number, number][] = [[0, 0, 0], [255, 255, 255], [12, 200, 77], [128, 64, 250]];
    adjust(pixels, {}).forEach((rgb, i) => near(rgb, pixels[i]));
  });
  it('brightens midtones with brightness and keeps black and white fixed', () => {
    expect(lum(one(gray(128), { brightness: 50 }))).toBeGreaterThan(150);
    expect(lum(one(gray(128), { brightness: -50 }))).toBeLessThan(110);
    near(one(gray(0), { brightness: 80 }), gray(0));
    near(one(gray(255), { brightness: -80 }), gray(255));
  });
  it('spreads tones away from the middle with contrast, and pulls them in when negative', () => {
    expect(lum(one(gray(64), { contrast: 50 }))).toBeLessThan(64);
    expect(lum(one(gray(192), { contrast: 50 }))).toBeGreaterThan(192);
    expect(lum(one(gray(64), { contrast: -50 }))).toBeGreaterThan(64);
    near(one(gray(128), { contrast: 80 }), gray(128), 2);
  });
  it('limits highlights and shadows to their own tones', () => {
    expect(lum(one(gray(230), { highlights: -100 }))).toBeLessThan(215);
    near(one(gray(40), { highlights: -100 }), gray(40));
    expect(lum(one(gray(40), { shadows: 100 }))).toBeGreaterThan(70);
    near(one(gray(230), { shadows: 100 }), gray(230));
  });
  it('moves the brightest tones with whites and the darkest with blacks', () => {
    expect(lum(one(gray(220), { whites: 100 }))).toBeGreaterThan(235);
    near(one(gray(100), { whites: 100 }), gray(100));
    expect(lum(one(gray(30), { blacks: -100 }))).toBeLessThan(15);
    near(one(gray(160), { blacks: -100 }), gray(160));
  });
  it('turns colors gray at saturation -100 and stronger above 0', () => {
    expect(spread(one([200, 80, 40], { saturation: -100 }))).toBeLessThanOrEqual(1);
    expect(spread(one([160, 120, 100], { saturation: 50 }))).toBeGreaterThan(spread([160, 120, 100]));
  });
  it('boosts dull colors more than strong ones with vibrance', () => {
    const dull: [number, number, number] = [150, 130, 120], strong: [number, number, number] = [240, 40, 20];
    const [dullOut, strongOut] = adjust([dull, strong], { vibrance: 100 });
    expect(spread(dullOut) / spread(dull)).toBeGreaterThan(spread(strongOut) / spread(strong));
    expect(spread(dullOut) / spread(dull)).toBeGreaterThan(1.5);
  });
  it('warms with temperature and shifts green against magenta with tint', () => {
    const [warm, cool, magenta, green] = [{ temperature: 60 }, { temperature: -60 }, { tint: 60 }, { tint: -60 }].map(c => one(gray(128), c));
    expect(warm[0]).toBeGreaterThan(warm[2]);
    expect(cool[2]).toBeGreaterThan(cool[0]);
    expect(magenta[0]).toBeGreaterThan(magenta[1]);
    expect(green[1]).toBeGreaterThan(green[0]);
  });
  it('keeps each pixel in place', () => {
    // A 2 by 2 image with a different color in each corner.
    const corners = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]];
    const gpu = gpuAdjuster();
    gpu.draw(new ImageData(new Uint8ClampedArray(corners.flatMap(c => [...c, 255])), 2, 2), defaultAdjust());
    const out = gpu.pixels();
    corners.forEach((c, i) => near([out[i * 4], out[i * 4 + 1], out[i * 4 + 2]], c));
  });
  it('renders an adjusted JPEG the right way up and at most 2048px', async () => {
    // A tall image: red on top, blue below.
    const canvas = new OffscreenCanvas(1000, 3000), context = canvas.getContext('2d')!;
    context.fillStyle = '#f00'; context.fillRect(0, 0, 1000, 1500);
    context.fillStyle = '#00f'; context.fillRect(0, 1500, 1000, 1500);
    const output = await renderAdjusted(await canvas.convertToBlob({ type: 'image/png' }), { ...defaultAdjust(), brightness: 30 });
    expect([output.width, output.height]).toEqual([683, 2048]);
    expect(output.blob.type).toBe('image/jpeg');
    const bitmap = await createImageBitmap(output.blob), check = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
    check.drawImage(bitmap, 0, 0);
    const [top, bottom] = [check.getImageData(340, 100, 1, 1).data, check.getImageData(340, 1900, 1, 1).data];
    expect(top[0]).toBeGreaterThan(200);
    expect(top[2]).toBeLessThan(60);
    expect(bottom[2]).toBeGreaterThan(200);
    expect(bottom[0]).toBeLessThan(60);
  });
});
