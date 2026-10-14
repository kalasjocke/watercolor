import { useRef, useState, type MouseEvent } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useCanvas } from '../canvas-context';
import { kindLabels, type ImageNode, type NodeImage } from '../lib/graph';
import { Icon } from './Icons';
import { MenuButton, type MenuItem } from './Menu';

function placeholderText(image: NodeImage | undefined, hasInput: boolean) {
  if (image?.status === 'pending') return 'Generating…';
  if (image?.status === 'failed') return image.message;
  if (image?.status === 'ready') return 'Image unavailable';
  return hasInput ? 'Input image missing' : 'Connect an input';
}

export function ImageNodeView({ id, data, selected }: NodeProps<ImageNode>) {
  const { images, assets, incoming, actions } = useCanvas();
  const image = images.get(id);
  const asset = image?.status === 'ready' ? assets.get(image.assetId) : undefined;
  const [renaming, setRenaming] = useState(false);
  const cancelRename = useRef(false);
  // Card buttons stop the click so the node's own click handler does not replace the selection they make.
  const run = (action: () => void) => (event: MouseEvent) => { event.stopPropagation(); action(); };

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
        {asset
          ? <img src={asset.url} alt={data.name} draggable={false} />
          : <div className={`placeholder ${image?.status ?? 'missing'}`}><Icon name={image?.status === 'pending' ? 'prompt' : 'link'} size={20} />{placeholderText(image, incoming.has(id))}</div>}
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
