import { useCallback, useMemo, useReducer, useRef, useState, type RefObject } from 'react';
import { cleanGraph, type Graph } from './lib/graph';

type Update = Graph | ((graph: Graph) => Graph);
const same = (a: Graph, b: Graph) => JSON.stringify(a) === JSON.stringify(b);
const limit = 200;

// Keeps view-only state (selection, measured size) when an undo snapshot replaces the graph.
function restore(snapshot: Graph, current: Graph): Graph {
  const nodes = new Map(current.nodes.map(n => [n.id, n])), edges = new Map(current.edges.map(e => [e.id, e]));
  return {
    ...snapshot,
    nodes: snapshot.nodes.map(n => ({ ...n, selected: nodes.get(n.id)?.selected, measured: nodes.get(n.id)?.measured })),
    edges: snapshot.edges.map(e => ({ ...e, selected: edges.get(e.id)?.selected })),
  };
}

// The graph plus undo history. `set` changes without history, `commit` records one undo step,
// and a gesture (a node drag, a slider drag, a text field edit) records all its changes as one step.
export function useDocument(initial: Graph) {
  const [graph, setGraph] = useState(initial);
  const current = useRef(initial), past = useRef<Graph[]>([]), future = useRef<Graph[]>([]), gesture = useRef<Graph | null>(null);
  const [, refresh] = useReducer((x: number) => x + 1, 0);

  const set = useCallback((update: Update) => {
    const next = typeof update === 'function' ? update(current.current) : update;
    if (next === current.current) return;
    current.current = next;
    setGraph(next);
  }, []);
  const record = useCallback((before: Graph) => {
    if (same(before, cleanGraph(current.current))) return;
    past.current = [...past.current.slice(-limit + 1), before];
    future.current = [];
    refresh();
  }, []);
  const endGesture = useCallback(() => {
    const before = gesture.current;
    gesture.current = null;
    if (before) record(before);
  }, [record]);
  const beginGesture = useCallback(() => { gesture.current ??= cleanGraph(current.current); }, []);
  const commit = useCallback((update: Update) => {
    endGesture();
    const before = cleanGraph(current.current);
    set(update);
    record(before);
  }, [endGesture, record, set]);
  const travel = useCallback((from: RefObject<Graph[]>, to: RefObject<Graph[]>) => {
    endGesture();
    const snapshot = from.current.at(-1);
    if (!snapshot) return;
    from.current = from.current.slice(0, -1);
    to.current = [...to.current, cleanGraph(current.current)];
    set(restore(snapshot, current.current));
    refresh();
  }, [endGesture, set]);
  const undo = useCallback(() => travel(past, future), [travel]);
  const redo = useCallback(() => travel(future, past), [travel]);
  const history = useMemo(() => ({ set, commit, beginGesture, endGesture, undo, redo, current: () => current.current }), [set, commit, beginGesture, endGesture, undo, redo]);
  return { graph, history, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
export type History = ReturnType<typeof useDocument>['history'];
