import { useEffect, useState } from 'react';

import { getPerfSnapshot, installPerfMonitor, subscribeDeskPerf, type PerfSnapshot } from './perfMonitor';

const EMPTY: PerfSnapshot = {
  deskPerSec: 0,
  deskTopKeys: [],
  longTasks: 0,
  longTaskMaxMs: 0,
  neonGlowMoves: 0,
  neonButtons: 0,
  markCanvases: 0,
  fps: 0,
};

/** Dev-only overlay: desk write rate, long tasks, neon glow work, animated marks. */
export function PerfHud() {
  const [snap, setSnap] = useState<PerfSnapshot>(EMPTY);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    const off = installPerfMonitor();
    const tick = () => setSnap(getPerfSnapshot());
    const id = setInterval(tick, 500);
    const unsub = subscribeDeskPerf((keys) => {
      if (keys.length) setFlash(keys.join(', '));
    });
    const flashTimer = setInterval(() => setFlash(''), 800);
    return () => {
      off();
      clearInterval(id);
      clearInterval(flashTimer);
      unsub();
    };
  }, []);

  const hot =
    snap.deskPerSec > 30 || snap.longTaskMaxMs > 80 || snap.neonGlowMoves > 45 || (snap.fps > 0 && snap.fps < 45);

  return (
    <div
      className="studio-perf-hud"
      aria-hidden="true"
      style={{
        position: 'fixed',
        right: 8,
        bottom: 8,
        zIndex: 99999,
        font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
        color: hot ? '#ffb4b4' : '#c8f7d0',
        background: 'rgb(8 12 10 / 0.88)',
        border: `1px solid ${hot ? 'rgb(255 80 80 / 0.5)' : 'rgb(66 242 114 / 0.35)'}`,
        borderRadius: 8,
        padding: '8px 10px',
        maxWidth: 280,
        pointerEvents: 'none',
        boxShadow: '0 8px 24px rgb(0 0 0 / 0.35)',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Studio perf</div>
      <div>desk.set ~{snap.deskPerSec}/s {flash ? `· ${flash}` : ''}</div>
      {snap.deskTopKeys.length ? (
        <div style={{ opacity: 0.85 }}>
          {snap.deskTopKeys.map((k) => `${k.key}:${k.count}`).join(' ')}
        </div>
      ) : null}
      <div>
        fps {snap.fps} · long {snap.longTasks} (max {snap.longTaskMaxMs}ms)
      </div>
      <div>
        neon fills {snap.neonButtons} · glow {snap.neonGlowMoves}/s · marks {snap.markCanvases}
      </div>
    </div>
  );
}
