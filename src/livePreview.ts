import type { AdjustValues } from './lib/adjust';

// A plain publish and subscribe channel from the Adjust sliders to the Adjust card, outside React. While a slider
// moves, the card draws each new value on the GPU straight into a canvas, so the drag never waits for a render.
// `undefined` means the drag ended and the card can go back to its regular image.
type Listener = (values: AdjustValues | undefined) => void;
const listeners = new Map<string, Set<Listener>>();

export function publishLive(edgeId: string, values: AdjustValues | undefined): void {
  listeners.get(edgeId)?.forEach(listener => listener(values));
}

export function subscribeLive(edgeId: string, listener: Listener): () => void {
  const set = listeners.get(edgeId) ?? new Set<Listener>();
  listeners.set(edgeId, set);
  set.add(listener);
  return () => { set.delete(listener); if (!set.size) listeners.delete(edgeId); };
}
