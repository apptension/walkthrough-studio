// Every <select> gets a trigger with <selectedcontent> (label truncates before the chevron)
// and a quick-search field in the picker. Only where customizable selects exist; elsewhere the
// native select keeps the CSS fallback. Selects rendered later (Inspector, API-filled lists)
// are picked up by the observer.

const supported = typeof CSS !== 'undefined' && Boolean(CSS.supports?.('appearance', 'base-select'));

function optionLabel(opt: HTMLOptionElement): string {
  return `${opt.label || opt.textContent || ''} ${opt.value || ''}`.trim().toLowerCase();
}

function applyFilter(select: HTMLSelectElement, query: string | null | undefined): void {
  const q = (query || '').trim().toLowerCase();
  for (const opt of select.querySelectorAll('option')) {
    opt.classList.toggle('is-filtered', Boolean(q) && !optionLabel(opt).includes(q));
  }
  const empty = select.querySelector<HTMLElement>('.sel-empty');
  if (!empty) return;
  const any = [...select.querySelectorAll('option')].some((opt) => !opt.classList.contains('is-filtered') && !opt.disabled && opt.value !== '');
  empty.hidden = !q || any;
}

function ensureSearch(select: HTMLSelectElement): HTMLInputElement | null {
  if (select.dataset.noSearch != null || select.multiple) return null;
  const existing = select.querySelector<HTMLInputElement>(':scope > .sel-search');
  if (existing) return existing;
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'sel-search';
  input.placeholder = 'Search…';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('aria-label', 'Search options');
  input.tabIndex = -1;

  let empty = select.querySelector<HTMLElement>(':scope > .sel-empty');
  if (!empty) {
    empty = document.createElement('div');
    empty.className = 'sel-empty';
    empty.hidden = true;
    empty.textContent = 'No matches';
    empty.setAttribute('aria-hidden', 'true');
  }

  const trigger = select.querySelector(':scope > .sel-trigger');
  if (trigger) trigger.after(input, empty);
  else select.prepend(input, empty);

  const filter = (): void => applyFilter(select, input.value);
  input.addEventListener('input', filter);
  input.addEventListener('search', filter);
  // Keep typing in the field — don't let the select's typeahead steal keys.
  input.addEventListener('keydown', (e) => e.stopPropagation());
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  input.addEventListener('click', (e) => e.stopPropagation());

  return input;
}

function clearSearch(select: HTMLSelectElement): void {
  const input = select.querySelector<HTMLInputElement>(':scope > .sel-search');
  if (!input || !input.value) {
    applyFilter(select, '');
    return;
  }
  input.value = '';
  applyFilter(select, '');
}

function openSearch(select: HTMLSelectElement): void {
  const input = ensureSearch(select);
  if (!input) return;
  clearSearch(select);
  requestAnimationFrame(() => {
    if (!select.matches(':open')) return;
    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }
  });
}

function wireOpen(select: HTMLSelectElement): void {
  if (select.dataset.selWired) return;
  select.dataset.selWired = '1';
  select.addEventListener('click', () => {
    // Click opens the picker; focus search on the next frame once :open is true.
    requestAnimationFrame(() => {
      if (select.matches(':open')) openSearch(select);
      else clearSearch(select);
    });
  });
  select.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') clearSearch(select);
    if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !select.matches(':open')) {
      requestAnimationFrame(() => {
        if (select.matches(':open')) openSearch(select);
      });
    }
  });
  // Picker dismissed without a click on the select itself.
  select.addEventListener('focusout', () => {
    requestAnimationFrame(() => {
      if (!select.matches(':open') && !select.contains(document.activeElement)) clearSearch(select);
    });
  });
}

function enhance(select: Element): void {
  if (!(select instanceof HTMLSelectElement)) return;
  const first = select.firstElementChild;
  if (!(first?.tagName === 'BUTTON' && first.classList.contains('sel-trigger'))) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sel-trigger';
    button.setAttribute('tabindex', '-1');
    button.innerHTML = '<selectedcontent></selectedcontent><span class="sel-chevron" aria-hidden="true"></span>';
    select.prepend(button);
  }
  ensureSearch(select);
  wireOpen(select);
}

function scan(root: Element): void {
  if (root.tagName === 'SELECT') enhance(root);
  root.querySelectorAll('select').forEach(enhance);
}

/**
 * The browser re-clones `<selectedcontent>` only when the selection changes, so relabelling
 * the selected option in place (React keeps the node) would leave the trigger stale.
 */
export function syncSelectedContent(node: Node): void {
  const option = (node instanceof Element ? node : node.parentElement)?.closest('option');
  const select = option?.closest('select');
  if (!option || !select || select.selectedOptions[0] !== option) return;
  const shown = select.querySelector(':scope > .sel-trigger selectedcontent');
  if (shown && shown.textContent !== option.textContent) shown.textContent = option.textContent;
}

export function initSelects(): void {
  if (!supported) return;
  document.documentElement.classList.add('has-custom-select');
  scan(document.body);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData' || (r.target instanceof Element && r.target.tagName === 'OPTION')) {
        syncSelectedContent(r.target);
        continue;
      }
      if (r.target instanceof Element && r.target.tagName === 'SELECT') enhance(r.target);
      for (const node of r.addedNodes) if (node.nodeType === 1) scan(node as Element);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}
