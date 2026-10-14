import { describe, expect, it } from 'vitest';
import {
  addOriginal, addStep, cleanGraph, duplicateStep, emptyGraph, newPromptStep, newStyleStep, passThroughProcessor, processingKey,
  removeItems, resolveImages, serializeProject, snapPosition, stepLabel, switchPreset, validateConnection, type Asset, type Graph, type NodeImage,
} from './graph';
import { defaultSettings } from './presets';

const asset: Asset = { id: 'asset-1', blob: new Blob(), filename: 'forest.jpg', width: 1200, height: 800 };
const passThrough = (input: string): NodeImage => ({ status: 'ready', assetId: passThroughProcessor.process(input, newPromptStep()) as string });

// original -> prompt -> edit, which branches into two style variations, one of which is chained.
function sampleGraph() {
  let graph: Graph = addOriginal(emptyGraph(), asset, { x: 0, y: 0 }, 'original');
  graph = addStep(graph, 'original', newPromptStep('Remove the black car in the background'), undefined, 'edit').graph;
  graph = addStep(graph, 'edit', newStyleStep('watercolor'), undefined, 'a').graph;
  graph = addStep(graph, 'edit', newStyleStep('shinhanga'), undefined, 'b').graph;
  graph = addStep(graph, 'a', newStyleStep('sumie'), undefined, 'c').graph;
  return graph;
}

describe('validateConnection', () => {
  const graph = sampleGraph();
  it('accepts a new input for an unconnected output', () => {
    const loose = removeItems(graph, new Set(), new Set(['c-in']));
    expect(validateConnection(loose, 'b', 'c')).toBeNull();
  });
  it('rejects self-connections', () => expect(validateConnection(graph, 'a', 'a')).toMatch(/itself/));
  it('rejects inputs into originals', () => expect(validateConnection(graph, 'a', 'original')).toMatch(/Original/));
  it('rejects a second input', () => expect(validateConnection(graph, 'b', 'c')).toMatch(/only one input/));
  it('rejects cycles', () => {
    const loose = removeItems(graph, new Set(), new Set(['edit-in']));
    expect(validateConnection(loose, 'c', 'edit')).toMatch(/loop/);
  });
  it('allows reconnecting an existing edge', () => expect(validateConnection(graph, 'b', 'c', { replacing: 'c-in', kind: 'style' })).toBeNull());
  it('rejects a step that would lead to the wrong kind of node', () => {
    expect(validateConnection(graph, 'b', 'c', { replacing: 'c-in', kind: 'prompt' })).toMatch(/edit node/);
    expect(validateConnection(graph, 'b', 'edit', { replacing: 'edit-in', kind: 'style' })).toMatch(/variation node/);
  });
});

describe('addStep', () => {
  it('creates an edit node for a prompt step and a variation for a style step, and selects the new edge', () => {
    const graph = sampleGraph();
    expect(graph.nodes.map(n => [n.id, n.data.kind])).toEqual([['original', 'original'], ['edit', 'edit'], ['a', 'variation'], ['b', 'variation'], ['c', 'variation']]);
    expect(graph.edges.filter(e => e.selected).map(e => e.id)).toEqual(['c-in']);
  });
  it('places branches from the same source without overlap', () => {
    const graph = sampleGraph(), a = graph.nodes.find(n => n.id === 'a')!, b = graph.nodes.find(n => n.id === 'b')!;
    expect(a.position.x).toBe(b.position.x);
    expect(b.position.y - a.position.y).toBe(500);
  });
  it('stacks new branches below the measured height of the cards in the column', () => {
    let graph = sampleGraph();
    graph = { ...graph, nodes: graph.nodes.map(n => ({ ...n, measured: { width: 260, height: n.id === 'a' ? 300 : 460 } })) };
    // 'a' is 300 tall at y 0, so the next branch from 'edit' goes 300 + 20 below it, then clears 'b'.
    const next = addStep(graph, 'edit', newStyleStep(), undefined, 'e').graph.nodes.find(n => n.id === 'e')!;
    const b = graph.nodes.find(n => n.id === 'b')!;
    expect(next.position).toEqual({ x: 900, y: b.position.y + 460 + 20 });
  });
  it('snaps placed nodes to 450px columns and 20px rows', () => {
    expect(snapPosition({ x: 230, y: 31 })).toEqual({ x: 450, y: 40 });
    expect(snapPosition({ x: -230, y: -11 })).toEqual({ x: -450, y: -20 });
    const dropped = addStep(sampleGraph(), 'c', newStyleStep(), { x: 1580, y: 905 }, 'd').graph.nodes.find(n => n.id === 'd')!;
    expect(dropped.position).toEqual({ x: 1800, y: 900 });
    expect(addOriginal(emptyGraph(), asset, { x: 120, y: 13 }, 'o').nodes[0].position).toEqual({ x: 0, y: 20 });
  });
  it('duplicates a step into a sibling branch with a copy of its settings', () => {
    const result = duplicateStep(sampleGraph(), 'b')!;
    const edge = result.graph.edges.find(e => e.id === result.edgeId)!;
    expect(edge.source).toBe('edit');
    expect(edge.data).toEqual(sampleGraph().edges.find(e => e.id === 'b-in')!.data);
  });
});

