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

## Runs and processing

A step only produces an image when you press Run. Each run is kept, and the step's picked run is the image its output card shows and passes to the next step. When a step's input or settings change after its picked run, the card is marked out of date and keeps its old image until you run it again. Runs are not part of undo history, but picking a run is.

The processing boundary is `ImageProcessor` in `src/lib/graph.ts`:

```ts
interface ImageProcessor { process(request: { input: Asset; step: Step; quality: 'draft' | 'final' }): Promise<Asset> }
```

It takes the input image and the step (a prompt or a style recipe) and returns the output image. `passThroughProcessor` returns the input unchanged, so a run copies its input image.

## Layout

- `src/lib/graph.ts`: graph types, connection rules, downstream image resolution, serialization.
- `src/lib/presets.ts`: style presets, their controls and defaults.
- `src/lib/storage.ts`: IndexedDB persistence.
- `src/useDocument.ts`: graph state with undo and redo.
- `src/Studio.tsx`: canvas, import, keyboard shortcuts and autosave.
- `src/components/`: node card, edge, inspector, toolbar, menus and viewer.

## License

MIT. See [LICENSE](LICENSE).
