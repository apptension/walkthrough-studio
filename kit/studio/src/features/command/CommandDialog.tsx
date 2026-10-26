import { Fragment, useEffect, useRef, type KeyboardEvent } from 'react';

import { openDialog } from '@/desk/store';
import { Icon } from '@/ui/icons';
import { useSheetDialog } from '@/features/stages/sheetDialog';

import {
  COMMANDS,
  moveCommandActive,
  resetCommandMenu,
  runCommand,
  setCommandQuery,
  useCommandMenu,
  visibleCommands,
  type CommandItem,
} from './command';

function CommandButton({ item, hidden, active }: { item: CommandItem; hidden: boolean; active: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      data-command={item.id}
      hidden={hidden}
      className={active ? 'is-active' : undefined}
      onClick={() => runCommand(item.id)}
      onPointerMove={() => {
        if (!active) useCommandMenu.setState({ active: item.id });
      }}
    >
      <i>{item.glyph}</i>
      <span>
        <strong>{item.label}</strong>
        <em>{item.hint}</em>
      </span>
      {item.kbd ? <kbd>{item.kbd}</kbd> : null}
    </button>
  );
}

/** `#commandDialog` — the ⌘K menu. */
export function CommandDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const query = useCommandMenu((s) => s.query);
  const active = useCommandMenu((s) => s.active);
  const seq = useCommandMenu((s) => s.seq);
  useSheetDialog('command', ref, {
    seq,
    onOpen: () => {
      resetCommandMenu();
      requestAnimationFrame(() => inputRef.current?.focus());
    },
  });

  const visible = new Set(visibleCommands(query).map((c) => c.id));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      openDialog('command', false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveCommandActive(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key !== 'Enter') return;
    const items = visibleCommands(query);
    const pick = items.find((c) => c.id === active) || items[0];
    if (pick) {
      e.preventDefault();
      runCommand(pick.id);
    }
  };

  return (
    <dialog ref={ref} id="commandDialog" className="command-dialog" aria-label="Command menu">
      <div className="command-search">
        <Icon name="ui-search" size={16} />{' '}
        <input
          ref={inputRef}
          id="commandInput"
          type="search"
          placeholder="Jump to a stage or run an action…"
          autoComplete="off"
          value={query}
          onChange={(e) => setCommandQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />{' '}
        <kbd>esc</kbd>
      </div>
      <div id="commandList" className="command-list" role="listbox">
        {COMMANDS.map((item, i) => (
          <Fragment key={item.id}>
            {i > 0 ? ' ' : null}
            <CommandButton item={item} hidden={!visible.has(item.id)} active={visible.has(item.id) && active === item.id} />
          </Fragment>
        ))}
      </div>
      <p id="commandEmpty" className="command-empty" hidden={visible.size > 0}>
        No matching command
      </p>
    </dialog>
  );
}
