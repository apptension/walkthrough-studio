import { create } from 'zustand';

/**
 * A small question in Studio's own dialog chrome — replaces window.prompt / window.confirm.
 *   await ask({ title, detail, ok })                      → true | false
 *   await ask({ kind: 'prompt', title, label, value, ok }) → string | null
 *   await ask({ kind: 'choice', title, options, value })   → string | null  (option value)
 *
 * Ported from `kit/studio/ask.js`; `AskDialog` renders the request.
 */

export interface AskOption {
  value: string;
  label?: string;
  hint?: string;
  still?: string;
}

export interface AskRequest {
  kind?: 'confirm' | 'prompt' | 'choice';
  title?: string;
  detail?: string;
  label?: string;
  value?: string;
  placeholder?: string;
  options?: Array<string | AskOption>;
  ok?: string;
  cancel?: string;
  tone?: 'accent' | 'warn';
  secret?: boolean;
  job?: boolean;
  toast?: boolean;
}

export interface PendingAsk extends Required<Omit<AskRequest, 'options'>> {
  id: number;
  options: AskOption[];
  resolve: (value: boolean | string | null) => void;
}

interface AskState {
  pending: PendingAsk | null;
}

export const useAsk = create<AskState>()(() => ({ pending: null }));

/** A job question stays up. A toast or a later confirm must not dismiss it. */
export function planAsk({
  pending: current,
  incoming,
}: {
  pending?: { job?: boolean } | null;
  incoming?: { job?: boolean; toast?: boolean };
} = {}): { dismiss: boolean; show: boolean } {
  if (current?.job && (incoming?.toast || !incoming?.job)) return { dismiss: false, show: false };
  return { dismiss: Boolean(current), show: true };
}

let nextId = 1;

function cancelValue(kind: AskRequest['kind']): false | null {
  return kind === 'confirm' ? false : null;
}

export function ask(req: AskRequest & { kind: 'prompt' | 'choice' }): Promise<string | null>;
export function ask(req: AskRequest & { kind?: 'confirm' }): Promise<boolean>;
export function ask(req: AskRequest): Promise<boolean | string | null>;
export function ask(req: AskRequest): Promise<boolean | string | null> {
  const kind = req.kind ?? 'confirm';
  const current = useAsk.getState().pending;
  const plan = planAsk({ pending: current, incoming: { job: req.job ?? false, toast: req.toast ?? false } });
  if (!plan.show) return Promise.resolve(cancelValue(kind));
  if (plan.dismiss && current) current.resolve(cancelValue(current.kind));

  const options = (req.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return new Promise((resolve) => {
    const id = nextId++;
    useAsk.setState({
      pending: {
        id,
        kind,
        title: req.title ?? '',
        detail: req.detail ?? '',
        label: req.label ?? '',
        value: req.value ?? '',
        placeholder: req.placeholder ?? '',
        options,
        ok: req.ok ?? 'Continue',
        cancel: req.cancel ?? 'Cancel',
        tone: req.tone ?? 'accent',
        secret: req.secret ?? false,
        job: req.job ?? false,
        toast: req.toast ?? false,
        resolve: (value) => {
          if (useAsk.getState().pending?.id === id) useAsk.setState({ pending: null });
          resolve(value);
        },
      },
    });
  });
}
