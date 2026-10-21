/**
 * Count-up numbers for stats / metric plates. The same parse + format functions run in Node
 * (tests, builders) and inside the plate (inlined through `countUpRuntimeSource()`), driven by the
 * plate clock so every frame is deterministic.
 *
 * A value keeps its own typography: "4.8★" counts 0.0 → 4.8, "+30%" counts +0% → +30%,
 * "12,000" keeps its grouping, "€1.2M" keeps prefix and suffix. Text without digits never counts.
 */

/** Split "€1,200.5M" into { prefix:'€', number:1200.5, decimals:1, group:',', suffix:'M' }. */
export function parseCountTarget(text) {
  const s = String(text ?? '');
  const m = s.match(/^([^\d]*?)(\d[\d,\u202f\u00a0 ]*(?:[.,]\d+)?)(.*)$/s);
  if (!m) return null;
  const prefix = m[1];
  // Trailing spaces belong to the suffix ("98 %"), not to digit grouping.
  const trail = m[2].match(/[\u202f\u00a0 ]+$/);
  const raw = trail ? m[2].slice(0, -trail[0].length) : m[2];
  const suffix = (trail ? trail[0] : '') + m[3];
  let group = '';
  let decimals = 0;
  let body = raw;
  // Decimal separator: the last '.' or ',' followed by 1–2 digits at the end (12,000 is grouping).
  const dec = body.match(/([.,])(\d{1,2})$/);
  if (dec && !(dec[1] === ',' && /^\d{1,3}(,\d{3})+$/.test(body))) {
    decimals = dec[2].length;
    body = body.slice(0, -dec[0].length);
  }
  const g = body.match(/[,\u202f\u00a0 ]/);
  if (g) group = g[0];
  const intPart = body.replace(/[,\u202f\u00a0 ]/g, '');
  if (!/^\d+$/.test(intPart)) return null;
  const number = Number(`${intPart}${dec && decimals ? `.${dec[2]}` : ''}`);
  if (!Number.isFinite(number)) return null;
  const decimalMark = decimals ? dec[1] : '';
  return { prefix, suffix, number, decimals, group, decimalMark, original: s };
}

/** Format `value` the way the target was written (grouping, decimals, prefix, suffix). */
export function formatCount(target, value) {
  const fixed = Math.max(0, value).toFixed(target.decimals);
  let [int, frac] = fixed.split('.');
  if (target.group) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, target.group);
  const dec = target.decimals ? `${target.decimalMark || '.'}${frac}` : '';
  return `${target.prefix}${int}${dec}${target.suffix}`;
}

/** Eased progress 0..1 for a count that starts at `startSec` and runs `durSec`. */
export function countProgress(sec, startSec, durSec) {
  const x = Math.max(0, Math.min(1, (sec - startSec) / Math.max(0.05, durSec)));
  return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
}

/**
 * Plain-script runtime: every `[data-count]` element counts from 0 to its own text between
 * `data-count-start` and `data-count-start + data-count-dur` seconds of plate time. On a replay
 * (clock jumps back) an edited value is re-read, so Studio inline edits survive.
 */
export function countUpRuntimeSource() {
  return `(function () {
  ${parseCountTarget.toString()}
  ${formatCount.toString()}
  ${countProgress.toString()}
  const els = Array.from(document.querySelectorAll('[data-count]'));
  if (!els.length) return;
  for (const el of els) el.dataset.countFinal = el.textContent;
  const items = els.map((el) => ({ el, target: parseCountTarget(el.textContent), last: Infinity, settled: false }));
  function tick(ms) {
    // Studio edit mode: the field is a contenteditable showing its final value; leave it alone.
    if (document.body.classList.contains('studio-edit')) return;
    const sec = ms / 1000;
    for (const it of items) {
      if (sec * 1000 < it.last - 50 && it.settled && it.el.textContent !== it.target?.original) {
        it.target = parseCountTarget(it.el.textContent);
      }
      it.last = sec * 1000;
      if (!it.target) continue;
      const start = parseFloat(it.el.dataset.countStart || '0.8');
      const dur = parseFloat(it.el.dataset.countDur || '1.3');
      const p = countProgress(sec, start, dur);
      const next = p >= 1 ? it.target.original : formatCount(it.target, it.target.number * p);
      it.settled = p >= 1;
      if (it.el.textContent !== next) it.el.textContent = next;
    }
  }
  const attach = () => {
    if (window.__plateRuntime && typeof window.__plateRuntime.hook === 'function') window.__plateRuntime.hook(tick);
    else requestAnimationFrame(attach);
  };
  attach();
})();`;
}
