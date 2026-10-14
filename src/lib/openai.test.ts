import { describe, expect, it } from 'vitest';
import { newPromptStep, newStyleStep, type Asset } from './graph';
import { createOpenAIProcessor, editsEndpoint, outputSize } from './openai';
import { stylePrompt } from './presets';

const input: Asset = { id: 'in', blob: new Blob(['photo'], { type: 'image/jpeg' }), filename: 'forest.jpg', width: 3000, height: 4000 };
const scale = async (blob: Blob, longSide: number) => new Blob([`scaled to ${longSide}`, await blob.text()]);
const imageBytes = 'drawn image';

function fakeFetch(response: { status?: number; body: unknown }) {
  const calls: { url: string; form: FormData }[] = [];
  const send = (async (url: string, init: RequestInit) => {
    calls.push({ url, form: init.body as FormData });
    return new Response(JSON.stringify(response.body), { status: response.status ?? 200 });
  }) as typeof fetch;
  return { send, calls };
}

describe('createOpenAIProcessor', () => {
  it('sends a scaled 1024px draft request for a prompt step and returns the image as a new asset', async () => {
    const { send, calls } = fakeFetch({ body: { data: [{ b64_json: btoa(imageBytes) }] } });
    const output = await createOpenAIProcessor({ model: 'gpt-image-2', fetch: send, scale })
      .process({ input, step: newPromptStep(' Remove the black car '), quality: 'draft' });
    const form = calls[0].form;
    expect(calls[0].url).toBe(editsEndpoint);
    expect(Object.fromEntries([...form.entries()].filter(([key]) => key !== 'image[]')))
      .toEqual({ model: 'gpt-image-2', prompt: 'Remove the black car', size: '1024x1536', quality: 'low', output_format: 'jpeg' });
    expect(await (form.get('image[]') as Blob).text()).toBe('scaled to 1024photo');
    expect(output).toMatchObject({ width: 1024, height: 1536, filename: 'Remove the black car draft.jpg' });
    expect(output.id).not.toBe(input.id);
    expect(await output.blob.text()).toBe(imageBytes);
  });
  it('sends the style template for a style step', async () => {
    const { send, calls } = fakeFetch({ body: { data: [{ b64_json: btoa(imageBytes) }] } });
    const step = newStyleStep('sumie');
    await createOpenAIProcessor({ model: 'm', fetch: send, scale }).process({ input, step, quality: 'draft' });
    expect(calls[0].form.get('prompt')).toBe(stylePrompt(step));
  });
  it('reports the API error message', async () => {
    const { send } = fakeFetch({ status: 400, body: { error: { message: 'Your organization must be verified.' } } });
    await expect(createOpenAIProcessor({ model: 'm', fetch: send, scale }).process({ input, step: newPromptStep('x'), quality: 'draft' }))
      .rejects.toThrow('Your organization must be verified.');
  });
  it('refuses an empty prompt without calling the API', async () => {
    const { send, calls } = fakeFetch({ body: {} });
    await expect(createOpenAIProcessor({ model: 'm', fetch: send, scale }).process({ input, step: newPromptStep('  '), quality: 'draft' }))
      .rejects.toThrow('Write a prompt first.');
    expect(calls).toHaveLength(0);
  });
});

describe('prompts', () => {
  it('picks the output size closest to the input shape', () => {
    expect([outputSize(4000, 3000), outputSize(3000, 4000), outputSize(1000, 1100), outputSize(1920, 1080)])
      .toEqual(['1536x1024', '1024x1536', '1024x1024', '1536x1024']);
  });
  it('describes the preset, every slider and the preserve switches', () => {
    const prompt = stylePrompt(newStyleStep('rinpa'));
    expect(prompt).toMatch(/^Repaint this photo in the style of the Japanese Rinpa school/);
    expect(prompt).toContain('- Stylization: 90 of 100, where 0 is faithful and 100 is interpretive.');
    expect(prompt).toContain('- Gold coverage: 60 of 100, where 0 is none and 100 is abundant.');
    expect(prompt).toContain('Keep faces recognizable, buildings and architecture accurate, the original composition and framing.');
  });
});
