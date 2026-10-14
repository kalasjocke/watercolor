import type { LoadedAsset } from '../canvas-context';
import { Icon } from './Icons';

export function Viewer({ asset, name, onClose }: { asset: LoadedAsset; name: string; onClose: () => void }) {
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={name} onClick={onClose}>
      <figure onClick={event => event.stopPropagation()}>
        <img src={asset.url} alt={name} />
        <figcaption><strong>{name}</strong><span>{asset.width} × {asset.height} · {asset.filename}</span></figcaption>
      </figure>
      <button className="icon-button viewer-close" aria-label="Close viewer" autoFocus onClick={onClose}><Icon name="close" size={18} /></button>
    </div>
  );
}
