import { test, expect, seed, note } from './helpers.js';

const fontOf = (page, sel) => page.locator(sel).evaluate(el => getComputedStyle(el).fontFamily);

test('font setting: default, Meiryo, the browser sans-serif (named after the real font); applies everywhere and is remembered', async ({ page }) => {
  await seed(page, { notebooks: [{ id: 'nb1', name: 'マイノート', createdAt: 1 }], notes: [note('a', 'フォント確認')] });
  await page.goto('/');
  await expect(page.locator('#fontBtn')).toHaveText('フォント: 標準');
  expect(await fontOf(page, 'body')).toContain('Yu Gothic UI');

  await page.click('#fontBtn');
  const items = page.locator('#popover .menu-item');
  await expect(items).toHaveText(['標準', 'メイリオ', /^ブラウザ標準/]);
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
  await page.locator('#popover .menu-item', { hasText: 'ブラウザ標準' }).click();
  expect(await fontOf(page, 'body')).toBe('sans-serif');
  await expect(page.locator('#fontBtn')).toHaveText(/^フォント: ブラウザ標準/);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-font', 'browser');
  await page.click('#fontBtn');
  await page.locator('#popover .menu-item:text-is("標準")').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-font', /./);
  expect(await fontOf(page, 'body')).toContain('Yu Gothic UI');
});

test('the browser default is named after the font it really is', async ({ page }) => {
  await page.goto('/');
  // in this browser: which candidate measures like sans-serif, decided the same way as the app
  const real = await page.evaluate(() => {
    const p = document.createElement('span');
    p.textContent = '永あア漢字の幅を測る Wwmil 0123456789';
    p.style.cssText = 'position:absolute;font-size:40px;white-space:nowrap';
    document.body.append(p);
    const w = f => { p.style.fontFamily = f; return p.getBoundingClientRect().width; };
    return { sans: w('sans-serif'), meiryo: w('"Meiryo", monospace'), mono: w('monospace') };
  });
  await page.click('#fontBtn');
  const label = page.locator('#popover .menu-item').nth(2);
  if (Math.abs(real.meiryo - real.mono) > 0.5 && Math.abs(real.meiryo - real.sans) < 0.5) await expect(label).toHaveText('ブラウザ標準(メイリオ)');
  else await expect(label).toHaveText(/^ブラウザ標準/);
});

test('v0.20.0 saved this choice as "wikipedia": still the browser font', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('techo.font', JSON.stringify('wikipedia')));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-font', 'browser');
  await expect(page.locator('#fontBtn')).toHaveText(/^フォント: ブラウザ標準/);
});
