import { describe, expect, it } from 'vitest';
import { adjustPixels, changedAdjustments, defaultAdjust, isIdentity, type AdjustValues } from './adjust';

// Runs one RGB pixel through adjustPixels and returns its new RGB values.
function adjust(rgb: [number, number, number], changes: Partial<AdjustValues>) {
  const data = new Uint8ClampedArray([...rgb, 255]);
  adjustPixels(data, { ...defaultAdjust(), ...changes });
  return [data[0], data[1], data[2]];
}
const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const spread = (rgb: number[]) => Math.max(...rgb) - Math.min(...rgb);
const gray = (v: number): [number, number, number] => [v, v, v];

describe('adjustPixels', () => {
  it('leaves pixels unchanged at the defaults', () => {
    for (const rgb of [[0, 0, 0], [255, 255, 255], [12, 200, 77], [128, 64, 250]] as [number, number, number][]) {
      expect(adjust(rgb, {})).toEqual(rgb);
    }
  });
  it('brightens midtones with brightness and keeps black and white fixed', () => {
    expect(lum(adjust(gray(128), { brightness: 50 }))).toBeGreaterThan(150);
    expect(lum(adjust(gray(128), { brightness: -50 }))).toBeLessThan(110);
    expect(adjust(gray(0), { brightness: 80 })).toEqual(gray(0));
    expect(adjust(gray(255), { brightness: -80 })).toEqual(gray(255));
  });
  it('spreads tones away from the middle with contrast, and pulls them in when negative', () => {
    expect(lum(adjust(gray(64), { contrast: 50 }))).toBeLessThan(64);
    expect(lum(adjust(gray(192), { contrast: 50 }))).toBeGreaterThan(192);
    expect(lum(adjust(gray(64), { contrast: -50 }))).toBeGreaterThan(64);
    expect(adjust(gray(128), { contrast: 80 })[0]).toBeCloseTo(128, -1);
  });
  it('limits highlights and shadows to their own tones', () => {
    expect(lum(adjust(gray(230), { highlights: -100 }))).toBeLessThan(215);
    expect(adjust(gray(40), { highlights: -100 })).toEqual(gray(40));
    expect(lum(adjust(gray(40), { shadows: 100 }))).toBeGreaterThan(70);
    expect(adjust(gray(230), { shadows: 100 })).toEqual(gray(230));
  });
  it('moves the brightest tones with whites and the darkest with blacks', () => {
    expect(lum(adjust(gray(220), { whites: 100 }))).toBeGreaterThan(235);
    expect(adjust(gray(100), { whites: 100 })).toEqual(gray(100));
    expect(lum(adjust(gray(30), { blacks: -100 }))).toBeLessThan(15);
    expect(adjust(gray(160), { blacks: -100 })).toEqual(gray(160));
  });
  it('turns colors gray at saturation -100 and stronger above 0', () => {
    expect(spread(adjust([200, 80, 40], { saturation: -100 }))).toBeLessThanOrEqual(1);
    expect(spread(adjust([160, 120, 100], { saturation: 50 }))).toBeGreaterThan(spread([160, 120, 100]));
  });
  it('boosts dull colors more than strong ones with vibrance', () => {
    const dull: [number, number, number] = [150, 130, 120], strong: [number, number, number] = [240, 40, 20];
    const dullGain = spread(adjust(dull, { vibrance: 100 })) / spread(dull);
    const strongGain = spread(adjust(strong, { vibrance: 100 })) / spread(strong);
    expect(dullGain).toBeGreaterThan(strongGain);
    expect(dullGain).toBeGreaterThan(1.5);
  });
  it('warms with temperature and shifts green against magenta with tint', () => {
    const [r, , b] = adjust(gray(128), { temperature: 60 });
    expect(r).toBeGreaterThan(b);
    const [cr, , cb] = adjust(gray(128), { temperature: -60 });
    expect(cb).toBeGreaterThan(cr);
    const [mr, mg] = adjust(gray(128), { tint: 60 });
    expect(mr).toBeGreaterThan(mg);
    const [gr, gg] = adjust(gray(128), { tint: -60 });
    expect(gg).toBeGreaterThan(gr);
  });
  it('keeps the alpha channel', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 77]);
    adjustPixels(data, { ...defaultAdjust(), brightness: 40, saturation: 30 });
    expect(data[3]).toBe(77);
  });
});

describe('changedAdjustments', () => {
  it('labels the controls that are not 0, with their sign', () => {
    expect(changedAdjustments(defaultAdjust())).toEqual([]);
    expect(isIdentity(defaultAdjust())).toBe(true);
    const values = { ...defaultAdjust(), brightness: 20, tint: -15 };
    expect(changedAdjustments(values)).toEqual(['Brightness +20', 'Tint -15']);
    expect(isIdentity(values)).toBe(false);
  });
});
