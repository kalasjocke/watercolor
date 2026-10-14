import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LoadedAsset } from './canvas-context';
import { adjustLongSide, prepareAdjust, previewLongSide, renderAdjusted } from './lib/adjust';
import type { NodeStatus } from './lib/graph';

type Size = 'preview' | 'full';
const longSide: Record<Size, number> = { preview: previewLongSide, full: adjustLongSide };
const fit = (width: number, height: number, side: number) => { const scale = Math.min(1, side / Math.max(width, height)); return { width: Math.round(width * scale), height: Math.round(height * scale) }; };

// Computes adjusted images on the GPU and keeps them in memory; they are never saved.
// Cards show small previews, rendered again on every slider move once the previous render is done. A card shows its
// last preview until the new one is ready. Full-size images are rendered only when an AI run or the viewer needs one.
export function useAdjustedImages(nodes: Map<string, NodeStatus>, stored: Map<string, LoadedAsset>) {
  const [previews, setPreviews] = useState<Map<string, LoadedAsset>>(new Map());
  const nodesRef = useRef(nodes), storedRef = useRef(stored), previewsRef = useRef(previews);
  nodesRef.current = nodes;
  storedRef.current = stored;
  const full = useRef(new Map<string, LoadedAsset>());
  const jobs = useRef(new Map<string, Promise<LoadedAsset | undefined>>());
  const busy = useRef(new Set<string>()), failed = useRef(new Set<string>()), prepared = useRef(new WeakSet<Blob>());
  const lastShown = useRef(new Map<string, LoadedAsset>());

  const publish = useCallback(() => { previewsRef.current = new Map(previewsRef.current); setPreviews(previewsRef.current); }, []);

  // Returns the image with this id at the given size, computing it (and any adjusted image it depends on) when needed.
  const render = useCallback((id: string, size: Size): Promise<LoadedAsset | undefined> => {
    const have = storedRef.current.get(id) ?? (size === 'full' ? full.current : previewsRef.current).get(id);
    if (have) return Promise.resolve(have);
    const key = `${size}:${id}`, running = jobs.current.get(key);
    if (running) return running;
    const recipe = [...nodesRef.current.values()].find(s => s.assetId === id && s.derivedFrom)?.derivedFrom;
    if (!recipe) return Promise.resolve(undefined);
    const job = (async () => {
      const input = await render(recipe.inputAssetId, size);
      if (!input) return undefined;
      const output = await renderAdjusted(input.blob, recipe.values, longSide[size]);
      // Previews report the full-size dimensions, which is what the card and inspector show.
      const asset: LoadedAsset = { id, filename: input.filename, blob: output.blob, ...fit(input.width, input.height, adjustLongSide), url: URL.createObjectURL(output.blob) };
      if (size === 'full') {
        full.current.set(id, asset);
        // Full renders are only kept for the few most recent requests.
        for (const [oldId, old] of full.current) if (full.current.size > 4) { URL.revokeObjectURL(old.url); full.current.delete(oldId); }
      } else {
        previewsRef.current = new Map(previewsRef.current).set(id, asset);
        setPreviews(previewsRef.current);
      }
      return asset;
    })();
    jobs.current.set(key, job);
    const done = () => { jobs.current.delete(key); };
    job.then(done, done);
    return job;
  }, []);

  useEffect(() => {
    // Decodes each Adjust card's input at preview size and uploads it to the GPU before the first slider move.
    for (const status of nodes.values()) {
      const input = status.adjusts && (storedRef.current.get(status.adjusts) ?? previewsRef.current.get(status.adjusts));
      if (input && !prepared.current.has(input.blob)) { prepared.current.add(input.blob); prepareAdjust(input.blob).catch(() => {}); }
    }
    // Renders each card's current preview, one render per card at a time.
    for (const [nodeId, status] of nodes) {
      const id = status.assetId;
      if (!status.derivedFrom || !id || previewsRef.current.has(id) || busy.current.has(nodeId) || failed.current.has(id)) continue;
      busy.current.add(nodeId);
      render(id, 'preview').catch(() => { failed.current.add(id); }).finally(() => { busy.current.delete(nodeId); publish(); });
    }
    // Drops previews no card shows any more, and frees their object URLs.
    for (const nodeId of lastShown.current.keys()) if (!nodes.has(nodeId)) lastShown.current.delete(nodeId);
    const keep = new Set([...nodes.values()].flatMap(s => s.assetId ? [s.assetId] : []));
    for (const [nodeId, status] of nodes) {
      const current = status.assetId && previewsRef.current.get(status.assetId);
      if (current) lastShown.current.set(nodeId, current);
      const last = lastShown.current.get(nodeId);
      if (last) keep.add(last.id);
    }
    const unused = [...previewsRef.current.values()].filter(a => !keep.has(a.id) && !jobs.current.has(`preview:${a.id}`));
    if (unused.length) {
      unused.forEach(a => URL.revokeObjectURL(a.url));
      previewsRef.current = new Map([...previewsRef.current].filter(([id]) => keep.has(id)));
      setPreviews(previewsRef.current);
    }
  }, [nodes, previews, render, publish]);

  // Stored images plus previews. A card whose current preview is still rendering shows its last one.
  const assets = useMemo(() => {
    const all = new Map([...stored, ...previews]);
    for (const [nodeId, status] of nodes) {
      const last = lastShown.current.get(nodeId);
      if (!status.derivedFrom || !status.assetId || all.has(status.assetId)) continue;
      // Before a card's first preview exists, it shows its input, so the card never drops back to a placeholder.
      const fallback = last ?? (status.adjusts ? all.get(status.adjusts) : undefined);
      if (fallback) all.set(status.assetId, fallback);
    }
    return all;
  }, [stored, previews, nodes]);

  // The full-size image with this id, for AI runs and the viewer.
  const ensure = useCallback((id: string) => render(id, 'full'), [render]);
  return { assets, ensure };
}
