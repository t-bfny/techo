import { test, expect, importFiles, newNote } from './helpers.js';

test('open a note in its own window: only the note, and it leaves the main tabs', async ({ page }) => {
  await page.goto('/#list');
  await newNote(page, 'セットリスト');
  await newNote(page, '曲メモ', '曲メモの本文');
  await page.click('#noteList li:has-text("曲メモ")', { button: 'right' });
  const [win] = await Promise.all([page.waitForEvent('popup'), page.click('#popover .menu-item:has-text("新しいウィンドウで開く")')]);
  await expect(win.locator('.tiptap')).toContainText('曲メモの本文');
  await expect(win).toHaveTitle('曲メモ');
  for (const id of ['#sidebar', '#listPane', '#tabs']) await expect(win.locator(id)).toBeHidden();
  await expect(win.locator('#notice')).toBeHidden(); // not reported as "open in another tab"
  await expect(page.locator('#tabList .tab')).toHaveText([/セットリスト/]);

  await win.locator('.tiptap').click();
  await win.keyboard.press('Control+End');
  await win.keyboard.type(' 追記');
  await win.fill('#titleInput', '曲メモ(改)');
  await expect(win).toHaveTitle('曲メモ(改)');
  await expect(page.locator('#noteList')).toContainText('追記');

  const closed = win.waitForEvent('close');
  await win.click('#deleteBtn');
  await closed;
  await expect(page.locator('#countTrash')).toHaveText('1');
});

test('print: Ctrl+P prints the open note, the menu prints several; video becomes a link', async ({ page }) => {
  await page.goto('/#list');
  await importFiles(page, ['sample.enex']);
  await page.evaluate(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
  await page.click('#noteList li:has-text("全部入り")');
  await page.locator('.tiptap').click();
  await page.keyboard.press('Control+p');
  await expect.poll(() => page.evaluate(() => window.__prints)).toBe(1);
  await expect(page.locator('#printArea article')).toHaveCount(1);
  await expect(page.locator('#printArea .print-yt')).toHaveText(['YouTube: https://www.youtube.com/watch?v=jNQXAC9IVRw']);

  await page.click('#noteList li:has-text("全部入り")');
  await page.click('#noteList li:has-text("二件目")', { modifiers: ['Shift'] });
  await page.click('#noteList li:has-text("二件目")', { button: 'right' });
  await page.click('#popover .menu-item:has-text("2件を印刷")');
  expect((await page.locator('#printArea article h1').allTextContents()).sort()).toEqual(['二件目', '全部入り'].sort());
});
