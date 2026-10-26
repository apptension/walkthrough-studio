import { useEffect, useRef, useState } from 'react';

const ROLL_MS = 3800;

interface BarrelProps {
  id: string;
  lines: string[];
  /** Rolls through `lines` on a timer while live; otherwise holds the first. */
  live: boolean;
}

/**
 * One line of text on a drum: a new line rolls up from below while the old one tips away over
 * the top. While `live`, it cycles through `lines`; a new first line always rolls in at once.
 */
export function Barrel({ id, lines, live }: BarrelProps) {
  const [index, setIndex] = useState(0);
  const lead = lines[0] ?? '';
  const count = lines.length;

  useEffect(() => setIndex(0), [lead]);
  useEffect(() => {
    if (!live || count < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), ROLL_MS);
    return () => clearInterval(timer);
  }, [live, count, lead]);

  const text = lines[index % Math.max(count, 1)] ?? '';
  const seq = useRef(0);
  const [faces, setFaces] = useState<{ key: number; text: string; out: boolean }[]>(() =>
    text ? [{ key: 0, text, out: false }] : [],
  );
  useEffect(() => {
    setFaces((prev) => {
      const current = prev.find((f) => !f.out);
      if ((current?.text ?? '') === text) return prev;
      seq.current += 1;
      const outgoing = current ? [{ ...current, out: true }] : [];
      return text ? [...outgoing, { key: seq.current, text, out: false }] : outgoing;
    });
  }, [text]);

  const drop = (key: number) => setFaces((prev) => prev.filter((f) => !(f.out && f.key === key)));

  return (
    <span id={id} className="barrel" hidden={!faces.length} aria-live="off" title={text || undefined}>
      {faces.map((f) => (
        <span
          key={f.key}
          className={f.out ? 'barrel-face is-out' : 'barrel-face is-in'}
          aria-hidden={f.out ? 'true' : undefined}
          onAnimationEnd={f.out ? () => drop(f.key) : undefined}
        >
          {f.text}
        </span>
      ))}
    </span>
  );
}
