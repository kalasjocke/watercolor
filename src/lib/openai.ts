import { stepLabel, type Asset, type ImageProcessor, type Step } from './graph';
import { stylePrompt } from './presets';

// The browser calls the Vite dev-server proxy, which adds the API key. See vite.config.ts.
export const editsEndpoint = '/api/openai/v1/images/edits';
export const draftLongSide = 1024;

type Size = '1024x1024' | '1536x1024' | '1024x1536';

// The supported output size closest to the input's shape.
export function outputSize(width: number, height: number): Size {
  const ratio = width / height;
  return ratio > 1.2 ? '1536x1024' : ratio < 1 / 1.2 ? '1024x1536' : '1024x1024';
}

// Adjust steps run in the browser and never reach the API.
export const stepPrompt = (step: Step) => step.kind === 'prompt' ? step.prompt.trim() : step.kind === 'style' ? stylePrompt(step) : '';

// Scales an image so its long side is at most `longSide`, and encodes it as JPEG for upload.
export async function scaleImage(blob: Blob, longSide: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, longSide / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
}

type Options = { model: string; fetch?: typeof fetch; scale?: typeof scaleImage };

export function createOpenAIProcessor({ model, fetch: send = (...args) => fetch(...args), scale = scaleImage }: Options): ImageProcessor {
  return {
    async process({ input, step, quality }): Promise<Asset> {
      const prompt = stepPrompt(step);
      if (!prompt) throw new Error('Write a prompt first.');
      const size = outputSize(input.width, input.height);
      const form = new FormData();
      form.append('model', model);
      form.append('image[]', await scale(input.blob, draftLongSide), 'input.jpg');
      form.append('prompt', prompt);
      form.append('size', size);
      form.append('quality', quality === 'draft' ? 'low' : 'high');
      form.append('output_format', 'jpeg');
      const response = await send(editsEndpoint, { method: 'POST', body: form });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? `OpenAI returned status ${response.status}.`);
      const encoded: string | undefined = body?.data?.[0]?.b64_json;
      if (!encoded) throw new Error('OpenAI returned no image.');
      const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      const [width, height] = size.split('x').map(Number);
      return { id: crypto.randomUUID(), blob: new Blob([bytes], { type: 'image/jpeg' }), filename: `${stepLabel(step)} ${quality}.jpg`, width, height };
    },
  };
}
