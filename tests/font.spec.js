import { test, expect, seed, note } from './helpers.js';

const fontOf = (page, sel) => page.locator(sel).evaluate(el => getComputedStyle(el).fontFamily);

test('font setting: default, Meiryo, Wikipedia (the browser sans-serif); applies everywhere and is remembered', async ({ page }) => {
  await seed(page, { notebooks: [{ id: 'nb1', name: 'マイノート', createdAt: 1 }], notes: [note('a', 'フォント確認')] });
  await page.goto('/');
  await expect(page.locator('#fontBtn')).toHaveText('フォント: 標準');
  expect(await fontOf(page, 'body')).toContain('Yu Gothic UI');

  await page.click('#fontBtn');
  const items = page.locator('#popover .menu-item');
  await expect(items).toHaveText(['標準', 'メイリオ', 'Wikipedia']);
  await expect(items.first()).toHaveClass(/current/);
  expect(await items.nth(1).evaluate(el => getComputedStyle(el).fontFamily)).toContain('Meiryo'); // each choice in its own font
  await items.nth(1).click();
  await expect(page.locator('#fontBtn')).toHaveText('フォント: メイリオ');
  expect(await fontOf(page, 'body')).toMatch(/^"?Meiryo/);

  await page.goto('/#n/a');
  expect(await fontOf(page, '.tiptap')).toMatch(/^"?Meiryo/);
  expect(await fontOf(page, '#titleInput')).toMatch(/^"?Meiryo/);
  // set before the first paint: already there when the page's own script hasn't run yet
  await page.reload({ waitUntil: 'commit' });
  await page.waitForSelector('html[data-font="meiryo"]', { state: 'attached' });

  await page.goto('/');
  await page.click('#fontBtn');
  await page.locator('#popover .menu-item', { hasText: 'Wikipedia' }).click();
  expect(await fontOf(page, 'body')).toBe('sans-serif');
  await page.click('#fontBtn');
  await page.locator('#popover .menu-item', { hasText: '標準' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-font', /./);
  expect(await fontOf(page, 'body')).toContain('Yu Gothic UI');
});
