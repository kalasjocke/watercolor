import { useMemo, useReducer, useRef } from 'react';
import { processingKey, resolveImages, type Graph, type ImageProcessor, type NodeImage } from './lib/graph';

// Runs each step through the processor once per input and settings, caching results by processing key.
export function useProcessedImages(graph: Graph, processor: ImageProcessor) {
  const cache = useRef(new Map<string, NodeImage>());
  const [version, refresh] = useReducer((x: number) => x + 1, 0);
  return useMemo(() => resolveImages(graph, (input, step) => {
    const key = processingKey(input, step);
    const cached = cache.current.get(key);
    if (cached) return cached;
    const output = processor.process(input, step);
    if (typeof output === 'string') {
      const image: NodeImage = { status: 'ready', assetId: output };
      cache.current.set(key, image);
      return image;
    }
    cache.current.set(key, { status: 'pending' });
    output
      .then(assetId => cache.current.set(key, { status: 'ready', assetId }), (error: unknown) => cache.current.set(key, { status: 'failed', message: error instanceof Error ? error.message : 'Processing failed.' }))
      .finally(refresh);
    return { status: 'pending' };
    // `version` re-runs resolution when an async result arrives.
  }), [graph.nodes, graph.edges, processor, version]);
}
