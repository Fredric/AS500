/**
 * Ingest Monitor — GPU and resident-model panel.
 *
 * Shows real telemetry when nvidia-smi is reachable; otherwise falls back to what
 * Ollama and vLLM report about the models they currently hold, and says so.
 */

import { vram } from '../format';
import type { GpuSnapshot } from '../types';

export default function GpuPanel({ gpu }: { gpu: GpuSnapshot }) {
  const pct =
    gpu.memoryUsedMb != null && gpu.memoryTotalMb
      ? Math.min(100, Math.round((gpu.memoryUsedMb / gpu.memoryTotalMb) * 100))
      : null;

  return (
    <div className="mon-panel">
      <div className="mon-panel-head">
        <span className="mon-panel-title">Local GPU</span>
        <span className="mon-panel-sub">
          {gpu.name ?? (gpu.source === 'derived' ? 'inferred from model servers' : 'no telemetry')}
        </span>
      </div>
      <div className="mon-panel-body">
        <div className="mon-gpu-bar">
          <div className="mon-gpu-bar-fill" style={{ width: `${pct ?? 0}%` }} />
          <div className="mon-gpu-bar-text">
            {gpu.memoryUsedMb != null
              ? `VRAM ${vram(gpu.memoryUsedMb)}${gpu.memoryTotalMb ? ` / ${vram(gpu.memoryTotalMb)}` : ' in use'}`
              : 'VRAM unknown'}
          </div>
        </div>

        {gpu.source === 'nvidia-smi' && (
          <div className="mon-gpu-metrics">
            <div className="mon-gpu-metric">
              <div className="mon-gpu-metric-value">{gpu.utilizationPct ?? '—'}%</div>
              <div className="mon-gpu-metric-label">util</div>
            </div>
            <div className="mon-gpu-metric">
              <div className="mon-gpu-metric-value">{gpu.temperatureC ?? '—'}°</div>
              <div className="mon-gpu-metric-label">temp</div>
            </div>
            <div className="mon-gpu-metric">
              <div className="mon-gpu-metric-value">{gpu.powerWatts ?? '—'}</div>
              <div className="mon-gpu-metric-label">watts</div>
            </div>
            <div className="mon-gpu-metric">
              <div className="mon-gpu-metric-value">{pct ?? '—'}%</div>
              <div className="mon-gpu-metric-label">vram</div>
            </div>
          </div>
        )}

        <span className="mon-stat-label">Models resident</span>
        {gpu.consumers.length === 0 ? (
          <div className="mon-empty" style={{ padding: '12px 0' }}>
            No model is loaded — the first ingest will pay a cold-start cost.
          </div>
        ) : (
          gpu.consumers.map((c) => (
            <div className="mon-consumer" key={c.label}>
              <span className="mon-consumer-label" title={c.label}>
                {c.label}
              </span>
              <span>
                <span className="mon-consumer-detail">{c.detail}</span>
                {c.vramMb != null && (
                  <strong style={{ marginLeft: 10, color: 'var(--mon-cyan)' }}>{vram(c.vramMb)}</strong>
                )}
              </span>
            </div>
          ))
        )}

        {gpu.note && <div className="mon-note">{gpu.note}</div>}
      </div>
    </div>
  );
}
