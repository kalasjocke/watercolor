import { useRef, useState, type MouseEvent } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { useCanvas } from '../canvas-context';
import { kindLabels, type ImageNode, type NodeStatus } from '../lib/graph';
import { Icon } from './Icons';
import { MenuButton, type MenuItem } from './Menu';

// What an output card shows before it has an image.
function emptyText(status: NodeStatus, blockerName: string | undefined) {
  if (!status.hasInput) return 'Connect an input';
  if (status.pending) return 'Making a draft…';
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
          <img src={asset.url} alt={data.name} draggable={false} className={status.stale ? 'stale' : undefined} />
          {(status.pending || status.stale || status.error) && <div className="preview-status">
            <span className={`status-pill${status.error && !status.pending ? ' failed' : ''}`} title={status.error}>
              {status.pending ? <><span className="spinner" />Generating…</> : status.stale ? 'Out of date' : 'Run failed'}
            </span>
            {!status.pending && runButton(status.stale ? 'Run' : 'Retry')}
          </div>}
        </>}
        {!asset && (data.kind === 'original'
          ? <div className="placeholder">Image unavailable</div>
          : <div className={`placeholder${status.error && !status.pending ? ' failed' : ''}`}>
              {status.pending ? <span className="spinner large" /> : <Icon name={status.hasInput ? 'style' : 'link'} size={20} />}
              <span>{emptyText(status, blockerName)}</span>
              {!status.pending && runButton(status.error ? 'Retry' : 'Run')}
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
        <div className="card-actions">
          <button className="small-button nodrag" onClick={run(() => actions.createStep(id, 'prompt'))}>Edit with prompt</button>
          <button className="small-button nodrag" onClick={run(() => actions.createStep(id, 'style'))}>Create variation</button>
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
