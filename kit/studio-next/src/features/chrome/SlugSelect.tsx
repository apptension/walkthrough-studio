import { useMemo, useState } from 'react';

import { switchSequence } from '@/desk/boot';
import { useDesk } from '@/desk/store';

import { slugGroups, type SlugOption } from '@/logic/slugOptions';

/**
 * The row inside the customizable picker. Text content stays exactly `optionLabel()` so the
 * native fallback and typeahead read the same; the spans only let CSS draw the branch connector
 * and the setup badge.
 */
function OptionRow({ option }: { option: SlugOption }) {
  if (option.branch) {
    const title = option.label.replace(/^\s*↳\s*/, '');
    return (
      <>
        <span className="sel-tree" aria-hidden="true">
          {option.label.slice(0, option.label.length - title.length)}
        </span>
        <span className="sel-label">{title}</span>
      </>
    );
  }
  if (option.setup) {
    const name = option.label.replace(/\s*\(needs setup\)$/, '');
    return (
      <>
        <span className="sel-label">{name}</span>
        <span className="sel-note" data-note="Setup">
          {option.label.slice(name.length)}
        </span>
      </>
    );
  }
  return <span className="sel-label">{option.label}</span>;
}

/** `#slugSelect` — the sequence picker (`fillSlugSelect` + the `sel.onchange` from `boot()`). */
export function SlugSelect() {
  const index = useDesk((s) => s.index);
  const slug = useDesk((s) => s.slug);
  // The picked value holds while the switch runs; a refused switch falls back to the open sequence.
  const [pending, setPending] = useState<string | null>(null);
  const groups = useMemo(() => (index ? slugGroups(index) : null), [index]);

  const onChange = (next: string) => {
    setPending(next);
    void switchSequence(next).finally(() => setPending(null));
  };

  return (
    <select id="slugSelect" aria-label="Select sequence" value={pending ?? slug ?? ''} onChange={(e) => onChange(e.currentTarget.value)}>
      {groups == null ? null : groups.length ? (
        groups.map((g, i) => (
          <optgroup key={`${i}-${g.label}`} label={g.label}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value} className={o.branch ? 'is-branch' : o.setup ? 'is-setup' : undefined}>
                <OptionRow option={o} />
              </option>
            ))}
          </optgroup>
        ))
      ) : (
        <option value="">No videos</option>
      )}
    </select>
  );
}
