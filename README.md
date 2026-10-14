# Watercolor

A local web app for exploring photo edits and art styles on an infinite canvas. Images are nodes. The steps between them are edges: a prompt step ("Remove the black car in the background") makes a new base image, and a style step applies one of six Japanese art style presets with adjustable settings.

Everything stays in the browser. Images, the graph, settings and the viewport are saved in IndexedDB.

## Setup

Requires Node 20 or later.

```sh
npm install
npm run dev        # http://127.0.0.1:5173
npm test           # graph, propagation and storage tests
npm run typecheck
npm run build
```

## Pass-through processing

No image is generated yet. Every output node shows its input image unchanged.

The boundary is `ImageProcessor` in `src/lib/graph.ts`:

```ts
interface ImageProcessor { process(inputAssetId: string, step: Step): string | Promise<string> }
```

It takes the input asset id and the step (a prompt or a style recipe) and returns the output asset id. `passThroughProcessor` returns the input id. A real adapter, for example OpenAI image editing for prompt steps, would store the generated image as an asset and return its id. `useProcessedImages` caches results per input and settings, and shows outputs as pending while a promise is unresolved.

A prompt step reaches the processor only when Generate is pressed (`appliedPrompt`), so typing a prompt never triggers generation. Style steps are processed whenever their settings change.

## Layout

- `src/lib/graph.ts`: graph types, connection rules, downstream image resolution, serialization.
- `src/lib/presets.ts`: style presets, their controls and defaults.
- `src/lib/storage.ts`: IndexedDB persistence.
- `src/useDocument.ts`: graph state with undo and redo.
- `src/Studio.tsx`: canvas, import, keyboard shortcuts and autosave.
- `src/components/`: node card, edge, inspector, toolbar, menus and viewer.
