import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useCanvas } from '../canvas-context';
import { openAI } from '../config';
import { colorControls, defaultAdjust, isIdentity, lightControls, type AdjustControl, type AdjustKey } from '../lib/adjust';
import { kindLabels, stepLabel, switchPreset, updateNode, updateStep, type AdjustStep, type Graph, type ImageNode, type PromptStep, type StepEdge, type StyleStep } from '../lib/graph';
import { defaultSettings, getSettings, preserveLabels, presets, sharedControls, type Control, type PresetId, type PreserveKey } from '../lib/presets';
import type { History } from '../useDocument';
import { Icon } from './Icons';

const examplePrompts = ['Remove the black car in the background', 'Make it a snowy winter day', 'Change the light to golden hour'];

type Props = { graph: Graph; history: History; focusPromptFor: string | null; onDelete: () => void; onClose: () => void; open: boolean };

export function Inspector({ graph, history, focusPromptFor, onDelete, onClose, open }: Props) {
  const nodes = graph.nodes.filter(n => n.selected), edges = graph.edges.filter(e => e.selected);
  let content: ReactNode;
  if (nodes.length + edges.length > 1) content = <MultiInspector count={nodes.length + edges.length} onDelete={onDelete} />;
  else if (edges.length === 1) {
    const edge = edges[0], step = edge.data;
    content = step.kind === 'prompt' ? <PromptInspector key={edge.id} graph={graph} edge={edge} step={step} history={history} autoFocus={focusPromptFor === edge.id} />
      : step.kind === 'style' ? <StyleInspector key={edge.id} graph={graph} edge={edge} step={step} history={history} />
      : <AdjustInspector key={edge.id} graph={graph} edge={edge} step={step} history={history} />;
  }
  else if (nodes.length === 1) content = <NodeInspector key={nodes[0].id} graph={graph} node={nodes[0]} history={history} />;
  else content = <CanvasHelp />;
  return (
    <aside className={`inspector${open ? ' open' : ''}`} aria-label="Settings">
      <button className="icon-button inspector-close" aria-label="Close settings" onClick={onClose}><Icon name="close" /></button>
      {content}
    </aside>
  );
}

// A text field whose edits, from focus to blur, form one undo step.
function TextField({ label, value, placeholder, history, onChange, multiline, autoFocus, onSubmit }: { label: string; value: string; placeholder?: string; history: History; onChange: (value: string) => void; multiline?: boolean; autoFocus?: boolean; onSubmit?: () => void }) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  const props = {
    ref, value, placeholder, 'aria-label': label,
    onFocus: history.beginGesture, onBlur: history.endGesture,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
  };
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {multiline
        ? <textarea {...props} rows={4} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onSubmit?.(); } }} />
        : <input {...props} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />}
    </label>
  );
}

function StepHeader({ graph, edge, history, kind }: { graph: Graph; edge: StepEdge; history: History; kind: string }) {
  const name = (id: string) => graph.nodes.find(n => n.id === id)?.data.name ?? 'Unknown';
  return (
    <>
      <div className="inspector-eyebrow">{kind}</div>
      <TextField label="Step name" value={edge.data.name} placeholder={stepLabel({ ...edge.data, name: '' })} history={history}
        onChange={value => history.set(g => updateStep(g, edge.id, step => ({ ...step, name: value })))} />
      <p className="route">From <strong>{name(edge.source)}</strong> to <strong>{name(edge.target)}</strong></p>
    </>
  );
}

function PromptInspector({ graph, edge, step, history, autoFocus }: { graph: Graph; edge: StepEdge; step: PromptStep; history: History; autoFocus: boolean }) {
  const { nodes, actions } = useCanvas();
  const setPrompt = (prompt: string) => (g: Graph) => updateStep(g, edge.id, s => ({ ...s, prompt }));
  const empty = !step.prompt.trim();
  const runIfReady = () => { if (!empty && nodes.get(edge.target)?.canRun) actions.runStep(edge.id); };
  return (
    <div className="inspector-body">
      <StepHeader graph={graph} edge={edge} history={history} kind="Prompt step" />
      <TextField label="Prompt" multiline value={step.prompt} placeholder="Remove the black car in the background" history={history}
        autoFocus={autoFocus} onSubmit={runIfReady} onChange={value => history.set(setPrompt(value))} />
      <div className="chips">
        {examplePrompts.map(prompt => <button key={prompt} className="chip" onClick={() => history.commit(setPrompt(prompt))}>{prompt}</button>)}
      </div>
      <RunPanel graph={graph} edge={edge} disabledReason={empty ? 'Write a prompt first.' : undefined} shortcut />
    </div>
  );
}

