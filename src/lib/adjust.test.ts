import { describe, expect, it } from 'vitest';
import { changedAdjustments, defaultAdjust, isIdentity, shaderUniforms } from './adjust';

describe('changedAdjustments', () => {
  it('labels the controls that are not 0, with their sign', () => {
    expect(changedAdjustments(defaultAdjust())).toEqual([]);
    expect(isIdentity(defaultAdjust())).toBe(true);
    const values = { ...defaultAdjust(), brightness: 20, tint: -15 };
    expect(changedAdjustments(values)).toEqual(['Brightness +20', 'Tint -15']);
    expect(isIdentity(values)).toBe(false);
  });
});

describe('shaderUniforms', () => {
  it('passes neutral values for the defaults', () => {
    expect(shaderUniforms(defaultAdjust())).toEqual({ gain: [1, 1, 1], gamma: 1, contrast: 1, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 0, vibrance: 0 });
  });
});
