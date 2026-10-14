import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  applyEdgeChanges, applyNodeChanges, Background, BackgroundVariant, MarkerType, Panel, ReactFlow, useReactFlow,
  type Connection, type Edge, type FinalConnectionState, type OnConnectEnd, type Viewport, type XYPosition,
} from '@xyflow/react';
import { CanvasContext, type CanvasActions, type LoadedAsset } from './canvas-context';
import { Icon } from './components/Icons';
import { ImageNodeView } from './components/ImageNode';
import { Inspector } from './components/Inspector';
import { Menu } from './components/Menu';
import { StepEdgeView } from './components/StepEdge';
import { Toolbar } from './components/Toolbar';
import { Viewer } from './components/Viewer';
import { openAI } from './config';
import { readImageFile } from './lib/assets';
import { createOpenAIProcessor } from './lib/openai';
import {
  addOriginal, addStep, duplicateStep, newRun, newStep, passThroughProcessor, removeItems, resolveNodes, selectOnly, serializeProject,
  snapGrid, stepKindFor, stepLabel, updateNode, updateStep, validateConnection, type Graph, type ImageNode, type ImageProcessor, type Run, type Runs, type Step, type StepEdge,
} from './lib/graph';
import { saveAssets, saveProject } from './lib/storage';
import { useAdjustedImages } from './useAdjustedImages';
import { useDocument } from './useDocument';

const nodeTypes = { image: ImageNodeView };
// Bottom padding keeps fitted nodes clear of the canvas controls.
const fitPadding = { top: '48px', right: '48px', bottom: '96px', left: '48px' } as const;
const edgeTypes = { step: StepEdgeView };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]');

export type StudioProps = { graph: Graph; viewport: Viewport; assets: Map<string, LoadedAsset>; runs: Runs; storageError?: string };

const live = openAI.enabled;
const processor: ImageProcessor = live ? createOpenAIProcessor({ model: openAI.model }) : passThroughProcessor;

function useToasts() {
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const notify = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts(list => [...list.filter(t => t.message !== message), { id, message }]);
    setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), 5000);
  }, []);
  return { toasts, notify, dismiss: (id: number) => setToasts(list => list.filter(t => t.id !== id)) };
}

// Saves the project shortly after it changes, and only speaks up when a save fails.
// Selection and other view-only changes are not saves.
function useAutosave(graph: Graph, viewport: Viewport, runs: Runs, blocked: string | undefined, notify: (message: string) => void) {
  const saved = useRef(JSON.stringify(serializeProject(graph, viewport, runs)));
  useEffect(() => {
    if (blocked) return;
    const project = serializeProject(graph, viewport, runs), json = JSON.stringify(project);
    if (json === saved.current) return;
    const timer = setTimeout(() => saveProject(project).then(
      () => { saved.current = json; },
      error => notify(`Changes couldn't be saved locally: ${errorText(error)} They stay open in this tab.`),
    ), 400);
    return () => clearTimeout(timer);
  }, [graph, viewport, runs, blocked, notify]);
}

