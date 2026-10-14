import { describe, expect, it } from 'vitest';
import {
  addOriginal, addStep, cleanGraph, duplicateStep, emptyGraph, loadedRuns, newPromptStep, newRun, newStyleStep, passThroughProcessor,
  referencedAssets, removeItems, resolveNodes, serializeProject, settingsKey, snapPosition, stepLabel, switchPreset, updateStep,
  validateConnection, type Asset, type Graph, type Run, type Runs, type Step,
} from './graph';
import { changedSettings, defaultSettings } from './presets';

const asset: Asset = { id: 'asset-1', blob: new Blob(), filename: 'forest.jpg', width: 1200, height: 800 };

// Runs one step on its current input, the way Studio does: a finished run whose output is out-<target>-<n>, then picked.
function runStep(state: { graph: Graph; runs: Runs }, edgeId: string, patch: Partial<Run> = {}) {
  const edge = state.graph.edges.find(e => e.id === edgeId)!;
  const status = resolveNodes(state.graph, state.runs).get(edge.target)!;
  if (!status.canRun) throw new Error(`${edgeId} cannot run`);
  const previous = state.runs[edgeId] ?? [];
  const run: Run = { ...newRun(status.inputAssetId!, edge.data), status: 'done', assetId: `out-${edge.target}-${previous.length + 1}`, ...patch };
  const runs = { ...state.runs, [edgeId]: [run, ...previous] };
  const graph = run.status === 'done' ? updateStep(state.graph, edgeId, step => ({ ...step, pickedRunId: run.id })) : state.graph;
  return { graph, runs, run };
}
function runAll(graph: Graph) {
  let state = { graph, runs: {} as Runs };
  for (const edge of graph.edges) state = runStep(state, edge.id);
  return state;
}
const setPrompt = (graph: Graph, edgeId: string, prompt: string) => updateStep(graph, edgeId, step => ({ ...step, prompt }) as Step);

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

describe('resolveNodes', () => {
  it('lets only steps with a ready input run before anything has run', () => {
    const nodes = resolveNodes(sampleGraph(), {});
    expect(nodes.get('original')).toMatchObject({ assetId: 'asset-1', ready: true });
    expect(nodes.get('edit')).toMatchObject({ assetId: undefined, canRun: true, inputAssetId: 'asset-1' });
    expect(nodes.get('a')).toMatchObject({ assetId: undefined, canRun: false, blockedBy: 'edit' });
    expect(nodes.get('c')).toMatchObject({ canRun: false, blockedBy: 'a' });
  });
  it('shows each picked run and feeds it to the next step', () => {
    const { graph, runs } = runAll(sampleGraph()), nodes = resolveNodes(graph, runs);
    expect(['edit', 'a', 'b', 'c'].map(id => nodes.get(id)!.assetId)).toEqual(['out-edit-1', 'out-a-1', 'out-b-1', 'out-c-1']);
    expect(runs['a-in'][0].inputAssetId).toBe('out-edit-1');
    expect(runs['c-in'][0].inputAssetId).toBe('out-a-1');
    expect([...nodes.values()].every(n => n.ready && !n.stale)).toBe(true);
  });
  it('marks a step and everything after it out of date when its prompt changes, without hiding images', () => {
    const state = runAll(sampleGraph()), nodes = resolveNodes(setPrompt(state.graph, 'edit-in', 'Remove the fence'), state.runs);
    expect(['edit', 'a', 'b', 'c'].map(id => nodes.get(id)!.stale)).toEqual([true, true, true, true]);
    expect(nodes.get('edit')).toMatchObject({ assetId: 'out-edit-1', canRun: true });
    expect(nodes.get('a')).toMatchObject({ assetId: 'out-a-1', canRun: false, blockedBy: 'edit' });
  });
  it('clears out-of-date markers as the steps are run again in order', () => {
    let state = runAll(sampleGraph());
    state = { ...state, graph: setPrompt(state.graph, 'edit-in', 'Remove the fence') };
    state = runStep(state, 'edit-in');
    let nodes = resolveNodes(state.graph, state.runs);
    expect(['edit', 'a', 'c'].map(id => nodes.get(id)!.stale)).toEqual([false, true, true]);
    state = runStep(runStep(runStep(state, 'a-in'), 'b-in'), 'c-in');
    nodes = resolveNodes(state.graph, state.runs);
    expect([...nodes.values()].some(n => n.stale)).toBe(false);
  });
  it('ignores step name changes', () => {
    const state = runAll(sampleGraph());
    const renamed = updateStep(state.graph, 'edit-in', step => ({ ...step, name: 'Car removal' }));
    expect(resolveNodes(renamed, state.runs).get('edit')!.stale).toBe(false);
  });
  it('marks a reconnected step and its branch out of date', () => {
    const state = runAll(sampleGraph());
    let graph = addOriginal(state.graph, { ...asset, id: 'asset-2' }, { x: 0, y: 0 }, 'second');
    graph = { ...graph, edges: graph.edges.map(e => e.id === 'a-in' ? { ...e, source: 'second' } : e) };
    const nodes = resolveNodes(graph, state.runs);
    expect(['a', 'c', 'b'].map(id => nodes.get(id)!.stale)).toEqual([true, true, false]);
    expect(nodes.get('a')).toMatchObject({ canRun: true, inputAssetId: 'asset-2' });
  });
  it('blocks a step and the steps after it while a run is pending', () => {
    const state = runAll(sampleGraph());
    const pending = runStep(state, 'edit-in', { status: 'pending', assetId: undefined });
    const nodes = resolveNodes(pending.graph, pending.runs);
    expect(nodes.get('edit')).toMatchObject({ pending: true, canRun: false, assetId: 'out-edit-1', stale: false, ready: false });
    expect(nodes.get('a')).toMatchObject({ canRun: false, blockedBy: 'edit', stale: false });
  });
  it('keeps the picked image and reports the error when the latest run fails', () => {
    const state = runAll(sampleGraph());
    const failed = runStep(state, 'b-in', { status: 'failed', assetId: undefined, error: 'Rate limited' });
    expect(resolveNodes(failed.graph, failed.runs).get('b')).toMatchObject({ assetId: 'out-b-1', error: 'Rate limited', canRun: true });
  });
  it('shows an earlier run when it is picked, and marks the steps after it out of date', () => {
    let state = runAll(sampleGraph());
    const first = state.runs['edit-in'][0].id;
    state = runStep(state, 'edit-in');
    const graph = updateStep(state.graph, 'edit-in', step => ({ ...step, pickedRunId: first }));
    const nodes = resolveNodes(graph, state.runs);
    expect(nodes.get('edit')).toMatchObject({ assetId: 'out-edit-1', stale: false });
    expect(nodes.get('a')!.stale).toBe(false);
    const latest = resolveNodes(state.graph, state.runs);
    expect(latest.get('edit')!.assetId).toBe('out-edit-2');
    expect(latest.get('a')!.stale).toBe(true);
  });
  it('treats outputs without an input as unconnected', () => {
    const nodes = resolveNodes(removeItems(sampleGraph(), new Set(['original']), new Set()), {});
    expect(nodes.get('edit')).toMatchObject({ hasInput: false, canRun: false });
  });
});

