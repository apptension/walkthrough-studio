import { expect, test } from '@playwright/test';

/**
 * The rebuilt desk, end to end, against the stub studio.
 *
 * These follow the legacy desk's own controls — the same ids and the same
 * keyboard map as `kit/studio` — so a pass means the pieces are wired together
 * the way the original `wire()` wired them.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#bootLoader')).toHaveCount(0);
});

test('opens the first project and names it in the URL', async ({ page }) => {
  await expect(page).toHaveURL(/slug=demo/);
  await expect(page).toHaveTitle(/^Walkthrough Studio · /);
  await expect(page.locator('#slugSelect')).toHaveValue('demo');
  await expect(page.locator('#stageBar')).toBeVisible();
  await expect(page.locator('#projectPanel')).toBeVisible();
  await expect(page.locator('#statusText')).not.toHaveText('Loading…');
});

test('moves between the left panel tabs', async ({ page }) => {
  await page.locator('#projectPanel .ptab[data-left="deliver"]').click();
  await expect(page.locator('#leftDeliver')).toBeVisible();
  await expect(page.locator('#title')).toBeVisible();
  await expect(page.locator('#handoffBox')).toBeVisible();

  await page.locator('#projectPanel .ptab[data-left="versions"]').click();
  await expect(page.locator('#leftVersions')).toBeVisible();
  await expect(page.locator('#leftDeliver')).toBeHidden();
});

test('keeps the sequence across a reload and reopens on Render', async ({ page }) => {
  await page.locator('#projectPanel .ptab[data-left="versions"]').click();
  await expect(page.locator('#projectPanel .ptab[data-left="versions"]')).toHaveAttribute('aria-selected', 'true');

  await page.reload();
  await expect(page.locator('#bootLoader')).toHaveCount(0);
  // The legacy desk opens on Render after a reload; the selection itself is not persisted.
  await expect(page.locator('#leftRender')).toBeVisible();
  await expect(page).toHaveURL(/slug=demo/);
});

test('opens the script sheet from the stage bar', async ({ page }) => {
  await page.locator('.pstage[data-stage="script"]').click();
  const sheet = page.locator('#scriptDialog');
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('drives the command menu from the keyboard', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+k');
  const menu = page.locator('#commandDialog');
  await expect(menu).toBeVisible();

  await page.locator('#commandInput').fill('deliver');
  await expect(menu.locator('[data-command="deliver"]')).toBeVisible();
  await expect(menu.locator('[data-command="render"]')).toBeHidden();
  await menu.locator('[data-command="deliver"]').click();

  await expect(menu).toBeHidden();
  await expect(page.locator('#leftDeliver')).toBeVisible();
  await expect(page.locator('#toolsPanel .ptab[data-right="deliver"]')).toHaveCount(0);
});

test('opens the studio guide with ?', async ({ page }) => {
  await page.keyboard.press('?');
  const guide = page.locator('#helpDialog');
  await expect(guide).toBeVisible();
  await expect(guide.getByRole('heading', { name: 'How a video gets made' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(guide).toBeHidden();
});

test('keeps a shortcut out of a field being typed', async ({ page }) => {
  const note = page.locator('#improveNote');
  await note.click();
  await note.fill('cut the open');
  await page.keyboard.press('c');
  await expect(note).toHaveValue('cut the openc');
  await expect(page.locator('#togCaptions')).not.toBeChecked();
});

test('switches sequences from the picker', async ({ page }) => {
  const select = page.locator('#slugSelect');
  const options = select.locator('option');
  await expect(options).not.toHaveCount(0);
  const value = await options.nth(0).getAttribute('value');
  await select.selectOption(value ?? '');
  await expect(page).toHaveURL(new RegExp(`slug=${value}`));
});
