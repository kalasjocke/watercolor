import type { Edge, Node, Viewport, XYPosition } from '@xyflow/react';
import { defaultAdjust, isIdentity, type AdjustValues } from './adjust';
import { defaultSettings, newRecipe, presets, type PresetId, type Recipe } from './presets';

export type NodeKind = 'original' | 'edit' | 'variation' | 'adjusted';
export type ImageData = { name: string; kind: NodeKind; assetId?: string };
export type ImageNode = Node<ImageData, 'image'>;
// `pickedRunId` names the run whose image is the step's output. Picking is part of undo history.
export type PromptStep = { kind: 'prompt'; name: string; prompt: string; pickedRunId?: string };
export type StyleStep = { kind: 'style'; pickedRunId?: string } & Recipe;
// Adjust steps run in the browser as their settings change, so they have no runs.
export type AdjustStep = { kind: 'adjust'; name: string; values: AdjustValues; pickedRunId?: string };
export type Step = PromptStep | StyleStep | AdjustStep;
export type StepEdge = Edge<Step, 'step'> & { data: Step };
export type Asset = { id: string; blob: Blob; filename: string; width: number; height: number };
export type Graph = { nodes: ImageNode[]; edges: StepEdge[]; name: string };
// Runs are results of paid work, so they live outside undo history. They are keyed by step (edge) id, newest first.
export type Run = { id: string; inputAssetId: string; settingsKey: string; quality: 'draft' | 'final'; status: 'pending' | 'done' | 'failed'; assetId?: string; error?: string; createdAt: number };
export type Runs = Record<string, Run[]>;
export type Project = Graph & { version: 1; viewport: Viewport; runs?: Runs };

export const emptyGraph = (): Graph => ({ name: 'Untitled journey', nodes: [], edges: [] });
export const initialViewport: Viewport = { x: 80, y: 80, zoom: 0.9 };
export const kindLabels: Record<NodeKind, string> = { original: 'Original', edit: 'Edit', variation: 'Variation', adjusted: 'Adjusted' };

export const newPromptStep = (prompt = ''): PromptStep => ({ kind: 'prompt', name: '', prompt });
// An empty name means the badge follows the preset, so switching styles keeps the label accurate.
export const newStyleStep = (preset: PresetId = 'watercolor'): StyleStep => ({ kind: 'style', ...newRecipe(preset), name: '' });
export function switchPreset(step: StyleStep, preset: PresetId): StyleStep {
  return { ...step, preset, settings: { ...step.settings, [preset]: step.settings[preset] ?? defaultSettings(preset) } };
}
export const newAdjustStep = (): AdjustStep => ({ kind: 'adjust', name: '', values: defaultAdjust() });
export const newStep = (kind: Step['kind']): Step => kind === 'prompt' ? newPromptStep() : kind === 'style' ? newStyleStep() : newAdjustStep();
const outputKinds: Record<Step['kind'], NodeKind> = { prompt: 'edit', style: 'variation', adjust: 'adjusted' };
export const outputKind = (step: Step['kind']): NodeKind => outputKinds[step];
export const stepKindFor = (kind: NodeKind): Step['kind'] | undefined => (Object.keys(outputKinds) as Step['kind'][]).find(k => outputKinds[k] === kind);

export function stepLabel(step: Step): string {
  if (step.name.trim()) return step.name.trim();
  if (step.kind === 'style') return presets[step.preset].short;
  if (step.kind === 'adjust') return 'Adjust';
  const words = step.prompt.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'New prompt';
  return words.length > 4 ? `${words.slice(0, 4).join(' ')}…` : words.join(' ');
}

export function validateConnection(graph: Graph, source: string, target: string, options: { replacing?: string; kind?: Step['kind'] } = {}): string | null {
  if (source === target) return 'A photo cannot connect to itself.';
  const targetNode = graph.nodes.find(n => n.id === target);
  if (!graph.nodes.some(n => n.id === source) || !targetNode) return 'Choose two existing image nodes.';
  if (targetNode.data.kind === 'original') return 'Original photos cannot receive processing steps.';
  if (options.kind && outputKind(options.kind) !== targetNode.data.kind) {
    return { prompt: 'A prompt step must lead to an edit node.', style: 'A style step must lead to a variation node.', adjust: 'An adjust step must lead to an adjusted node.' }[options.kind];
  }
  const edges = graph.edges.filter(e => e.id !== options.replacing);
  if (edges.some(e => e.target === target)) return 'Each image can have only one input. Create another branch instead.';
  const stack = [target], visited = new Set<string>();
  while (stack.length) {
    const next = stack.pop()!;
    if (next === source) return 'This connection would create a loop.';
    if (visited.has(next)) continue;
    visited.add(next);
    edges.filter(e => e.source === next).forEach(e => stack.push(e.target));
  }
  return null;
}

