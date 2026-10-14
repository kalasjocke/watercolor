# Watercolor

A local web app for exploring photo edits and art styles on an infinite canvas. Images are nodes. The steps between them are edges: a prompt step ("Remove the black car in the background") makes a new base image, and a style step applies one of six Japanese art style presets with adjustable settings.

Everything stays in the browser. Images, the graph, settings and the viewport are saved in IndexedDB.

## Setup

Requires Node 20 or later.

```sh
npm install
npm run dev        # http://127.0.0.1:5173
npm test           # unit tests in Node, and GPU tests in your installed Chrome
npm run typecheck
npm run build
```

## OpenAI drafts

Without a key, the app runs in preview mode and a run copies its input image. To make real drafts:

1. Create an API key at platform.openai.com and add credit. OpenAI may ask you to verify your organization before its GPT Image models can be used.
2. Copy `.env.example` to `.env.local` and set `OPENAI_API_KEY`. `OPENAI_IMAGE_MODEL` defaults to `gpt-image-2.5-sunburst`, which OpenAI recommends for precise editing.
3. Restart `npm run dev`. The canvas controls show "OpenAI drafts".

Each run sends the input image, scaled to 1024px on its long side, to the image edits endpoint at low quality and stores the result in IndexedDB. A low-quality draft costs roughly 1 to 5 cents, most of it for the uploaded image. The key stays on the Vite dev server, which adds it to requests under `/api/openai`; the browser bundle only learns whether a key is set. The proxy exists only while `npm run dev` or `npm run preview` is running.

## Runs and processing

A step only produces an image when you press Run. Each run is kept, and the step's picked run is the image its output card shows and passes to the next step. When a step's input or settings change after its picked run, the card is marked out of date and keeps its old image until you run it again. Runs are not part of undo history, but picking a run is.

Adjust steps are the exception. They change brightness, contrast, highlights, shadows, whites, blacks, temperature, tint, vibrance and saturation in the browser, without AI, and update as you drag. Their images are computed on the GPU, as a WebGL2 shader, at up to 2048px and never stored; an adjusted image's id names its input and settings, so steps after it go out of date when a slider moves. The shader is in `src/lib/adjust.ts`.

The processing boundary is `ImageProcessor` in `src/lib/graph.ts`:

```ts
interface ImageProcessor { process(request: { input: Asset; step: Step; quality: 'draft' | 'final' }): Promise<Asset> }
```

It takes the input image and the step (a prompt or a style recipe) and returns the output image. `passThroughProcessor` returns the input unchanged. `createOpenAIProcessor` in `src/lib/openai.ts` calls OpenAI. Style steps send a prompt built from the preset's template in `src/lib/presets.ts` and the slider values.

## Layout

- `src/lib/graph.ts`: graph types, connection rules, downstream image resolution, serialization.
- `src/lib/presets.ts`: style presets, their controls and defaults.
- `src/lib/storage.ts`: IndexedDB persistence.
- `src/useDocument.ts`: graph state with undo and redo.
- `src/Studio.tsx`: canvas, import, keyboard shortcuts and autosave.
- `src/components/`: node card, edge, inspector, toolbar, menus and viewer.

## License

MIT. See [LICENSE](LICENSE).