export function Studio(props: StudioProps) {
  const { graph, history, canUndo, canRedo } = useDocument(props.graph);
  const [assets, setAssets] = useState(props.assets);
  const [viewport, setViewport] = useState(props.viewport);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [dropMenu, setDropMenu] = useState<{ at: XYPosition; position: XYPosition; sourceId: string } | null>(null);
  const [focusPromptFor, setFocusPromptFor] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const reconnecting = useRef<string | null>(null);
  const flow = useReactFlow<ImageNode, StepEdge>();
  const { toasts, notify, dismiss } = useToasts();
  const [runs, setRuns] = useState(props.runs);
  // Run callbacks finish later, so they read the latest runs and assets through refs.
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const nodes = useMemo(() => resolveNodes(graph, runs), [graph, runs]);
  // Stored images plus adjusted images computed in the browser.
  const { assets: allAssets, ensure: ensureAsset } = useAdjustedImages(nodes, assets);
  useAutosave(graph, viewport, runs, props.storageError, notify);
  const incoming = useMemo(() => new Map(graph.edges.map(e => [e.target, e])), [graph.edges]);

  useEffect(() => { if (props.storageError) notify(props.storageError); }, [props.storageError, notify]);

  // Brings the given nodes into view without zooming in past the current level.
  const reveal = useCallback((ids: string[]) => {
    requestAnimationFrame(() => flow.fitView({ nodes: ids.map(id => ({ id })), maxZoom: Math.max(flow.getZoom(), 0.5), padding: fitPadding, duration: 300 }));
  }, [flow]);

  const createStep = useCallback((sourceId: string, kind: Step['kind'], position?: XYPosition) => {
    let created: { nodeId: string; edgeId: string } | undefined;
    history.commit(g => { const result = addStep(g, sourceId, newStep(kind), position); created = result; return result.graph; });
    if (!created) return;
    setInspectorOpen(true);
    setFocusPromptFor(kind === 'prompt' ? created.edgeId : null);
    if (!position) reveal([sourceId, created.nodeId]);
  }, [history, reveal]);

  const connect = useCallback((source: string, target: string) => {
    const g = history.current(), error = validateConnection(g, source, target);
    if (error) return notify(error);
    const kind = stepKindFor(g.nodes.find(n => n.id === target)!.data.kind)!;
    const edge: StepEdge = { id: crypto.randomUUID(), type: 'step', source, target, data: newStep(kind) };
    history.commit(selectOnly({ ...g, edges: [...g.edges, edge] }, { edges: [edge.id] }));
    setInspectorOpen(true);
  }, [history, notify]);

  const updateRun = useCallback((stepId: string, runId: string, patch: Partial<Run>) => {
    setRuns(current => ({ ...current, [stepId]: (current[stepId] ?? []).map(r => r.id === runId ? { ...r, ...patch } : r) }));
  }, []);

  // Starts a run of a step on its current input, and picks the result when it arrives.
  const runStep = useCallback(async (edgeId: string) => {
    const g = history.current(), edge = g.edges.find(e => e.id === edgeId);
    const status = edge && resolveNodes(g, runsRef.current).get(edge.target);
    if (!edge || !status?.canRun || !status.inputAssetId) return;
    const input = await ensureAsset(status.inputAssetId).catch(() => undefined);
    if (!input) return notify('The input image is missing.');
    const run = newRun(input.id, edge.data);
    setRuns(current => ({ ...current, [edgeId]: [run, ...(current[edgeId] ?? [])] }));
    try {
      const processed = await processor.process({ input, step: edge.data, quality: 'draft' });
      // A computed (adjusted) image is never stored, so a run that returns one keeps a saved copy of it.
      const { blob, filename, width, height } = processed;
      const output = processed.id === input.id && !assets.has(input.id) ? { id: crypto.randomUUID(), blob, filename, width, height } : processed;
      if (output.id !== input.id) {
        try { await saveAssets([output]); }
        catch (error) { notify(`The draft couldn't be saved locally: ${errorText(error)} It stays open in this tab.`); }
        setAssets(current => new Map(current).set(output.id, { ...output, url: URL.createObjectURL(output.blob) }));
      }
      updateRun(edgeId, run.id, { status: 'done', assetId: output.id });
      history.commit(current => updateStep(current, edgeId, step => ({ ...step, pickedRunId: run.id })));
    } catch (error) {
      updateRun(edgeId, run.id, { status: 'failed', error: errorText(error) });
      notify(`${stepLabel(edge.data)} failed: ${errorText(error)}`);
    }
  }, [assets, ensureAsset, history, notify, updateRun]);

  const deleteSelection = useCallback(() => {
    const g = history.current();
    const nodes = new Set(g.nodes.filter(n => n.selected).map(n => n.id)), edges = new Set(g.edges.filter(e => e.selected).map(e => e.id));
    if (nodes.size || edges.size) history.commit(removeItems(g, nodes, edges));
  }, [history]);

  const actions = useMemo<CanvasActions>(() => ({
    createStep: (sourceId, kind) => createStep(sourceId, kind),
    duplicateStep: nodeId => {
      let created: string | undefined;
      history.commit(g => { const result = duplicateStep(g, nodeId); created = result?.nodeId; return result?.graph ?? g; });
      if (created) { setInspectorOpen(true); reveal([created]); }
    },
    renameNode: (nodeId, name) => history.commit(g => updateNode(g, nodeId, d => ({ ...d, name }))),
    deleteNode: nodeId => history.commit(g => removeItems(g, new Set([nodeId]), new Set())),
    selectEdge: edgeId => { history.set(g => selectOnly(g, { edges: [edgeId] })); setInspectorOpen(true); },
    openViewer: setViewerId,
    runStep: edgeId => { runStep(edgeId); },
    pickRun: (edgeId, runId) => history.commit(g => updateStep(g, edgeId, step => ({ ...step, pickedRunId: runId }))),
  }), [createStep, history, reveal, runStep]);

  const importFiles = useCallback(async (files: File[], at?: XYPosition) => {
    const loaded: LoadedAsset[] = [];
    for (const file of files) {
      try { const asset = await readImageFile(file); loaded.push({ ...asset, url: URL.createObjectURL(asset.blob) }); }
      catch (error) { notify(errorText(error)); }
    }
    if (!loaded.length) return;
    try { await saveAssets(loaded.map(a => ({ id: a.id, blob: a.blob, filename: a.filename, width: a.width, height: a.height }))); }
    catch (error) { notify(`Images couldn't be saved locally: ${errorText(error)} They stay open in this tab.`); }
    setAssets(current => new Map([...current, ...loaded.map(a => [a.id, a] as const)]));
    const ids = loaded.map(() => crypto.randomUUID());
    history.commit(g => {
      const start = at ?? (g.nodes.length ? { x: Math.min(...g.nodes.map(n => n.position.x)), y: Math.min(...g.nodes.map(n => n.position.y)) } : { x: 0, y: 0 });
      const next = loaded.reduce((acc, asset, i) => addOriginal(acc, asset, start, ids[i]), g);
      return selectOnly(next, { nodes: ids });
    });
    if (!at) reveal(ids);
  }, [history, notify, reveal]);

  const importSample = async () => {
    try {
      const response = await fetch('/demo/forest.jpg');
      if (!response.ok) throw new Error(`The sample photo is missing (${response.status}).`);
      await importFiles([new File([await response.blob()], 'forest.jpg', { type: 'image/jpeg' })]);
    } catch (error) { notify(errorText(error)); }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = isTyping(event.target), mod = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
      if (mod && key === 'z' && !typing) { event.preventDefault(); if (event.shiftKey) history.redo(); else history.undo(); }
      else if (mod && key === 'y' && !typing) { event.preventDefault(); history.redo(); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && !typing) { event.preventDefault(); deleteSelection(); }
      else if (event.key === 'Escape') {
        if (viewerId) setViewerId(null);
        else if (typing) (event.target as HTMLElement).blur();
        else { history.set(g => selectOnly(g, {})); setInspectorOpen(false); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, deleteSelection, viewerId]);

  const selectionKey = graph.nodes.filter(n => n.selected).map(n => n.id).concat(graph.edges.filter(e => e.selected).map(e => e.id)).join();
  useEffect(() => { if (selectionKey) setInspectorOpen(true); }, [selectionKey]);

  const isValidConnection = useCallback((c: Connection | Edge) => {
    const g = history.current(), replacing = reconnecting.current ?? undefined;
    const kind = replacing ? g.edges.find(e => e.id === replacing)?.data.kind : undefined;
    return !validateConnection(g, c.source, c.target, { replacing, kind });
  }, [history]);

  const onConnectEnd: OnConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (state.isValid || !state.fromNode || reconnecting.current) return;
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    const fromSource = state.fromHandle?.type === 'source', from = state.fromNode.id;
    const over = state.toNode?.id ?? document.elementFromPoint(point.clientX, point.clientY)?.closest('.react-flow__node')?.getAttribute('data-id');
    if (over) { if (over !== from) { if (fromSource) connect(from, over); else connect(over, from); } return; }
    if (fromSource) {
      const position = flow.screenToFlowPosition({ x: point.clientX, y: point.clientY });
      setDropMenu({ at: { x: point.clientX, y: point.clientY }, position: { x: position.x, y: position.y - 140 }, sourceId: from });
    }
  }, [connect, flow]);

  const onReconnect = useCallback((old: StepEdge, c: Connection) => {
    const g = history.current(), error = validateConnection(g, c.source, c.target, { replacing: old.id, kind: old.data.kind });
    if (error) return notify(error);
    history.commit({ ...g, edges: g.edges.map(e => e.id === old.id ? { ...e, source: c.source, target: c.target } : e) });
  }, [history, notify]);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const files = [...event.dataTransfer.files];
    if (files.length) importFiles(files, flow.screenToFlowPosition({ x: event.clientX - 130, y: event.clientY - 100 }));
  };

  const edges = useMemo(() => graph.edges.map(e => ({ ...e, markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: e.selected ? '#2563eb' : '#9aa3b2' } })), [graph.edges]);
  const viewerNode = viewerId ? graph.nodes.find(n => n.id === viewerId) : undefined;
  const viewerAssetId = viewerId ? nodes.get(viewerId)?.assetId : undefined;
  // Cards show previews of adjusted images, so the viewer asks for the full-size render.
  const [viewerFull, setViewerFull] = useState<LoadedAsset>();
  useEffect(() => {
    if (!viewerAssetId || allAssets.get(viewerAssetId) === assets.get(viewerAssetId)) return;
    let current = true;
    ensureAsset(viewerAssetId).then(asset => { if (current) setViewerFull(asset); }, () => {});
    return () => { current = false; };
  }, [viewerAssetId, ensureAsset]);
  const viewerAsset = viewerAssetId ? (viewerFull?.id === viewerAssetId ? viewerFull : allAssets.get(viewerAssetId)) : undefined;
  const context = useMemo(() => ({ nodes, runs, assets: allAssets, incoming, actions, live }), [nodes, runs, allAssets, incoming, actions]);

  return (
    <CanvasContext.Provider value={context}>
      <div className="app">
        <Toolbar name={graph.name} history={history} canUndo={canUndo} canRedo={canRedo} onImport={files => importFiles(files)} />
        <main className="workspace">
          <div className={`canvas${dragging ? ' dragging' : ''}`}
            onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
            onDragLeave={event => { if (event.currentTarget === event.target) setDragging(false); }}
            onDrop={onDrop}>
            <ReactFlow<ImageNode, StepEdge>
              nodes={graph.nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} defaultViewport={props.viewport}
              onNodesChange={changes => history.set(g => ({ ...g, nodes: applyNodeChanges(changes, g.nodes) }))}
              onEdgesChange={changes => history.set(g => ({ ...g, edges: applyEdgeChanges(changes, g.edges) }))}
              onNodeDragStart={history.beginGesture} onNodeDragStop={history.endGesture}
              onSelectionDragStart={history.beginGesture} onSelectionDragStop={history.endGesture}
              onConnect={c => connect(c.source, c.target)} onConnectEnd={onConnectEnd} isValidConnection={isValidConnection}
              onReconnect={onReconnect} onReconnectStart={(_, edge) => { reconnecting.current = edge.id; }} onReconnectEnd={() => { reconnecting.current = null; }}
              onMoveStart={() => setDropMenu(null)} onMoveEnd={(_, next) => setViewport(next)}
              snapToGrid snapGrid={snapGrid} deleteKeyCode={null} minZoom={0.1} maxZoom={2.5} proOptions={{ hideAttribution: true }}>
              <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color="#c9ced6" />
              <CanvasControls />
            </ReactFlow>
            {!graph.nodes.length && <EmptyState onImport={() => document.querySelector<HTMLInputElement>('.toolbar input[type=file]')?.click()} onSample={importSample} />}
            {dragging && <div className="drop-hint">Drop JPEG, PNG or WebP images to add them</div>}
          </div>
          <Inspector graph={graph} history={history} focusPromptFor={focusPromptFor} onDelete={deleteSelection} open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
        </main>
        {dropMenu && <Menu at={dropMenu.at} title="Add a step" onClose={() => setDropMenu(null)} items={[
          { label: 'Edit with prompt', icon: 'prompt', onSelect: () => createStep(dropMenu.sourceId, 'prompt', dropMenu.position) },
          { label: 'Create variation', icon: 'style', onSelect: () => createStep(dropMenu.sourceId, 'style', dropMenu.position) },
          { label: 'Adjust', icon: 'sliders', onSelect: () => createStep(dropMenu.sourceId, 'adjust', dropMenu.position) },
        ]} />}
        {viewerNode && viewerAsset && <Viewer asset={viewerAsset} name={viewerNode.data.name} onClose={() => setViewerId(null)} />}
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map(t => <div key={t.id} className="toast"><span>{t.message}</span><button className="icon-button" aria-label="Dismiss" onClick={() => dismiss(t.id)}><Icon name="close" size={14} /></button></div>)}
        </div>
      </div>
    </CanvasContext.Provider>
  );
}

