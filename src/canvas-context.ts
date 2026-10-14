import { createContext, useContext } from 'react';
import type { Asset, NodeStatus, Runs, Step, StepEdge } from './lib/graph';

export type LoadedAsset = Asset & { url: string };
export type CanvasActions = {
  createStep(sourceId: string, kind: Step['kind']): void;
  duplicateStep(nodeId: string): void;
  renameNode(nodeId: string, name: string): void;
  deleteNode(nodeId: string): void;
  selectEdge(edgeId: string): void;
  openViewer(nodeId: string): void;
  runStep(edgeId: string): void;
  pickRun(edgeId: string, runId: string): void;
};
// `live` is true when runs call a real image model, and false for the pass-through processor.
export type CanvasContextValue = { nodes: Map<string, NodeStatus>; runs: Runs; assets: Map<string, LoadedAsset>; incoming: Map<string, StepEdge>; actions: CanvasActions; live: boolean };

export const CanvasContext = createContext<CanvasContextValue | null>(null);
export function useCanvas() {
  const value = useContext(CanvasContext);
  if (!value) throw new Error('useCanvas must be used inside CanvasContext.');
  return value;
}
