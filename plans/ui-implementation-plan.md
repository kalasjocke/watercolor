# Watercolor UI implementation plan

Build Watercolor, a local web app for exploring photo transformations on an infinite canvas.

The first version implements the complete editing UI and graph behavior. It has two kinds of steps: style steps, which apply an art style, and prompt steps, which apply a written edit such as "Remove the black car in the background" and produce a new base image. Image processing is a pass-through for both: output nodes display unchanged copies of their input images. No backend or AI integration is required. Prompt steps will later call the OpenAI image editing API.

## 1. Stack and appearance

Keep the stack minimal. Start with React, TypeScript, Vite, React Flow, and Vitest for the focused tests. Use plain CSS with custom properties for the colors below, React state for the store, and the browser's IndexedDB API for persistence.

Add a dependency only when a feature needs it and the plain version proves awkward, and note the reason in the commit. Likely candidates, in rough order:

- A slider and dialog library (Radix or shadcn/ui), if native range inputs and `<dialog>` cannot meet the gesture and accessibility requirements.
- An icon set (Lucide), once there are more icons than a few inline SVGs.
- A small IndexedDB wrapper (`idb`), if the raw API makes the storage code hard to read.
- A state library (Zustand), if undo/redo or the inspector makes prop passing and context unwieldy.
- Tailwind CSS, only if the plain CSS grows hard to maintain.

Create a calm, polished desktop interface:

- Pale gray dotted canvas.
- White image cards and panels.
- Blue accent, approximately `#2563EB`.
- Blue selected borders, connection highlights, primary buttons, and slider tracks.
- Subtle shadows, rounded corners, restrained typography.
- Images dominate the visual experience.

## 2. Screen layout

- Top toolbar: Watercolor name, editable project name, undo and redo, Import images button. Autosave runs silently and shows a message only when a save fails.
- Main area: infinite canvas with a right-hand settings inspector approximately 320px wide.
- Bottom-left canvas controls: zoom out, zoom in, fit all, and preview-mode indicator.
- On narrow screens, show the inspector as a dismissible sheet.

Example graph:

```text
                                                                     +-- Watercolor --> Image A -- Softer washes --> Image C
Original image -- "Remove the black car in the background" --> Edit --+
                                                                     +-- Shin-hanga --> Image B
```

Nodes hold images; edges hold processing instructions. Clicking an edge or its badge opens the inspector.

## 3. Graph model

- Original nodes reference uploaded assets.
- Output nodes receive an image through one incoming edge. There are two kinds:
  - Edit nodes are the output of a prompt step. They act as a new base image.
  - Variation nodes are the output of a style step.
- Edges have a kind, `prompt` or `style`, set when the edge is created.
- A prompt edge stores a step name and the prompt text.
- A style edge stores its style and parameters.
- Each node can have multiple outgoing edges of either kind. For example, an edit node can feed two style steps, and a variation can feed a further prompt step.
- Output nodes can feed further output nodes.
- Reject self-connections, cycles, and a second incoming edge.
- Original nodes cannot receive incoming edges.

Keep source assets, graph data, and processing logic separate. Multiple nodes may reference the same asset without duplicating its bytes.

## 4. Image nodes

Each node includes a thumbnail, editable name, Original, Edit or Variation badge, image dimensions, connection handles, overflow menu, and two actions: Edit with prompt and Create variation.

Use a consistent card width around 260px. Preserve the image aspect ratio and constrain preview height without cropping.

Click selects a node. Double-click the preview to open a larger image viewer.

Overflow actions: rename, edit with prompt, create variation, delete. Output nodes also support Duplicate step, copying their incoming step (prompt or style settings) into a new sibling branch.

## 5. Creating and connecting variations

Primary flow:

1. Upload or drop an image onto the canvas.
2. Click Create variation on its node.
3. Create an output node to its right with a processing edge.
4. Automatically select the new edge and open its settings.
5. Display the unchanged input image in the output.

Prompt flow:

1. Click Edit with prompt on any node.
2. Create an edit node to its right with a prompt edge.
3. Automatically select the new edge and focus its prompt field in the inspector.
4. Display the unchanged input image in the edit node.
5. Click Create variation on the edit node, twice, to branch it into two styles.