function StyleInspector({ graph, edge, step, history }: { graph: Graph; edge: StepEdge; step: StyleStep; history: History }) {
  const preset = presets[step.preset], settings = getSettings(step);
  const change = (update: (step: StyleStep) => StyleStep) => (g: Graph) => updateStep(g, edge.id, s => update(s as StyleStep));
  const withSettings = (update: (values: typeof settings) => typeof settings) => change(s => ({ ...s, settings: { ...s.settings, [s.preset]: update(getSettings(s)) } }));
  const slider = (control: Control) => (
    <Slider key={control.key} control={control} value={settings.values[control.key] ?? 50} history={history}
      onChange={value => history.set(withSettings(v => ({ ...v, values: { ...v.values, [control.key]: value } })))} />
  );
  return (
    <div className="inspector-body">
      <StepHeader graph={graph} edge={edge} history={history} kind="Style step" />
      <label className="field">
        <span className="field-label">Style</span>
        <select value={step.preset} onChange={event => history.commit(change(s => switchPreset(s, event.target.value as PresetId)))}>
          {Object.entries(presets).map(([id, p]) => <option key={id} value={id}>{p.name} · {p.japanese}</option>)}
        </select>
      </label>
      <p className="hint">{preset.description}</p>
      <RunPanel graph={graph} edge={edge} />
      <section className="group"><h3>Shared</h3>{sharedControls.map(slider)}</section>
      <section className="group"><h3>{preset.short}</h3>{preset.controls.map(slider)}</section>
      <section className="group">
        <h3>Preserve</h3>
        {(Object.keys(preserveLabels) as PreserveKey[]).map(key => (
          <div className="switch-row" key={key}>
            <span>{preserveLabels[key]}</span>
            <button role="switch" aria-checked={settings.preserve[key]} aria-label={`Preserve ${preserveLabels[key]}`} className="switch"
              onClick={() => history.commit(withSettings(v => ({ ...v, preserve: { ...v.preserve, [key]: !v.preserve[key] } })))}><span /></button>
          </div>
        ))}
      </section>
      <button className="secondary-button" onClick={() => history.commit(withSettings(() => defaultSettings(step.preset)))}>Reset settings</button>
    </div>
  );
}

// A range input whose drag, or run of arrow-key presses, forms one undo step.
// With a negative `min`, the track fills from 0, and the value can be clicked to reset it to 0.
function Slider({ control, value, history, onChange, min = 0 }: { control: Pick<Control, 'label' | 'low' | 'high'>; value: number; history: History; onChange: (value: number) => void; min?: number }) {
  const percent = (v: number) => `${(v - min) / (100 - min) * 100}%`;
  const from = min < 0 ? Math.min(0, value) : min, to = min < 0 ? Math.max(0, value) : value;
  const shown = min < 0 && value > 0 ? `+${value}` : `${value}`;
  return (
    <div className="slider">
      <div className="slider-head"><span>{control.label}</span>
        {min < 0 && value !== 0
          ? <button className="slider-reset" title={`Reset ${control.label} to 0`} onClick={() => { history.beginGesture(); onChange(0); history.endGesture(); }}>{shown}</button>
          : <output>{shown}</output>}
      </div>
      <input type="range" min={min} max={100} value={value} aria-label={control.label} style={{ '--from': percent(from), '--to': percent(to) } as CSSProperties}
        onPointerDown={history.beginGesture} onPointerUp={history.endGesture} onLostPointerCapture={history.endGesture}
        onKeyDown={history.beginGesture} onKeyUp={history.endGesture} onBlur={history.endGesture}
        onChange={event => onChange(Number(event.target.value))} />
      <div className="slider-ends"><span>{control.low}</span><span>{control.high}</span></div>
    </div>
  );
}

function AdjustInspector({ graph, edge, step, history }: { graph: Graph; edge: StepEdge; step: AdjustStep; history: History }) {
  const setValue = (key: AdjustKey, value: number) => (g: Graph) => updateStep(g, edge.id, s => s.kind === 'adjust' ? { ...s, values: { ...s.values, [key]: value } } : s);
  const slider = (control: AdjustControl) => (
    <Slider key={control.key} control={control} min={-100} value={step.values[control.key] ?? 0} history={history}
      onChange={value => history.set(setValue(control.key, value))} />
  );
  return (
    <div className="inspector-body">
      <StepHeader graph={graph} edge={edge} history={history} kind="Adjust step" />
      <p className="hint">Changes apply right away in the browser. They cost nothing and use no AI.</p>
      <section className="group"><h3>Light</h3>{lightControls.map(slider)}</section>
      <section className="group"><h3>Color</h3>{colorControls.map(slider)}</section>
      <button className="secondary-button" disabled={isIdentity(step.values)}
        onClick={() => history.commit(g => updateStep(g, edge.id, s => s.kind === 'adjust' ? { ...s, values: defaultAdjust() } : s))}>Reset all</button>
    </div>
  );
}

