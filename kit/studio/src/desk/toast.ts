import { desk } from './store';

let nextId = 1;

/**
 * `toast(title, detail, kind)` — the legacy desk's corner notice. It holds for
 * 3.2 s, then slides out for 260 ms before it leaves the stack.
 */
export function toast(title: string, detail = '', kind: 'ok' | 'err' | 'warn' | 'info' = 'ok'): void {
  const id = nextId++;
  desk.set((s) => ({ toasts: [...s.toasts, { id, title, detail, kind, out: false }] }));
  setTimeout(() => {
    desk.set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, out: true } : t)) }));
    setTimeout(() => desk.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 260);
  }, 3200);
}
