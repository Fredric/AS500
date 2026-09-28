/**
 * Ingest Monitor — My Things / as500-images pipeline strip.
 *
 * Parallel to PipelineFlow (documents). Health of each hop comes from the
 * component that performs it, so a dead GPU worker visibly breaks the chain.
 */

import type { Health, MonitorSnapshot } from '../types';
import { duration } from '../format';

interface FlowNode {
  key: string;
  name: string;
  kind: string;
  componentId: string | null;
  value: string;
  detail: string;
  working: boolean;
}

function healthOf(snapshot: MonitorSnapshot, id: string | null): Health {
  if (!id) return 'up';
  return snapshot.components.find((c) => c.id === id)?.health ?? 'unknown';
}

export default function ThingsFlow({ snapshot }: { snapshot: MonitorSnapshot }) {
  const q = snapshot.thingsQueue;
  if (!q) return null;
  const processing = q.counts.processing > 0;
  const queued = q.counts.queued > 0;

  const nodes: FlowNode[] = [
    {
      key: 'upload',
      name: 'My Things',
      kind: 'photo upload',
      componentId: 'as500-server',
      value: String(q.totals.things),
      detail: 'things stored · POST /api/things/upload',
      working: false,
    },
    {
      key: 'queue',
      name: 'Thing jobs',
      kind: 'postgres',
      componentId: 'postgres',
      value: String(q.counts.queued),
      detail: 'queued · claimed with SKIP LOCKED',
      working: queued && !processing,
    },
    {
      key: 'worker',
      name: 'as500-images',
      kind: 'Qwen Image 2.1',
      componentId: 'as500-images',
      value: processing
        ? String(q.counts.processing)
        : duration(q.throughput.lastGenerateSec ?? q.throughput.avgDurationSec),
      detail: processing
        ? 'generating now'
        : q.throughput.lastGenerateSec != null
          ? `last generate ${duration(q.throughput.lastGenerateSec)} · avg 24h ${duration(q.throughput.avgGenerateSec)}`
          : 'GPU worker · polls the lease API',
      working: processing,
    },
    {
      key: 'sprite',
      name: 'Sprite',
      kind: 'processed PNG',
      componentId: 'as500-server',
      value: String(q.totals.processed),
      detail: 'isometric sprites ready in the office',
      working: false,
    },
  ];

  return (
    <div className="mon-panel">
      <div className="mon-panel-head">
        <span className="mon-panel-title">My Things pipeline</span>
        <span className="mon-panel-sub">
          {processing
            ? `${q.counts.processing} thing(s) generating`
            : queued
              ? `${q.counts.queued} queued, worker idle`
              : q.available
                ? `idle · last generate ${duration(q.throughput.lastGenerateSec)}`
                : 'unavailable'}
        </span>
      </div>
      <div className="mon-panel-body">
        <div className="mon-flow">
          {nodes.map((node, i) => {
            const health = healthOf(snapshot, node.componentId);
            const nextHealth = i < nodes.length - 1 ? healthOf(snapshot, nodes[i + 1].componentId) : 'up';
            const linkBlocked = health === 'down' || nextHealth === 'down';
            const linkActive = !linkBlocked && processing && (node.working || nodes[i + 1]?.working);

            return (
              <div key={node.key} style={{ display: 'flex', flex: '1 1 0', minWidth: 0 }}>
                <div
                  className={`mon-flow-node ${health}${node.working ? ' working' : ''}`}
                  title={`${node.name} — ${health}`}
                >
                  <div className="mon-flow-node-top">
                    <span className={`mon-led ${health}`} />
                    <span className="mon-flow-node-name">{node.name}</span>
                  </div>
                  <span className="mon-flow-node-kind">{node.kind}</span>
                  <span className="mon-flow-node-value">{node.value}</span>
                  <span className="mon-flow-node-detail">{node.detail}</span>
                </div>
                {i < nodes.length - 1 && (
                  <span
                    className={`mon-flow-link${linkActive ? ' active' : ''}${linkBlocked ? ' blocked' : ''}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
