/**
 * Ingest Monitor — end-to-end pipeline diagram.
 *
 * One node per hop a document takes from upload to searchable vector. Each node
 * borrows its health from the component that actually performs that hop, so a
 * dead vLLM visibly breaks the chain at the Docling step.
 */

import type { Health, MonitorSnapshot } from '../types';

interface FlowNode {
  key: string;
  name: string;
  kind: string;
  /** Component id whose health drives this node's colour. */
  componentId: string | null;
  value: string;
  detail: string;
  /** True when a job is currently sitting in this hop. */
  working: boolean;
}

function healthOf(snapshot: MonitorSnapshot, id: string | null): Health {
  if (!id) return 'up';
  return snapshot.components.find((c) => c.id === id)?.health ?? 'unknown';
}

export default function PipelineFlow({ snapshot }: { snapshot: MonitorSnapshot }) {
  const { queue } = snapshot;
  const active = queue.jobs.filter((j) => j.state === 'processing');
  const stages = new Set(active.map((j) => j.stage));
  const running = active.length > 0;

  const nodes: FlowNode[] = [
    {
      key: 'upload',
      name: 'My Documents',
      kind: 'AS500 upload',
      componentId: 'as500-server',
      value: String(queue.totals.documents),
      detail: 'documents stored · POST /api/documents/upload',
      working: false,
    },
    {
      key: 'enqueue',
      name: 'docs API',
      kind: 'POST /ingest',
      componentId: 'docs-api',
      value: String(queue.counts.queued + queue.counts.processing),
      detail: 'jobs accepted and not yet finished',
      working: false,
    },
    {
      key: 'queue',
      name: 'Job queue',
      kind: 'postgres',
      componentId: 'postgres',
      value: String(queue.counts.queued),
      detail: 'queued · claimed with SKIP LOCKED',
      working: queue.counts.queued > 0,
    },
    {
      key: 'worker',
      name: 'Worker',
      kind: 'claim loop',
      componentId: 'docs-worker',
      value: String(queue.counts.processing),
      detail: 'processing · polls every 2s',
      working: stages.has('claimed'),
    },
    {
      key: 'docling',
      name: 'DOCLING',
      kind: 'vLLM granite',
      componentId: 'vllm',
      value: String(queue.totals.pages),
      detail: 'pages converted from PDF/image',
      working: stages.has('convert'),
    },
    {
      key: 'chunk',
      name: 'Chunker',
      kind: 'hybrid split',
      componentId: 'docs-worker',
      value: String(queue.totals.chunks),
      detail: 'chunks with folder breadcrumb metadata',
      working: stages.has('chunk'),
    },
    {
      key: 'embed',
      name: 'Ollama',
      kind: 'nomic-embed',
      componentId: 'ollama',
      value: String(queue.totals.embeddedChunks),
      detail: '768-dim vectors generated',
      working: stages.has('embed') || stages.has('persist'),
    },
    {
      key: 'store',
      name: 'pgvector',
      kind: 'HNSW index',
      componentId: 'postgres',
      value: String(queue.totals.embeddedChunks),
      detail: 'document_chunks.embedding',
      working: stages.has('summarize'),
    },
    {
      key: 'search',
      name: 'knowledge_*',
      kind: 'MCP + agent',
      componentId: 'agent',
      value: String(queue.itemStatus.ready ?? 0),
      detail: 'documents ready for retrieval',
      working: false,
    },
  ];

  return (
    <div className="mon-panel">
      <div className="mon-panel-head">
        <span className="mon-panel-title">Ingestion pipeline</span>
        <span className="mon-panel-sub">
          {running
            ? `${active.length} document(s) in flight`
            : queue.counts.queued > 0
              ? `${queue.counts.queued} queued, nothing being processed`
              : 'idle'}
        </span>
      </div>
      <div className="mon-panel-body">
        <div className="mon-flow">
          {nodes.map((node, i) => {
            const health = healthOf(snapshot, node.componentId);
            const nextHealth = i < nodes.length - 1 ? healthOf(snapshot, nodes[i + 1].componentId) : 'up';
            const linkBlocked = health === 'down' || nextHealth === 'down';
            const linkActive = !linkBlocked && running && (node.working || nodes[i + 1]?.working);

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
