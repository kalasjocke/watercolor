export type Control = { key: string; label: string; low: string; high: string };
export const sharedControls: Control[] = [
  { key: 'stylization', label: 'Stylization', low: 'Faithful', high: 'Interpretive' },
  { key: 'detail', label: 'Detail', low: 'Loose', high: 'Fine' },
  { key: 'color', label: 'Color intensity', low: 'Muted', high: 'Vivid' },
  { key: 'contrast', label: 'Contrast', low: 'Soft', high: 'Bold' },
  { key: 'texture', label: 'Texture', low: 'Smooth', high: 'Pronounced' },
  { key: 'fade', label: 'Edge fade', low: 'None', high: 'Strong' },
];
export const preserveLabels = { faces: 'Faces', architecture: 'Architecture', composition: 'Composition', colors: 'Original colors' };
export type PreserveKey = keyof typeof preserveLabels;
const control = (key: string, label: string, low = 'Subtle', high = 'Strong'): Control => ({ key, label, low, high });
export const presets = {
  watercolor: { prompt: 'Repaint this photo as a hand-painted watercolor background from a Japanese animated film: luminous transparent washes, soft edges, delicate lines and warm storybook light.', name: 'Ghibli-inspired watercolor', short: 'Watercolor', japanese: '水彩', description: 'Luminous washes, delicate lines, and a little storybook wonder.', color: '#6d9fbb', controls: [control('spread','Pigment spread','Precise','Flowing'), control('outlines','Outline strength'), control('warmth','Light warmth','Cool','Warm')], defaults: [65,65,60,40,55,15,60,30,65] },
  shinhanga: { prompt: 'Repaint this photo as an early 20th-century Japanese shin-hanga woodblock print: atmospheric color gradients, quiet light, layered pigment and fine carved outlines.', name: 'Shin-hanga', short: 'Shin-hanga', japanese: '新版画', description: 'Atmospheric color prints, quiet light, and layered pigment.', color: '#668b91', controls: [control('outlines','Outline strength'),control('gradients','Gradient softness','Crisp','Soft'),control('grain','Print grain')], defaults: [65,75,45,55,65,0,60,75,55] },
  ukiyoe: { prompt: 'Repaint this photo as an Edo-period Japanese ukiyo-e woodblock print: bold contour lines, flat graphic shapes, stylized patterns and a limited palette.', name: 'Ukiyo-e', short: 'Ukiyo-e', japanese: '浮世絵', description: 'Bold contours, graphic shapes, and a beautifully limited palette.', color: '#b97756', controls: [control('palette','Palette simplicity','Many colors','Few colors'),control('contours','Contour thickness','Fine','Bold'),control('patterns','Pattern stylization')], defaults: [85,55,70,75,55,0,75,65,70] },
  sumie: { prompt: 'Repaint this photo as a Japanese sumi-e ink wash painting on paper: expressive black ink brushwork, varied ink tones, generous empty space and only the essential gestures.', name: 'Sumi-e', short: 'Sumi-e', japanese: '墨絵', description: 'Expressive ink, generous empty space, and the essential gesture.', color: '#7c7d82', controls: [control('ink','Ink density','Light','Dense'),control('brush','Brush looseness','Precise','Loose'),control('space','Empty space','Little','Generous')], defaults: [80,35,0,65,45,35,65,75,60] },
  nihonga: { prompt: 'Repaint this photo as a Japanese nihonga painting: fine mineral pigments on paper, graceful contours, soft layered color and a contemplative mood.', name: 'Nihonga', short: 'Nihonga', japanese: '日本画', description: 'Fine mineral pigments, graceful contours, and a contemplative mood.', color: '#8c9c75', controls: [control('grain','Pigment grain'),control('layers','Layer richness','Light','Rich'),control('contours','Contour delicacy','Bold','Delicate')], defaults: [55,80,40,35,65,5,70,65,80] },
  rinpa: { prompt: 'Repaint this photo in the style of the Japanese Rinpa school: decorative stylized nature, rhythmic patterns, flat areas of color and touches of gold leaf.', name: 'Rinpa', short: 'Rinpa', japanese: '琳派', description: 'Decorative nature, rhythmic patterns, and touches of gold.', color: '#b39856', controls: [control('gold','Gold coverage','None','Abundant'),control('simplification','Decorative simplification','Detailed','Simple'),control('patterns','Pattern density','Sparse','Dense')], defaults: [90,45,80,65,65,0,60,75,65] },
};
export type PresetId = keyof typeof presets;
export type Settings = { values: Record<string, number>; preserve: Record<PreserveKey, boolean> };
export type Recipe = { name: string; preset: PresetId; settings: Partial<Record<PresetId, Settings>> };
export function defaultSettings(id: PresetId): Settings {
  const preset = presets[id];
  return { values: Object.fromEntries([...sharedControls, ...preset.controls].map((c,i) => [c.key,preset.defaults[i]])), preserve: { faces: true, architecture: true, composition: true, colors: false } };
}
export function newRecipe(preset: PresetId = 'watercolor'): Recipe { return { name: presets[preset].short, preset, settings: { [preset]: defaultSettings(preset) } }; }
export function getSettings(recipe: Recipe): Settings { return recipe.settings[recipe.preset] ?? defaultSettings(recipe.preset); }

const preserveText: Record<PreserveKey, string> = { faces: 'faces recognizable', architecture: 'buildings and architecture accurate', composition: 'the original composition and framing', colors: 'the original colors' };

// The instruction sent to the image model for a style step: the preset's template, then each slider and preserve switch.
export function stylePrompt(recipe: Recipe): string {
  const preset = presets[recipe.preset], settings = getSettings(recipe);
  const lines = [...sharedControls, ...preset.controls].map(c => `- ${c.label}: ${settings.values[c.key]} of 100, where 0 is ${c.low.toLowerCase()} and 100 is ${c.high.toLowerCase()}.`);
  const keep = (Object.keys(preserveText) as PreserveKey[]).filter(key => settings.preserve[key]).map(key => preserveText[key]);
  return [preset.prompt, '', 'Settings:', ...lines, ...(keep.length ? ['', `Keep ${keep.join(', ')}.`] : [])].join('\n');
}
