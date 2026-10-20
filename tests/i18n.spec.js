import { test, expect, seed, note, importFiles } from './helpers.js';

const JAPANESE = /[぀-ヿ一-鿿]/;

// Japanese text left in techo's own UI. Note content (titles, bodies, notebook names) is the
// user's and is skipped.
const leftovers = page => page.evaluate(() => {
  const own = el => el.closest('.tiptap, #stageBody, #titleInput, .card-t, .card-s, .card-d, #noteList .t, #noteList .s, #noteList .nb, .hit-t, .hit-s, .hit-m, .task-t, .task-note, .file-name, .file-note, #notebookList, #recentList, #shortcutList, .nb-row, #homeNotebooks, #homeShortcuts, .crumbs select, #crumbTitle, .tab, .trash-row .dim, #langBtn');
  const out = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) {
    const el = walk.currentNode.parentElement;
    if (!el || own(el) || !el.checkVisibility()) continue;
    if (/[぀-ヿ一-鿿]/.test(walk.currentNode.nodeValue)) out.add(walk.currentNode.nodeValue.trim());
  }
  for (const el of document.querySelectorAll('[title], [placeholder]')) {
    for (const a of ['title', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v && el.id !== 'langBtn' && /[぀-ヿ一-鿿]/.test(v)) out.add(`${a}: ${v}`);
    }
  }
  return [...out];
});

test.describe('in English', () => {
  test.use({ locale: 'en-US' });

  test('every screen and menu is in English', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#newBtn')).toHaveText('New');
    await expect(page.locator('#langBtn')).toHaveText('日本語');
    expect(await importFiles(page, ['sample.enex'])).toBe('sample: added 2 notes');
    await page.goto('/');
    expect(await leftovers(page)).toEqual([]);
    for (const view of ['list', 'notebooks', 'tasks', 'files', 'templates', 'trash']) {
      await page.goto(`/#${view}`);
      expect(await leftovers(page), view).toEqual([]);
    }
    await page.goto('/#list');
    await page.click('#noteList li >> nth=0');
    expect(await leftovers(page), 'note').toEqual([]);
    await page.click('[data-pop="insert"]');
    await expect(page.locator('#popover .menu-item')).toContainText(['Image', 'Table', 'Contents']);
    await page.keyboard.press('Escape');
    await page.click('#noteList li >> nth=0', { button: 'right' });
    expect(await leftovers(page), 'note menu').toEqual([]);
    await page.keyboard.press('Escape');
    await page.click('#noteList li >> nth=0');
    await page.click('#noteList li >> nth=1', { modifiers: ['Shift'] });
    await expect(page.locator('#bulkCount')).toHaveText('2 selected');
    await page.click('#bulkDelete');
    await expect(page.locator('#toastMsg')).toHaveText('Moved 2 notes to the trash');
  });

  test('"マイノート" and "My Notes" count as the same default notebook', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#notebookList .side-item')).toHaveText(['My Notes0']);
    // Japanese data arrives next to the empty English default: the empty one is cleaned up
    await seed(page, { notebooks: [{ id: 'jp', name: 'マイノート', createdAt: 1 }], notes: [note('a', 'メモ', { notebookId: 'jp' })] });
    await page.goto('/');
    await expect(page.locator('#notebookList .side-item')).toHaveText(['マイノート1']);
  });
});

test('the language button switches and remembers', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#langBtn')).toHaveText('English');
  await page.click('#langBtn');
  await expect(page.locator('#newBtn')).toHaveText('New');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.reload();
  await expect(page.locator('#themeBtn')).toHaveText(/^Theme: /);
  await page.click('#langBtn');
  await expect(page.locator('#newBtn')).toHaveText('新規作成');
  expect(JAPANESE.test(await page.locator('#sortSelect option').first().textContent())).toBe(true);
});
