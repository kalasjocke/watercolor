import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LoadedAsset } from './canvas-context';
import { renderAdjusted } from './lib/adjust';
import type { NodeStatus } from './lib/graph';

// Computes adjusted images in the browser and keeps the current ones in memory. They are never saved.
// While a slider moves, each card renders its latest settings once the previous render finishes, and shows its
// last rendered image in the meantime.
export function useAdjustedImages(nodes: Map<string, NodeStatus>, stored: Map<string, LoadedAsset>) {
  const [rendered, setRendered] = useState<Map<string, LoadedAsset>>(new Map());
  const nodesRef = useRef(nodes), storedRef = useRef(stored), renderedRef = useRef(rendered);
  nodesRef.current = nodes;
  storedRef.current = stored;
  const jobs = useRef(new Map<string, Promise<LoadedAsset | undefined>>());
  const busy = useRef(new Set<string>());
  const lastShown = useRef(new Map<string, LoadedAsset>());
  const failed = useRef(new Set<string>());

  // Returns the image with this id, computing it (and any adjusted image it depends on) when needed.
  const ensure = useCallback((id: string): Promise<LoadedAsset | undefined> => {
    const have = storedRef.current.get(id) ?? renderedRef.current.get(id);
    if (have) return Promise.resolve(have);
    const running = jobs.current.get(id);
    if (running) return running;
    const recipe = [...nodesRef.current.values()].find(s => s.assetId === id && s.derivedFrom)?.derivedFrom;
    if (!recipe) return Promise.resolve(undefined);
    const job = (async () => {
      const input = await ensure(recipe.inputAssetId);
      if (!input) return undefined;
      const output = await renderAdjusted(input.blob, recipe.values);
      const asset: LoadedAsset = { id, filename: input.filename, ...output, url: URL.createObjectURL(output.blob) };
      renderedRef.current = new Map(renderedRef.current).set(id, asset);
      setRendered(renderedRef.current);
      return asset;
    })();
    jobs.current.set(id, job);
    const done = () => { jobs.current.delete(id); };
    job.then(done, done);
    return job;
  }, []);

  // Renders each adjusted card's current image, one render per card at a time.
  useEffect(() => {
    for (const [nodeId, status] of nodes) {
      const id = status.assetId;
      if (!status.derivedFrom || !id || renderedRef.current.has(id) || busy.current.has(nodeId) || failed.current.has(id)) continue;
      busy.current.add(nodeId);
      ensure(id).catch(() => { failed.current.add(id); }).finally(() => {
        busy.current.delete(nodeId);
        renderedRef.current = new Map(renderedRef.current);
        setRendered(renderedRef.current);
      });
    }
    for (const nodeId of lastShown.current.keys()) if (!nodes.has(nodeId)) lastShown.current.delete(nodeId);
    // Drop images no card shows any more, and free their object URLs.
    const keep = new Set([...nodes.values()].flatMap(s => s.assetId ? [s.assetId] : []));
    for (const [nodeId, status] of nodes) {
      const current = status.assetId && renderedRef.current.get(status.assetId);
      if (current) lastShown.current.set(nodeId, current);
      const last = lastShown.current.get(nodeId);
      if (last) keep.add(last.id);
    }
    const stale = [...renderedRef.current.values()].filter(a => !keep.has(a.id) && !jobs.current.has(a.id));
    if (stale.length) {
      stale.forEach(a => URL.revokeObjectURL(a.url));
      renderedRef.current = new Map([...renderedRef.current].filter(([id]) => keep.has(id)));
      setRendered(renderedRef.current);
    }
  }, [nodes, rendered, ensure]);

  // Stored images plus computed ones. A card whose current image is still rendering shows its last one.
  const assets = useMemo(() => {
    const all = new Map([...stored, ...rendered]);
    for (const [nodeId, status] of nodes) {
      const last = lastShown.current.get(nodeId);
      if (status.derivedFrom && status.assetId && !all.has(status.assetId) && last) all.set(status.assetId, last);
    }
    return all;
  }, [stored, rendered, nodes]);

  return { assets, ensure };
}