Also support dragging from an output handle into empty canvas space. Dropping there opens a small menu to choose Edit with prompt or Create variation.

Use curved edges with direction arrows and small clickable badges. Style badges show the style name. Prompt badges show a text icon and the step name, which defaults to the first few words of the prompt, or "New prompt" while the prompt is empty. Selected edges and badges turn blue. Keep full sliders and the prompt text in the inspector, rather than along edges.

## 6. Processing inspector

When a prompt edge is selected, show:

- Editable step name.
- Source to destination names.
- A multi-line prompt field with placeholder text, for example "Remove the black car in the background".
- Example prompt chips that fill the field: remove an object, change the weather, change the time of day.
- A Generate button. In this version it saves the prompt and shows the input image unchanged.
- Status: Preview only — image editing is not connected.

Saving prompt text works like a slider drag: typing updates the saved configuration, and one editing session (focus to blur) is one undo operation. An empty prompt is allowed and shows a hint on the edge badge.

When a style edge is selected, show:

- Editable step name.
- Source to destination names.
- Style preset selector.
- Shared sliders and style-specific sliders.
- Preservation switches.
- Reset settings button.
- Status: Preview only — image processing is not connected.

Shared sliders use 0–100 ranges, visible numeric values, and descriptive endpoints:

| Control | Low | High |
| --- | --- | --- |
| Stylization | Faithful | Interpretive |
| Detail | Loose | Fine |
| Color intensity | Muted | Vivid |
| Contrast | Soft | Bold |
| Texture | Smooth | Pronounced |
| Edge fade | None | Strong |

Style-specific controls:

| Preset | Controls |
| --- | --- |
| Ghibli-inspired watercolor | Pigment spread, outline strength, light warmth |
| Shin-hanga | Outline strength, gradient softness, print grain |
| Ukiyo-e | Palette simplicity, contour thickness, pattern stylization |
| Sumi-e | Ink density, brush looseness, empty space |
| Nihonga | Pigment grain, layer richness, contour delicacy |
| Rinpa | Gold coverage, decorative simplification, pattern density |

Preservation switches: faces, architecture, composition, original colors.

Store preset definitions and defaults centrally. Remember each edge's settings for each preset when switching styles. Define sensible distinct defaults.

Sliders update saved configuration immediately. Do not apply CSS filters or pretend to generate an image.

When a node is selected, show its name, dimensions, original filename, and actions. When nothing is selected, show brief canvas instructions.

## 7. Canvas interactions

Support draggable nodes, background-drag or Space-drag panning, wheel/trackpad zoom, zoom controls, fit all, multi-selection, deletion, and undo/redo for graph and settings changes. Escape dismisses menus or clears selection.

Slider gestures must not drag or pan the canvas. Group one slider drag into one undo operation. Avoid triggering deletion shortcuts while typing in an input.

## 8. Pass-through processing

Create a replaceable processor interface that receives the input asset and the edge's step: either a prompt or a style recipe. Initially it returns the input asset unchanged for both kinds. Make the interface asynchronous so a later OpenAI image editing adapter for prompt steps can return a new asset without changing the graph code. Outputs that are waiting for a result should be able to show a pending state, even though the pass-through resolves at once.

Changing a prompt or connection settings updates configuration while its output continues showing the same image. Reconnecting a step updates its output and all downstream outputs to reference the new upstream image.

Deleting a node removes its incident edges but retains surviving downstream nodes. Outputs without a valid input show a Connect an input placeholder. Propagate missing-input status downstream.

## 9. Persistence and import

Autosave uploaded image blobs, nodes and positions, edges with their prompts and settings, project name, and canvas viewport in IndexedDB. When prompt steps start producing images, store the generated blobs as assets like uploads.

Reconstruct object URLs after loading; do not persist temporary blob URLs. Release unused object URLs appropriately.

Accept JPEG, PNG, and WebP. Show helpful errors for unsupported or unreadable files. HEIC conversion is future scope.

Provide an empty state with Import images and drag-and-drop guidance. Surface storage failures without losing the current in-memory project.

## 10. Build sequence

1. Scaffold the standalone app and blue-accented interface.
2. Implement image import, canvas navigation, and image nodes.
3. Add branching connections, prompt steps, preset configuration, and settings inspector.
4. Add pass-through processor, downstream propagation, persistence, and undo/redo.
5. Verify the complete import, prompt, branch, adjust, and reload workflow.

