import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { addOriginal, addStep, emptyGraph, newPromptStep, newRun, serializeProject, type Asset } from './graph';
import { deleteAssets, loadProject, saveAssets, saveProject } from './storage';

describe('storage', () => {
  it('round-trips the project and its assets', async () => {
    const asset: Asset = { id: 'asset-1', blob: new Blob(['pixels'], { type: 'image/png' }), filename: 'photo.png', width: 4, height: 3 };
    let graph = addOriginal(emptyGraph(), asset, { x: 0, y: 0 }, 'original');
    graph = addStep(graph, 'original', { ...newPromptStep('Remove the car'), pickedRunId: 'run-1' }, undefined, 'edit').graph;
    const runs = { 'edit-in': [{ ...newRun('asset-1', newPromptStep('Remove the car')), id: 'run-1', status: 'done' as const, assetId: 'asset-1' }] };
    const project = serializeProject(graph, { x: 1, y: 2, zoom: 0.75 }, runs);

    await saveAssets([asset, { ...asset, id: 'unused' }]);
    await saveProject(project);
    const loaded = await loadProject();
    expect(loaded.project).toEqual(project);
    expect(loaded.assets.map(a => a.id).sort()).toEqual(['asset-1', 'unused']);

    await deleteAssets(['unused']);
    expect((await loadProject()).assets.map(a => a.id)).toEqual(['asset-1']);
  });

  it('refuses an unknown save format', async () => {
    await saveProject({ ...serializeProject(emptyGraph(), { x: 0, y: 0, zoom: 1 }), version: 2 as 1 });
    await expect(loadProject()).rejects.toThrow(/unsupported save format/);
  });
});
