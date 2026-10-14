import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icons';

export type MenuItem = { label: string; icon?: IconName; onSelect: () => void; danger?: boolean };

// A popup list rendered at screen coordinates, so it stays above canvas nodes.
export function Menu({ at, items, onClose, title }: { at: { x: number; y: number }; items: MenuItem[]; onClose: () => void; title?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('wheel', onClose, true);
    window.addEventListener('resize', onClose);
    ref.current?.querySelector('button')?.focus();
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('wheel', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  const left = Math.min(at.x, window.innerWidth - 220), top = Math.min(at.y, window.innerHeight - 48 * items.length - 24);
  return createPortal(
    // React events bubble through portals; stop them so a menu click does not also select the node behind it.
    <div ref={ref} className="menu" role="menu" style={{ left, top }} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      {title && <div className="menu-title">{title}</div>}
      {items.map(item => (
        <button key={item.label} role="menuitem" className={item.danger ? 'menu-item danger' : 'menu-item'} onClick={() => { onClose(); item.onSelect(); }}>
          {item.icon && <Icon name={item.icon} />}{item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

export function MenuButton({ items, label, className = 'icon-button' }: { items: MenuItem[]; label: string; className?: string }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setAt(null), []);
  return (
    <>
      <button className={`${className} nodrag`} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={!!at}
        onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setAt(at ? null : { x: rect.right - 200, y: rect.bottom + 4 }); }}>
        <Icon name="more" />
      </button>
      {at && <Menu at={at} items={items} onClose={close} />}
    </>
  );
}