## 11. Scope and acceptance criteria

Keep this version local. Exclude accounts, publishing, AI calls (including the OpenAI API), masking, and brush-based object-removal tools. Prompt steps record the edit request; they do not change the image yet.

Complete when:

- Importing an image creates an original node.
- A prompt step on an original creates an edit node that shows the original image.
- Two style steps from an edit node form independently editable branches.
- Variations can be chained, and prompt and style steps can be mixed in one chain.
- All six style presets expose correct controls.
- Every connected output displays the unchanged upstream image.
- Invalid connections are rejected with clear feedback.
- Reloading restores images, graph, prompts, settings, and viewport.
- Undo/redo works for creation, deletion, movement, prompts, and settings.
- Canvas and slider gestures do not interfere.
- Production build and TypeScript checks pass.

Add focused tests for graph validation, downstream propagation, and persistence serialization. Include a README with setup instructions and a description of the pass-through processing boundary.

## 12. Next version: runs and 1024px drafts

The first version is built. The next version connects real image generation at draft size, so there is something to play with. It changes sections 6, 8 and 11 as described here. Full-quality finals follow in a later version (section 13).

### Runs

- Steps stay on their edges, and runs are keyed by the edge id. This needs no change to the save format. Moving steps into their own list can wait until a step needs more than one input, such as a mask or a reference image.
- Each step keeps every run, newest first. A run stores its id, the input asset id, the settings it used, its quality (`draft` or `final`), its status (pending, done or failed with the error message), its output asset id, and when it ran. Each run produces one image.
- Each step has one picked run. The picked run's image is the step's output and feeds the steps after it. A new run is picked automatically when it finishes. Picking another run is an undoable change.
- Earlier runs are kept, never replaced. The inspector shows them as a strip of thumbnails to pick from.

### Running steps

- Steps run only when the user presses Run, for both prompt and style steps. Editing a prompt or moving a slider no longer processes anything. Run replaces the Generate button.
- A step's output is out of date when its input image or its settings differ from those of the picked run. Show the existing image with an "Out of date" marker on the card and the badge. Do not delete or hide it.
- Run is disabled while the step's input is missing, pending or out of date, with a hint that names the step to run first.
- Run again starts another run with the same settings, so you can try a step several times and keep the result you like.

### Drafts at 1024px

- Before upload, scale the input image so its long side is 1024px. The original asset stays at full resolution.
- Request low quality at the supported output size closest to the input's aspect ratio: 1024×1024, 1024×1536 or 1536×1024.
- Store each run's image as an asset in IndexedDB, like an upload.

### OpenAI adapter

- Use the image edits endpoint with the current GPT Image model. Check the model name and prices when implementing, since both change often.
- Keep the API key out of the browser. Read `OPENAI_API_KEY` from `.env.local` in a Vite dev-server proxy that adds the header. This uses Vite's built-in proxy, so it needs no new dependency. Add `.env.local` to `.gitignore`.
- Prompt steps send their prompt text. Style steps send a prompt built from the preset and its settings, using one prompt template per preset. Keep the templates next to the preset definitions.
- The processor interface changes to take the input image, the step and the quality, and to return one image. The pass-through processor stays for tests and for working without a key.
- Show pending runs on the card, and show failures with the API's error message and a Retry button.

### Acceptance criteria

- Running a prompt step on an imported photo returns a draft image. Running it again adds a second run, and picking either one updates every step after it.
- Changing a prompt or slider marks the output and everything downstream as out of date without making any API call.
- Reloading restores runs and picks.
- No API key reaches the browser bundle or IndexedDB.
- Tests cover out-of-date detection, picking runs and downstream propagation, using the pass-through processor.

## 13. Later version: finals and export

- Export on a node downloads its final image. If the node has none, offer Make final, showing the estimated cost first.
- Make final is one high-quality call. It sends the node's picked draft plus the original photo as a reference, and asks for the same image at high quality. It does not replay the steps of the path.
- Store the final as a run with quality `final`, linked to the draft it came from. A node can still export its draft.
- Upscaling to print size, a job queue panel, A/B compare and masks are future scope.