export type ProcessRequest = { input: Asset; step: Step; quality: Run['quality'] };
// Processor boundary. It returns the output image as an asset. The pass-through processor returns the input.
export interface ImageProcessor { process(request: ProcessRequest): Promise<Asset> }
export const passThroughProcessor: ImageProcessor = { process: async ({ input }) => input };

// The settings that affect a step's output. The step name does not.
export function settingsKey(step: Step): string {
  if (step.kind === 'prompt') return JSON.stringify(['prompt', step.prompt.trim()]);
  if (step.kind === 'adjust') return JSON.stringify(['adjust', step.values]);
  return JSON.stringify(['style', step.preset, step.settings[step.preset] ?? null]);
}

// A short stable hash (FNV-1a) used to name computed images.
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
// Adjusted images are computed, not stored. Their id names the input and the settings, so changing either gives a
// new id, which marks AI runs made from the old image out of date. Neutral settings pass the input through.
export const adjustedAssetId = (inputAssetId: string, values: AdjustValues) =>
  isIdentity(values) ? inputAssetId : `adjust:${inputAssetId}:${hash(JSON.stringify(values))}`;

export type NodeStatus = {
  assetId?: string;      // the image shown on the card
  stale: boolean;        // the image was made from an older input or older settings
  ready: boolean;        // the image is current, so steps after this node can run
  pending: boolean;      // a run of this node's step is in progress
  error?: string;        // the latest run failed
  hasInput: boolean;     // an incoming step exists (always false for originals)
  inputAssetId?: string; // the current input image, when the input is ready
  blockedBy?: string;    // id of the node to run first
  canRun: boolean;
  derivedFrom?: { inputAssetId: string; values: AdjustValues }; // how to compute an adjusted image
};

export function resolveNodes(graph: Graph, runs: Runs): Map<string, NodeStatus> {
  const result = new Map<string, NodeStatus>(), visiting = new Set<string>();
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const incoming = new Map(graph.edges.map(e => [e.target, e]));
  const blank: NodeStatus = { stale: false, ready: false, pending: false, hasInput: false, canRun: false };
  function resolve(id: string): NodeStatus {
    const known = result.get(id);
    if (known) return known;
    if (visiting.has(id)) return blank;
    visiting.add(id);
    const node = nodes.get(id), edge = incoming.get(id);
    let status = blank;
    if (node?.data.kind === 'original') status = { ...blank, assetId: node.data.assetId, ready: !!node.data.assetId };
    else if (edge?.data.kind === 'adjust') {
      const input = resolve(edge.source);
      const assetId = input.assetId ? adjustedAssetId(input.assetId, edge.data.values) : undefined;
      status = {
        ...blank, assetId, hasInput: true, stale: input.stale,
        ready: !!assetId && input.ready, pending: false,
        inputAssetId: input.ready ? input.assetId : undefined,
        blockedBy: input.assetId ? undefined : edge.source,
        derivedFrom: input.assetId && assetId !== input.assetId ? { inputAssetId: input.assetId, values: edge.data.values } : undefined,
      };
    }
    else if (edge) {
      const input = resolve(edge.source), stepRuns = runs[edge.id] ?? [];
      const picked = stepRuns.find(r => r.id === edge.data.pickedRunId && r.status === 'done' && r.assetId);
      const stale = !!picked && (input.stale || picked.inputAssetId !== input.assetId || picked.settingsKey !== settingsKey(edge.data));
      const pending = stepRuns.some(r => r.status === 'pending');
      status = {
        assetId: picked?.assetId, stale, pending, hasInput: true,
        ready: !!picked && !stale && !pending,
        error: stepRuns[0]?.status === 'failed' ? stepRuns[0].error : undefined,
        inputAssetId: input.ready ? input.assetId : undefined,
        blockedBy: input.ready ? undefined : edge.source,
        canRun: input.ready && !pending,
      };
    }
    visiting.delete(id);
    result.set(id, status);
    return status;
  }
  graph.nodes.forEach(n => resolve(n.id));
  return result;
}

export function removeItems(graph: Graph, nodeIds: Set<string>, edgeIds: Set<string>): Graph {
  return { ...graph, nodes: graph.nodes.filter(n => !nodeIds.has(n.id)), edges: graph.edges.filter(e => !edgeIds.has(e.id) && !nodeIds.has(e.source) && !nodeIds.has(e.target)) };
}

export function cleanGraph(graph: Graph): Graph {
  return {
    name: graph.name,
    nodes: graph.nodes.map(n => ({ id: n.id, type: 'image', position: { ...n.position }, data: structuredClone(n.data) })),
    edges: graph.edges.map(e => ({ id: e.id, type: 'step', source: e.source, target: e.target, data: structuredClone(e.data) })),
  };
}
export function serializeProject(graph: Graph, viewport: Viewport, runs: Runs = {}): Project {
  return { ...cleanGraph(graph), version: 1, viewport: { ...viewport }, runs: structuredClone(runs) };
}

