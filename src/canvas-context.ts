import { createContext, useContext } from 'react';
import type { Asset, NodeImage, Step, StepEdge } from './lib/graph';

export type LoadedAsset = Asset & { url: string };
export type CanvasActions = {
  createStep(sourceId: string, kind: Step['kind']): void;
  duplicateStep(nodeId: string): void;
  renameNode(nodeId: string, name: string): void;
  deleteNode(nodeId: string): void;
  selectEdge(edgeId: string): void;
  openViewer(nodeId: string): void;
};
export type CanvasContextValue = { images: Map<string, NodeImage>; assets: Map<string, LoadedAsset>; incoming: Map<string, StepEdge>; actions: CanvasActions };

export const CanvasContext = createContext<CanvasContextValue | null>(null);
export function useCanvas() {
  const value = useContext(CanvasContext);
  if (!value) throw new Error('useCanvas must be used inside CanvasContext.');
  return value;
}
