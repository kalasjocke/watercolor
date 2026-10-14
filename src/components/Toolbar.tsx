import { useRef } from 'react';
import { acceptedTypes } from '../lib/assets';
import type { History } from '../useDocument';
import { Icon } from './Icons';

type Props = { name: string; history: History; canUndo: boolean; canRedo: boolean; onImport: (files: File[]) => void };

export function Toolbar({ name, history, canUndo, canRedo, onImport }: Props) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <header className="toolbar">
      <div className="brand"><img src="/favicon.svg" alt="" width={26} height={26} /><span>Watercolor</span></div>
      <span className="divider" />
      <input className="project-name" value={name} aria-label="Project name" spellCheck={false}
        onFocus={history.beginGesture} onBlur={history.endGesture}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        onChange={event => { const value = event.target.value; history.set(g => ({ ...g, name: value })); }} />
      <div className="toolbar-actions">
        <button className="icon-button" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={history.undo}><Icon name="undo" /></button>
        <button className="icon-button" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={history.redo}><Icon name="redo" /></button>
        <button className="primary-button" onClick={() => input.current?.click()}><Icon name="upload" />Import images</button>
        <input ref={input} type="file" hidden multiple accept={acceptedTypes.join(',')}
          onChange={event => { onImport([...event.target.files ?? []]); event.target.value = ''; }} />
      </div>
    </header>
  );
}
