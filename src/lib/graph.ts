import type { Edge, Node, Viewport, XYPosition } from '@xyflow/react';
import { defaultSettings, newRecipe, presets, type PresetId, type Recipe } from './presets';

export type NodeKind = 'original' | 'edit' | 'variation';
export type ImageData = { name: string; kind: NodeKind; assetId?: string };
export type ImageNode = Node<ImageData, 'image'>;
// A prompt step only reaches the processor once Generate is pressed, so typing never triggers generation.
export type PromptStep = { kind: 'prompt'; name: string; prompt: string; appliedPrompt: string };
export type StyleStep = { kind: 'style' } & Recipe;
export type Step = PromptStep | StyleStep;
export type StepEdge = Edge<Step, 'step'> & { data: Step };
export type Asset = { id: string; blob: Blob; filename: string; width: number; height: number };
export type Graph = { nodes: ImageNode[]; edges: StepEdge[]; name: string };
export type Project = Graph & { version: 1; viewport: Viewport };

export const emptyGraph = (): Graph => ({ name: 'Untitled journey', nodes: [], edges: [] });
export const initialViewport: Viewport = { x: 80, y: 80, zoom: 0.9 };
export const kindLabels: Record<NodeKind, string> = { original: 'Original', edit: 'Edit', variation: 'Variation' };

export const newPromptStep = (prompt = ''): PromptStep => ({ kind: 'prompt', name: '', prompt, appliedPrompt: '' });
// An empty name means the badge follows the preset, so switching styles keeps the label accurate.
export const newStyleStep = (preset: PresetId = 'watercolor'): StyleStep => ({ kind: 'style', ...newRecipe(preset), name: '' });
export function switchPreset(step: StyleStep, preset: PresetId): StyleStep {
  return { ...step, preset, settings: { ...step.settings, [preset]: step.settings[preset] ?? defaultSettings(preset) } };
}
export const outputKind = (step: Step['kind']): NodeKind => step === 'prompt' ? 'edit' : 'variation';
export const stepKindFor = (kind: NodeKind): Step['kind'] | undefined => kind === 'edit' ? 'prompt' : kind === 'variation' ? 'style' : undefined;

export function stepLabel(step: Step): string {
  if (step.name.trim()) return step.name.trim();
  if (step.kind === 'style') return presets[step.preset].short;
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
    return options.kind === 'prompt' ? 'A prompt step must lead to an edit node.' : 'A style step must lead to a variation node.';
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

// Processor boundary: a later adapter (for example OpenAI image editing for prompt steps) returns a new asset id.
export interface ImageProcessor { process(inputAssetId: string, step: Step): string | Promise<string> }
export const passThroughProcessor: ImageProcessor = { process: inputAssetId => inputAssetId };

export type NodeImage = { status: 'ready'; assetId: string } | { status: 'pending' } | { status: 'missing' } | { status: 'failed'; message: string };

export function processingKey(inputAssetId: string, step: Step): string {
  if (step.kind === 'prompt') return `${inputAssetId}|prompt|${step.appliedPrompt}`;
  return `${inputAssetId}|style|${step.preset}|${JSON.stringify(step.settings[step.preset] ?? null)}`;
}

export function resolveImages(graph: Graph, run: (inputAssetId: string, step: Step) => NodeImage): Map<string, NodeImage> {
  const result = new Map<string, NodeImage>(), visiting = new Set<string>();
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const incoming = new Map(graph.edges.map(e => [e.target, e]));
  function resolve(id: string): NodeImage {
    const known = result.get(id);
    if (known) return known;
    if (visiting.has(id)) return { status: 'missing' };
    visiting.add(id);
    const node = nodes.get(id), edge = incoming.get(id);
    let image: NodeImage = { status: 'missing' };
    if (node?.data.kind === 'original') { if (node.data.assetId) image = { status: 'ready', assetId: node.data.assetId }; }
    else if (edge) {
      const input = resolve(edge.source);
      if (input.status === 'ready') image = run(input.assetId, edge.data);
      else if (input.status === 'pending') image = input;
    }
    visiting.delete(id);
    result.set(id, image);
    return image;
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
export function serializeProject(graph: Graph, viewport: Viewport): Project { return { ...cleanGraph(graph), version: 1, viewport: { ...viewport } }; }

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

export function referencedAssets(graph: Graph): Set<string> {
  return new Set(graph.nodes.flatMap(n => n.data.assetId ? [n.data.assetId] : []));
}