function NodeInspector({ graph, node, history }: { graph: Graph; node: ImageNode; history: History }) {
  const { nodes, assets, incoming, actions } = useCanvas();
  const assetId = nodes.get(node.id)?.assetId, asset = assetId ? assets.get(assetId) : undefined;
  const input = incoming.get(node.id), source = input && graph.nodes.find(n => n.id === input.source);
  return (
    <div className="inspector-body">
      <div className="inspector-eyebrow">{kindLabels[node.data.kind]}</div>
      <TextField label="Name" value={node.data.name} history={history} onChange={value => history.set(g => updateNode(g, node.id, d => ({ ...d, name: value })))} />
      <dl className="facts">
        <dt>Dimensions</dt><dd>{asset ? `${asset.width} × ${asset.height} px` : 'No image'}</dd>
        <dt>File</dt><dd>{asset?.filename ?? 'None'}</dd>
        {node.data.kind !== 'original' && <><dt>Input</dt><dd>{input && source
          ? <button className="link" onClick={() => actions.selectEdge(input.id)}>{source.data.name} via {stepLabel(input.data)}</button>
          : 'Not connected'}</dd></>}
      </dl>
      <div className="button-stack">
        <button className="secondary-button" onClick={() => actions.createStep(node.id, 'prompt')}><Icon name="prompt" />Edit with prompt</button>
        <button className="secondary-button" onClick={() => actions.createStep(node.id, 'style')}><Icon name="style" />Create variation</button>
        <button className="secondary-button" onClick={() => actions.createStep(node.id, 'adjust')}><Icon name="sliders" />Adjust</button>
        {input && <button className="secondary-button" onClick={() => actions.duplicateStep(node.id)}>Duplicate step</button>}
        <button className="danger-button" onClick={() => actions.deleteNode(node.id)}>Delete</button>
      </div>
    </div>
  );
}

function MultiInspector({ count, onDelete }: { count: number; onDelete: () => void }) {
  return (
    <div className="inspector-body">
      <div className="inspector-eyebrow">Selection</div>
      <h2>{count} items selected</h2>
      <p className="hint">Drag any selected image to move them together.</p>
      <button className="danger-button" onClick={onDelete}>Delete selected</button>
    </div>
  );
}

function CanvasHelp() {
  return (
    <div className="inspector-body">
      <div className="inspector-eyebrow">Canvas</div>
      <h2>Nothing selected</h2>
      <ul className="help">
        <li>Click an image or a step badge to see its settings.</li>
        <li><strong>Edit with prompt</strong> makes a new base image from a written edit.</li>
        <li><strong>Create variation</strong> applies an art style. Branch as often as you like.</li>
        <li><strong>Adjust</strong> changes light and color right away, without AI.</li>
        <li>Drag from a card's right handle to connect it, or drop on empty canvas to add a step.</li>
        <li>Drag the background or hold Space to pan. Scroll to zoom. Shift-drag to select several.</li>
        <li>⌘Z undoes, ⇧⌘Z redoes, Delete removes the selection.</li>
      </ul>
    </div>
  );
}

// Run and Run again, the step's state, and its earlier runs to pick from.
function RunPanel({ graph, edge, disabledReason, shortcut }: { graph: Graph; edge: StepEdge; disabledReason?: string; shortcut?: boolean }) {
  const { nodes, runs, assets, actions, live } = useCanvas();
  const status = nodes.get(edge.target);
  if (!status) return null;
  const list = runs[edge.id] ?? [];
  const blocker = status.blockedBy ? graph.nodes.find(n => n.id === status.blockedBy)?.data.name ?? 'the step before' : undefined;
  const hint = disabledReason
    ?? (status.pending ? 'Making a draft. This can take up to a minute.'
    : blocker ? `Run ${blocker} first.`
    : status.stale ? 'The input or settings changed since this draft. Run to update it.'
    : status.ready ? 'Up to date. Run again to try another draft.'
    : status.error ? `The last run failed: ${status.error}`
    : 'Not run yet.');
  return (
    <>
      <button className="primary-button" disabled={!status.canRun || !!disabledReason} onClick={() => actions.runStep(edge.id)}>
        {status.pending && <span className="spinner" />}{status.pending ? 'Generating…' : status.ready ? 'Run again' : 'Run'}
      </button>
      <p className="hint">{hint}{shortcut && !disabledReason && !status.pending ? ' Press ⌘ Enter to run.' : ''}</p>
      {list.length > 0 && (
        <section className="group">
          <h3>Runs</h3>
          <div className="run-strip">
            {list.map(run => {
              const asset = run.assetId ? assets.get(run.assetId) : undefined;
              const picked = run.id === edge.data.pickedRunId;
              const when = new Date(run.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return (
                <button key={run.id} className={`run-tile ${run.status}${picked ? ' picked' : ''}`} disabled={run.status !== 'done' || picked}
                  aria-pressed={picked} title={run.status === 'failed' ? `Failed: ${run.error}` : `${picked ? 'Picked' : 'Pick this run'} · ${when}`}
                  onClick={() => actions.pickRun(edge.id, run.id)}>
                  {run.status === 'pending' ? <span className="spinner" /> : asset ? <img src={asset.url} alt={`Run at ${when}`} /> : <span>!</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}
      {live
        ? <p className="hint">Each run is one paid {openAI.model} call that makes a low-quality draft of about 1024px.</p>
        : <PreviewNote>Preview mode. No OpenAI key is set, so a run copies its input image. Add OPENAI_API_KEY to .env.local and restart the dev server.</PreviewNote>}
    </>
  );
}

function PreviewNote({ children }: { children: ReactNode }) {
  return <p className="preview-note"><span className="dot" />{children}</p>;
}
