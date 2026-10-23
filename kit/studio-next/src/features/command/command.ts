import { create } from 'zustand';

import { exportPack, requestMake } from '@/desk/jobs';
import { showLeftTab, showRightTab } from '@/desk/panels';
import { openDialog } from '@/desk/store';
import { openBranch } from '@/features/branch/branch';
import { openProjectNew } from '@/features/project-wizard/wizard';
import { onStageClick } from '@/features/stages/actions';

/** The command menu (`openCommandMenu`, `runCommand` and the `#commandInput` handlers in `kit/studio/app.js`). */

export interface CommandItem {
  id: string;
  glyph: string;
  label: string;
  hint: string;
  kbd?: string;
}

export const COMMANDS: readonly CommandItem[] = [
  { id: 'render', glyph: '▶', label: 'Render video', hint: 'Build the next required pipeline steps', kbd: 'R' },
  { id: 'direction', glyph: '◉', label: 'Open Direction', hint: 'Brand, camera, cursor and transitions' },
  { id: 'script', glyph: '≡', label: 'Open Script', hint: 'Review narration and screen actions' },
  { id: 'deliver', glyph: '↓', label: 'Open Deliver', hint: 'Poster, handoff and social formats' },
  { id: 'handoff', glyph: '⇩', label: 'Build handoff pack', hint: 'Master, poster, captions and manifest' },
  { id: 'version', glyph: '＋', label: 'Save version', hint: 'Named checkpoint for comparison' },
  { id: 'new', glyph: '✦', label: 'New video', hint: 'Start from a guided brief' },
  { id: 'branch', glyph: '⑂', label: 'Branch', hint: 'Spin feature videos from this overview' },
  { id: 'help', glyph: '?', label: 'Studio guide', hint: 'Workflow and keyboard shortcuts' },
];

/** The button's `textContent`, which is what the legacy filter matched against. */
export function commandText(item: CommandItem): string {
  return `${item.glyph}${item.label}${item.hint}${item.kbd ?? ''}`.toLowerCase();
}

export function visibleCommands(query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  return COMMANDS.filter((item) => !q || commandText(item).includes(q));
}

interface CommandState {
  query: string;
  active: string | null;
  /** Bumped by every `openCommandMenu()`, so an open menu resets again. */
  seq: number;
}

export const useCommandMenu = create<CommandState>()(() => ({ query: '', active: COMMANDS[0]?.id ?? null, seq: 0 }));

export function openCommandMenu(): void {
  useCommandMenu.setState((s) => ({ seq: s.seq + 1 }));
  openDialog('command', true);
}

/** Reset on every opening: empty query, every item back, the first one active. */
export function resetCommandMenu(): void {
  useCommandMenu.setState({ query: '', active: COMMANDS[0]?.id ?? null });
}

export function setCommandQuery(query: string): void {
  useCommandMenu.setState({ query, active: visibleCommands(query)[0]?.id ?? null });
}

export function moveCommandActive(delta: 1 | -1): void {
  const { query, active } = useCommandMenu.getState();
  const items = visibleCommands(query);
  if (!items.length) return;
  const i = items.findIndex((c) => c.id === active);
  const next = items[(i + delta + items.length) % items.length];
  if (next) useCommandMenu.setState({ active: next.id });
}

export function runCommand(command: string): void {
  openDialog('command', false);
  if (command === 'render') requestMake();
  else if (command === 'handoff') exportPack();
  else if (command === 'version') document.getElementById('btnSnapshot')?.click();
  else if (command === 'new') void openProjectNew();
  else if (command === 'branch') openBranch();
  else if (command === 'help') openDialog('help', true);
  else if (command === 'direction') showRightTab('motion');
  else if (command === 'deliver') showLeftTab('deliver');
  else if (command === 'script') onStageClick('script');
}