// Nodes snap to columns 450px apart, which leaves room for an edge badge between 260px cards.
// The 20px row step lines cards up loosely without pinning them in place.
export const snapGrid: [number, number] = [450, 20];
export const snapPosition = (p: XYPosition): XYPosition => ({ x: Math.round(p.x / snapGrid[0]) * snapGrid[0], y: Math.round(p.y / snapGrid[1]) * snapGrid[1] });

// Cards are stacked by their rendered height. Unmeasured cards are assumed to be as tall as a
// card with the tallest allowed photo.
const cardGap = snapGrid[1], fallbackHeight = 480;
const cardHeight = (node: ImageNode) => node.measured?.height ?? fallbackHeight;

export function variationPosition(graph: Graph, sourceId: string): XYPosition {
  const source = graph.nodes.find(n => n.id === sourceId)!;
  // The new output shows the same image as its source, so it starts out the same height.
  return freePosition(graph, { x: source.position.x + snapGrid[0], y: source.position.y }, cardHeight(source));
}
// Moves a new card of the given height down its column until it clears every card by one row step.
export function freePosition(graph: Graph, start: XYPosition, height = fallbackHeight): XYPosition {
  const position = snapPosition(start);
  for (;;) {
    const blocking = graph.nodes.find(n => Math.abs(n.position.x - position.x) < 300
      && n.position.y < position.y + height + cardGap && position.y < n.position.y + cardHeight(n) + cardGap);
    if (!blocking) return position;
    position.y = Math.ceil((blocking.position.y + cardHeight(blocking) + cardGap) / snapGrid[1]) * snapGrid[1];
  }
}

function nextName(graph: Graph, kind: NodeKind) {
  return `${kindLabels[kind]} ${graph.nodes.filter(n => n.data.kind === kind).length + 1}`;
}

export function selectOnly(graph: Graph, ids: { nodes?: string[]; edges?: string[] }): Graph {
  const nodes = new Set(ids.nodes), edges = new Set(ids.edges);
  return { ...graph, nodes: graph.nodes.map(n => ({ ...n, selected: nodes.has(n.id) })), edges: graph.edges.map(e => ({ ...e, selected: edges.has(e.id) })) };
}

// Adds an output node fed by a new step from sourceId and selects the new step.
export function addStep(graph: Graph, sourceId: string, step: Step, position = variationPosition(graph, sourceId), id: string = crypto.randomUUID()) {
  const kind = outputKind(step.kind);
  const node: ImageNode = { id, type: 'image', position: snapPosition(position), data: { name: nextName(graph, kind), kind } };
  const edge: StepEdge = { id: `${id}-in`, type: 'step', source: sourceId, target: id, data: step };
  const next = selectOnly({ ...graph, nodes: [...graph.nodes, node], edges: [...graph.edges, edge] }, { edges: [edge.id] });
  return { graph: next, nodeId: node.id, edgeId: edge.id };
}

export function duplicateStep(graph: Graph, nodeId: string) {
  const edge = graph.edges.find(e => e.target === nodeId);
  if (!edge) return null;
  const step = structuredClone(edge.data);
  if (step.name.trim()) step.name = `${step.name} copy`;
  delete step.pickedRunId;
  return addStep(graph, edge.source, step);
}

export function addOriginal(graph: Graph, asset: Asset, position: XYPosition, id: string = crypto.randomUUID()): Graph {
  const name = asset.filename.replace(/\.[^.]+$/, '') || 'Photo';
  return { ...graph, nodes: [...graph.nodes, { id, type: 'image', position: freePosition(graph, position), data: { name, kind: 'original', assetId: asset.id } }] };
}

export function updateStep(graph: Graph, edgeId: string, update: (step: Step) => Step): Graph {
  return { ...graph, edges: graph.edges.map(e => e.id === edgeId ? { ...e, data: update(e.data) } : e) };
}
export function updateNode(graph: Graph, nodeId: string, update: (data: ImageData) => ImageData): Graph {
  return { ...graph, nodes: graph.nodes.map(n => n.id === nodeId ? { ...n, data: update(n.data) } : n) };
}

export function referencedAssets(graph: Graph, runs: Runs = {}): Set<string> {
  const fromRuns = Object.values(runs).flat().flatMap(r => r.assetId ? [r.assetId] : []);
  return new Set([...graph.nodes.flatMap(n => n.data.assetId ? [n.data.assetId] : []), ...fromRuns]);
}

// Keeps runs of steps that still exist, and marks runs that were cut off by a reload as failed.
export function loadedRuns(graph: Graph, runs: Runs = {}): Runs {
  const edges = new Set(graph.edges.map(e => e.id));
  return Object.fromEntries(Object.entries(runs).filter(([id]) => edges.has(id)).map(([id, list]) => [id,
    list.map(r => r.status === 'pending' ? { ...r, status: 'failed' as const, error: 'Interrupted before it finished.' } : r)]));
}

export const newRun = (inputAssetId: string, step: Step): Run =>
  ({ id: crypto.randomUUID(), inputAssetId, settingsKey: settingsKey(step), quality: 'draft', status: 'pending', createdAt: Date.now() });
