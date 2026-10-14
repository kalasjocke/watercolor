import { useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { emptyGraph, initialViewport, loadedRuns, referencedAssets } from './lib/graph';
import { deleteAssets, loadProject } from './lib/storage';
import { Studio, type StudioProps } from './Studio';

async function load(): Promise<StudioProps> {
  try {
    const { project, assets } = await loadProject();
    const graph = project ? { name: project.name, nodes: project.nodes, edges: project.edges } : emptyGraph();
    // Undo history is not saved, so assets that no node or run refers to can never come back.
    const runs = loadedRuns(graph, project?.runs);
    const used = referencedAssets(graph, runs), unused = assets.filter(a => !used.has(a.id)).map(a => a.id);
    if (unused.length) deleteAssets(unused).catch(() => {});
    const loaded = new Map(assets.filter(a => used.has(a.id)).map(a => [a.id, { ...a, url: URL.createObjectURL(a.blob) }]));
    return { graph, viewport: project?.viewport ?? initialViewport, assets: loaded, runs };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { graph: emptyGraph(), viewport: initialViewport, assets: new Map(), runs: {}, storageError: `Saved work couldn't be opened: ${reason} Changes in this tab won't be saved.` };
  }
}

export function App() {
  const [state, setState] = useState<StudioProps | null>(null);
  useEffect(() => {
    let cancelled = false;
    load().then(result => {
      if (cancelled) result.assets.forEach(a => URL.revokeObjectURL(a.url));
      else setState(result);
    });
    return () => { cancelled = true; };
  }, []);
  if (!state) return <div className="loading">Opening your canvas…</div>;
  return <ReactFlowProvider><Studio {...state} /></ReactFlowProvider>;
}