function CanvasControls() {
  const flow = useReactFlow();
  return (
    <Panel position="bottom-left" className="canvas-controls">
      <button className="icon-button" aria-label="Zoom out" title="Zoom out" onClick={() => flow.zoomOut({ duration: 200 })}><Icon name="minus" /></button>
      <button className="icon-button" aria-label="Zoom in" title="Zoom in" onClick={() => flow.zoomIn({ duration: 200 })}><Icon name="plus" /></button>
      <button className="icon-button" aria-label="Fit all" title="Fit all" onClick={() => flow.fitView({ padding: fitPadding, duration: 300 })}><Icon name="fit" /></button>
      {openAI.enabled
        ? <span className="preview-pill" title={`Runs make low-quality drafts with ${openAI.model}.`}><span className="dot live" />OpenAI drafts</span>
        : <span className="preview-pill" title="No OpenAI key is set, so a run copies its input image."><span className="dot" />Preview mode</span>}
    </Panel>
  );
}

function EmptyState({ onImport, onSample }: { onImport: () => void; onSample: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-card">
        <h1>Start with a photo</h1>
        <p>Import an image, then edit it with a prompt or branch it into art styles. Everything stays in this browser.</p>
        <div className="empty-actions">
          <button className="primary-button" onClick={onImport}><Icon name="upload" />Import images</button>
          <button className="secondary-button" onClick={onSample}>Try a sample photo</button>
        </div>
        <p className="hint">Or drop JPEG, PNG or WebP files anywhere on the canvas.</p>
      </div>
    </div>
  );
}
