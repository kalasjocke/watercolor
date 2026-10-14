import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { useCanvas } from '../canvas-context';
import { stepLabel, type StepEdge } from '../lib/graph';
import { Icon } from './Icons';

export function StepEdgeView({ id, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd }: EdgeProps<StepEdge>) {
  const { actions, nodes } = useCanvas();
  const status = nodes.get(target);
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  if (!data) return null;
  const empty = data.kind === 'prompt' && !data.prompt.trim();
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={24} style={{ stroke: selected ? 'var(--accent)' : 'var(--edge)', strokeWidth: selected ? 2.5 : 1.75 }} />
      <EdgeLabelRenderer>
        <button className={`edge-badge nodrag nopan ${data.kind}${selected ? ' selected' : ''}${empty ? ' empty' : ''}${status?.stale ? ' stale' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          title={data.kind === 'prompt' ? data.prompt || 'Write a prompt in the inspector' : 'Open style settings'}
          onClick={event => { event.stopPropagation(); actions.selectEdge(id); }}>
          {status?.pending ? <span className="spinner" /> : <Icon name={data.kind === 'prompt' ? 'prompt' : 'style'} size={13} />}
          <span>{stepLabel(data)}</span>
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
