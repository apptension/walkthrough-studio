/**
 * Form helpers for live capture. Prefer these over raw getByPlaceholder→click→fill chains:
 * many marketing forms clear the placeholder on focus, which makes the original locator hang
 * until Playwright's action timeout.
 */
import { stabilizeLocator } from './focus.mjs';

/**
 * Click and fill a field. Rebinds to name/id before focus so placeholder/label locators stay safe.
 * Returns false when the control is missing or not visible.
 */
export async function typeInto(locator, value, { sequential = false, delay = 14, timeout = 4000 } = {}) {
  const el = locator.first();
  if (!(await el.isVisible().catch(() => false))) return false;
  const target = await stabilizeLocator(el);
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await target.click({ timeout }).catch(() => {});
  if (sequential) {
    await target.fill('').catch(() => {});
    await target.pressSequentially(String(value), { delay }).catch(async () => {
      await target.fill(String(value)).catch(() => {});
    });
  } else {
    await target.fill(String(value)).catch(() => {});
  }
  return true;
}

/**
 * Fill a visible field by label/placeholder/role, then name/id/placeholder attrs — never submits.
 */
export async function fillField(page, patterns, value, opts = {}) {
  const { attrRe, ...typeOpts } = opts;
  for (const re of patterns) {
    for (const loc of [page.getByLabel(re), page.getByPlaceholder(re), page.getByRole('textbox', { name: re })]) {
      if (await typeInto(loc, value, typeOpts)) return true;
    }
  }
  const attrMatcher = attrRe || ((hay) => patterns.some((re) => re.test(hay)));
  const nodes = await page
    .locator(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea'
    )
    .all();
  for (const node of nodes) {
    if (!(await node.isVisible().catch(() => false))) continue;
    const name = (await node.getAttribute('name').catch(() => '')) || '';
    const id = (await node.getAttribute('id').catch(() => '')) || '';
    const ph = (await node.getAttribute('placeholder').catch(() => '')) || '';
    const hay = `${name} ${id} ${ph}`;
    const matches = typeof attrMatcher === 'function' ? attrMatcher(hay) : attrMatcher.test(hay);
    if (!matches) continue;
    if (await typeInto(node, value, typeOpts)) return true;
  }
  return false;
}
