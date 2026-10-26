import type { ChangeEvent, ReactNode, Ref } from 'react';

import { cn } from '@/lib/cn';
import { HelpTip } from '@/ui/HelpTip';
import { Scrubber } from '@/ui/Scrubber';

/** Inspector form rows: the `.ins-seg` segmented control, `.var-row` sliders, `.ins-switch`. */

export interface SegChoice {
  value: string;
  label: ReactNode;
  title?: string;
}

/** `segBtns()` as a radio group. `data` lands on the group (the click delegate's `[data-camera]`). */
export function SegButtons({
  label,
  choices,
  current,
  onSelect,
  id,
  data,
  className,
}: {
  label: string;
  choices: readonly SegChoice[];
  current: string | undefined;
  onSelect?: (value: string) => void;
  id?: string;
  data?: Record<`data-${string}`, string | undefined>;
  className?: string;
}) {
  return (
    <div className={cn('ins-seg', className)} role="radiogroup" aria-label={label} id={id} {...data}>
      {choices.map((c) => {
        const on = c.value === current;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={on ? 'on' : undefined}
            data-value={c.value}
            title={c.title}
            onClick={onSelect ? () => onSelect(c.value) : undefined}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

/** A labelled slider with its live value: `label · track · value`. */
export function RangeRow({
  id,
  label,
  aria,
  min,
  max,
  step,
  value,
  out,
  onChange,
  inputRef,
  className,
}: {
  id: string;
  label: string;
  aria: string;
  min: string;
  max: string;
  step: string;
  value: string;
  out: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}) {
  return (
    <div className={cn('var-row pane-range', className)}>
      <label htmlFor={id}>{label}</label>
      <Scrubber ref={inputRef} id={id} min={min} max={max} step={step} value={value} aria-label={aria} onChange={onChange} />
      <output id={`${id}Out`} htmlFor={id}>
        {out}
      </output>
    </div>
  );
}

/** An `.ins-switch` with its label, a one-line hint and the full story behind the help tip. */
export function SwitchRow({
  id,
  label,
  hint,
  help,
  aria,
  checked,
  onToggle,
  className,
  hidden,
}: {
  id: string;
  label: string;
  hint?: string;
  help?: string;
  aria: string;
  checked: boolean;
  onToggle: (on: boolean) => void;
  className?: string;
  hidden?: boolean | undefined;
}) {
  return (
    <label className={cn('pane-switch', className)} hidden={hidden}>
      <span className="pane-switch-copy">
        <b>
          {label}
          {help ? <HelpTip text={help} label={label} /> : null}
        </b>
        {hint ? <em>{hint}</em> : null}
      </span>
      <span className="ins-switch">
        <input type="checkbox" id={id} role="switch" aria-label={aria} checked={checked} onChange={(e) => onToggle(e.target.checked)} />
        <i />
      </span>
    </label>
  );
}

/** `.ins-row` with a select: label on the left, the menu filling the rest. */
export function SelectRow({
  id,
  label,
  aria,
  value,
  onChange,
  help,
  children,
}: {
  id: string;
  label: string;
  aria: string;
  value: string;
  onChange: (value: string) => void;
  help?: string;
  children: ReactNode;
}) {
  return (
    <label className="ins-row pane-select">
      <span>
        {label}
        {help ? <HelpTip text={help} label={label} /> : null}
      </span>
      <select id={id} className="ins-select" aria-label={aria} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}