describe('runs', () => {
  it('returns the input unchanged from the pass-through processor', async () => {
    expect(await passThroughProcessor.process({ input: asset, step: newPromptStep('x'), quality: 'draft' })).toBe(asset);
  });
  it('drops runs of deleted steps and fails runs cut off by a reload', () => {
    const state = runStep(runAll(sampleGraph()), 'b-in', { status: 'pending', assetId: undefined });
    const graph = removeItems(state.graph, new Set(['c']), new Set());
    const runs = loadedRuns(graph, { ...state.runs, gone: [] });
    expect(Object.keys(runs).sort()).toEqual(['a-in', 'b-in', 'edit-in']);
    expect(runs['b-in'][0]).toMatchObject({ status: 'failed', error: 'Interrupted before it finished.' });
  });
  it('counts run outputs as referenced assets', () => {
    const { graph, runs } = runAll(sampleGraph());
    expect([...referencedAssets(graph, runs)].sort()).toEqual(['asset-1', 'out-a-1', 'out-b-1', 'out-c-1', 'out-edit-1']);
  });
  it('does not copy the picked run when a step is duplicated', () => {
    const { graph } = runAll(sampleGraph());
    const result = duplicateStep(graph, 'b')!;
    expect(result.graph.edges.find(e => e.id === result.edgeId)!.data.pickedRunId).toBeUndefined();
  });
});

describe('steps', () => {
  it('keys settings by what changes the output', () => {
    const step = newStyleStep('ukiyoe');
    expect(settingsKey({ ...step, name: 'Bold' })).toBe(settingsKey(step));
    expect(settingsKey(switchPreset(step, 'sumie'))).not.toBe(settingsKey(step));
    expect(settingsKey(newPromptStep('Remove the car '))).toBe(settingsKey(newPromptStep('Remove the car')));
  });
  it('lists only the settings that differ from the preset defaults', () => {
    const step = newStyleStep('watercolor');
    expect(changedSettings(step)).toEqual([]);
    const defaults = defaultSettings('watercolor');
    const tuned = { ...step, settings: { watercolor: { values: { ...defaults.values, detail: 80, warmth: 10 }, preserve: { ...defaults.preserve, faces: false, colors: true } } } };
    expect(changedSettings(tuned)).toEqual(['Detail 80', 'Light warmth 10', 'Faces not kept', 'Original colors kept']);
    expect(changedSettings(switchPreset(tuned, 'sumie'))).toEqual([]);
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