describe('resolveImages', () => {
  it('shows the original image in every connected output', () => {
    const images = resolveImages(sampleGraph(), passThrough);
    expect([...images.values()]).toEqual(Array(5).fill({ status: 'ready', assetId: 'asset-1' }));
  });
  it('marks outputs without an input as missing, including everything downstream', () => {
    const images = resolveImages(removeItems(sampleGraph(), new Set(['original']), new Set()), passThrough);
    expect(['edit', 'a', 'b', 'c'].map(id => images.get(id)!.status)).toEqual(['missing', 'missing', 'missing', 'missing']);
  });
  it('updates downstream outputs when a step is reconnected', () => {
    const second: Asset = { ...asset, id: 'asset-2' };
    let graph = addOriginal(sampleGraph(), second, { x: 0, y: 0 }, 'second');
    graph = { ...graph, edges: graph.edges.map(e => e.id === 'a-in' ? { ...e, source: 'second' } : e) };
    const images = resolveImages(graph, passThrough);
    expect(images.get('a')).toEqual({ status: 'ready', assetId: 'asset-2' });
    expect(images.get('c')).toEqual({ status: 'ready', assetId: 'asset-2' });
    expect(images.get('b')).toEqual({ status: 'ready', assetId: 'asset-1' });
  });
  it('propagates a pending result downstream', () => {
    const images = resolveImages(sampleGraph(), (input, step) => step.kind === 'prompt' ? { status: 'pending' } : passThrough(input));
    expect(['edit', 'a', 'c'].map(id => images.get(id)!.status)).toEqual(['pending', 'pending', 'pending']);
  });
});

describe('steps', () => {
  it('only reprocesses a prompt step after it is generated', () => {
    const step = newPromptStep('Remove the car');
    expect(processingKey('x', step)).toBe(processingKey('x', { ...step, prompt: 'Remove the car and the sign' }));
    expect(processingKey('x', step)).not.toBe(processingKey('x', { ...step, appliedPrompt: 'Remove the car' }));
  });
  it('labels steps from their name, prompt or preset', () => {
    expect(stepLabel(newPromptStep())).toBe('New prompt');
    expect(stepLabel(newPromptStep('Remove the black car in the background'))).toBe('Remove the black car…');
    expect(stepLabel(newStyleStep('ukiyoe'))).toBe('Ukiyo-e');
    expect(stepLabel({ ...newStyleStep(), name: 'Softer washes' })).toBe('Softer washes');
  });
  it('remembers settings per preset when switching styles', () => {
    const tuned = { ...newStyleStep('watercolor') };
    tuned.settings = { watercolor: { ...defaultSettings('watercolor'), values: { ...defaultSettings('watercolor').values, detail: 3 } } };
    const back = switchPreset(switchPreset(tuned, 'rinpa'), 'watercolor');
    expect(back.settings.watercolor!.values.detail).toBe(3);
    expect(back.settings.rinpa).toEqual(defaultSettings('rinpa'));
  });
});

describe('serializeProject', () => {
  it('keeps graph data and drops view state', () => {
    const graph = sampleGraph();
    graph.nodes[0] = { ...graph.nodes[0], selected: true, dragging: true, measured: { width: 260, height: 400 } };
    const project = serializeProject(graph, { x: 10, y: 20, zoom: 0.5 });
    expect(project.version).toBe(1);
    expect(project.viewport).toEqual({ x: 10, y: 20, zoom: 0.5 });
    expect(project.nodes[0]).toEqual({ id: 'original', type: 'image', position: { x: 0, y: 0 }, data: { name: 'forest', kind: 'original', assetId: 'asset-1' } });
    expect(project.edges.every(e => !('selected' in e))).toBe(true);
    expect(JSON.parse(JSON.stringify(project))).toEqual(project);
    expect(cleanGraph(project)).toEqual({ name: project.name, nodes: project.nodes, edges: project.edges });
  });
});
