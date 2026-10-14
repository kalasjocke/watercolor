import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { useCanvas } from '../canvas-context';
import { kindLabels, type ImageNode, type NodeStatus } from '../lib/graph';
import { changedAdjustments, drawAdjusted, prepareAdjust, type AdjustValues } from '../lib/adjust';
import { subscribeLive } from '../livePreview';
import { changedSettings } from '../lib/presets';
import { Icon } from './Icons';
import { MenuButton, type MenuItem } from './Menu';

// While an Adjust slider moves, draws each value on the GPU into a canvas over the card's image, outside React.
// After the drag, the canvas stays until the card shows the regular preview for the final values (`current`).
function LiveCanvas({ edgeId, input, current }: { edgeId: string; input?: Blob; current: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null), inputRef = useRef(input), currentRef = useRef(current), ending = useRef(false);
  inputRef.current = input;
  currentRef.current = current;
  // Hides the canvas once the image under it is the final preview and has loaded.
  const handOver = useRef(() => {
    const target = canvas.current, image = target?.previousElementSibling;
    if (!target || !ending.current || !currentRef.current || !(image instanceof HTMLImageElement)) return;
    if (image.complete) { target.hidden = true; ending.current = false; }
    else image.addEventListener('load', handOver.current, { once: true });
  });
  useEffect(() => { handOver.current(); });
  useEffect(() => {
    let latest: AdjustValues | undefined;
    const draw = () => {
      const target = canvas.current, blob = inputRef.current;
      if (!target || !blob || !latest) return;
      if (drawAdjusted(target, blob, latest)) { target.hidden = false; ending.current = false; }
      else prepareAdjust(blob).then(draw, () => {});
    };
    return subscribeLive(edgeId, values => {
      latest = values;
      if (values) draw();
      else { ending.current = true; handOver.current(); }
    });
  }, [edgeId]);
  return <canvas ref={canvas} className="live-canvas" hidden />;
}

// What an output card shows before it has an image.
function emptyText(status: NodeStatus, blockerName: string | undefined) {
  if (!status.hasInput) return 'Connect an input';
  if (status.error) return `Run failed: ${status.error}`;
  if (status.assetId) return 'Image unavailable';
  if (status.blockedBy) return `Run ${blockerName ?? 'the step before'} first`;
  return 'Not run yet';
}

export function ImageNodeView({ id, data, selected }: NodeProps<ImageNode>) {
  const { nodes, assets, incoming, actions } = useCanvas();
  const flow = useReactFlow<ImageNode>();
  const status = nodes.get(id) ?? { stale: false, ready: false, pending: false, hasInput: false, canRun: false };
  const asset = status.assetId ? assets.get(status.assetId) : undefined;
  const edge = incoming.get(id);
  const changed = edge?.data.kind === 'style' ? changedSettings(edge.data) : edge?.data.kind === 'adjust' ? changedAdjustments(edge.data.values) : [];
  const blockerName = status.blockedBy ? flow.getNode(status.blockedBy)?.data.name : undefined;
  const [renaming, setRenaming] = useState(false);
  const cancelRename = useRef(false);
  // Card buttons stop the click so the node's own click handler does not replace the selection they make.
  const run = (action: () => void) => (event: MouseEvent) => { event.stopPropagation(); action(); };
  const runButton = (label: string) => edge && status.canRun
    ? <button className="pill-button nodrag" onClick={run(() => actions.runStep(edge.id))}>{label}</button> : null;

  const items: MenuItem[] = [
    { label: 'Rename', onSelect: () => setRenaming(true) },
    { label: 'Edit with prompt', icon: 'prompt', onSelect: () => actions.createStep(id, 'prompt') },
    { label: 'Create variation', icon: 'style', onSelect: () => actions.createStep(id, 'style') },
    { label: 'Adjust', icon: 'sliders', onSelect: () => actions.createStep(id, 'adjust') },
    ...(incoming.has(id) ? [{ label: 'Duplicate step', onSelect: () => actions.duplicateStep(id) }] : []),
    ...(asset ? [{ label: 'View larger', icon: 'eye' as const, onSelect: () => actions.openViewer(id) }] : []),
    { label: 'Delete', danger: true, onSelect: () => actions.deleteNode(id) },
  ];

  return (
    <div className={`image-card${selected ? ' selected' : ''}`}>
      {data.kind !== 'original' && <Handle type="target" position={Position.Left} />}
      <div className="preview" onDoubleClick={() => asset && actions.openViewer(id)} title={asset ? 'Double-click to view larger' : undefined}>
        {asset && data.kind === 'original' && <img src={asset.url} alt={data.name} draggable={false} />}
        {asset && data.kind !== 'original' && <>
          {edge?.data.kind === 'adjust'
            ? <div className="live-frame">
                <img src={asset.url} alt={data.name} draggable={false} className={status.stale ? 'stale' : undefined} />
                <LiveCanvas edgeId={edge.id} input={status.adjusts ? assets.get(status.adjusts)?.blob : undefined} current={asset.id === status.assetId} />
              </div>
            : <img src={asset.url} alt={data.name} draggable={false} className={status.stale ? 'stale' : undefined} />}
          {(status.pending || status.stale || status.error) && <div className="preview-status">
            <span className={`status-pill${status.error && !status.pending ? ' failed' : ''}`} title={status.error}>
              {status.pending ? <><span className="spinner" />Generating…</> : status.stale ? 'Out of date' : 'Run failed'}
            </span>
            {!status.pending && runButton(status.stale ? 'Run' : 'Retry')}
          </div>}
        </>}
        {!asset && (data.kind === 'original'
          ? <div className="placeholder">Image unavailable</div>
          : status.pending || status.derivedFrom
            ? <div className="placeholder"><span className="status-pill"><span className="spinner" />{status.pending ? 'Generating…' : 'Adjusting…'}</span></div>
            : <div className={`placeholder${status.error ? ' failed' : ''}`}>
                <Icon name={status.hasInput ? 'style' : 'link'} size={20} />
                <span className="placeholder-text" title={emptyText(status, blockerName)}>{emptyText(status, blockerName)}</span>
                {runButton(status.error ? 'Retry' : 'Run')}
              </div>)}
      </div>
      <div className="card-body">
        <div className="card-title-row">
          {renaming
            ? <input className="rename nodrag" autoFocus defaultValue={data.name} aria-label="Image name"
                onFocus={event => event.currentTarget.select()}
                onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { cancelRename.current = true; event.currentTarget.blur(); } }}
                onBlur={event => { if (!cancelRename.current && event.currentTarget.value.trim()) actions.renameNode(id, event.currentTarget.value.trim()); cancelRename.current = false; setRenaming(false); }} />
            : <span className="card-title" onDoubleClick={run(() => setRenaming(true))} title={data.name}>{data.name}</span>}
          <MenuButton items={items} label="More actions" />
        </div>
        <div className="card-meta">
          <span className={`badge ${data.kind}`}>{kindLabels[data.kind]}</span>
          <span>{asset ? `${asset.width} × ${asset.height}` : 'No image'}</span>
        </div>
        {changed.length > 0 && <ul className="card-settings" aria-label="Changed settings">{changed.map(label => <li key={label}>{label}</li>)}</ul>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
