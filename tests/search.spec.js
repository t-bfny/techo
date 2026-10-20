import { test, expect, seed, note } from './helpers.js';

const long = 'はじめの段落はセッションとは関係のない話がしばらく続きます。'.repeat(4);

test.beforeEach(async ({ page }) => {
  await seed(page, {
    notebooks: [{ id: 'nb1', name: 'マイノート', createdAt: 1 }, { id: 'nb2', name: 'テスト帳', createdAt: 2 }],
    notes: [
      note('s1', 'ジャムセッションのメモ', { text: 'テンポ120で始める', notebookId: 'nb2', updatedAt: Date.now() - 5e6 }),
      note('s2', 'リハ反省', { text: `${long}次のせっしょんではＢＰＭを上げてみる。ドラムのフィルを短く。`, updatedAt: Date.now() }),
      ...Array.from({ length: 35 }, (_, i) => note(`n${i}`, `ノート${i}`, { text: `本文${i}`, updatedAt: 1000 + i })),
    ],
  });
  await page.goto('/');
});

const hits = page => page.locator('#homeResults .hit .hit-t');

test('home search: as you type, title hits first, hits marked in a snippet', async ({ page }) => {
  await page.fill('#homeSearch', 'セッション');
  await expect(page.locator('.hit-head')).toHaveText('2件');
  await expect(page.locator('.home-main')).toBeHidden();
  await expect(hits(page)).toHaveText(['ジャムセッションのメモ', 'リハ反省']);
  await expect(page.locator('#homeResults .hit').first().locator('mark').first()).toHaveText('セッション');
  // a snippet starts near the hit, not at the top of a long note
  await page.fill('#homeSearch', 'ドラム');
  await expect(page.locator('#homeResults .hit-s').first()).toContainText('…');
  await expect(page.locator('#homeResults .hit-s mark')).toHaveText('ドラム');
});

test('kana, width and case do not matter; words are ANDed', async ({ page }) => {
  await page.fill('#homeSearch', 'じゃむ');
  await expect(hits(page)).toHaveText(['ジャムセッションのメモ']);
  await page.fill('#homeSearch', 'bpm ドラム');
  await expect(hits(page)).toHaveText(['リハ反省']);
  await expect(page.locator('#homeResults .hit-s mark')).toHaveText(['ＢＰＭ', 'ドラム']);
  await page.fill('#homeSearch', 'bpm 存在しない');
  await expect(page.locator('.hit-head')).toHaveText('見つかりませんでした');
});

test('more than 30 hits link to the full list', async ({ page }) => {
  await page.fill('#homeSearch', '本文');
  await expect(hits(page)).toHaveCount(30);
  await page.click('.hit-head button');
  await expect(page.locator('#filterName')).toHaveText('すべてのノート');
  await expect(page.locator('#count')).toHaveText('35 / 37件');
});

test('keyboard: Enter opens the first hit, Esc clears, Ctrl+K comes back from anywhere', async ({ page }) => {
  await page.fill('#homeSearch', 'じゃむ');
  await page.keyboard.press('Enter');
  await expect(page.locator('#titleInput')).toHaveValue('ジャムセッションのメモ');
  await page.locator('.tiptap').click();
  await page.keyboard.press('Control+k');
  await expect(page.locator('#homeSearch')).toBeFocused();
  await expect(page).toHaveURL(/#home$/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#homeSearch')).toHaveValue('');
  await expect(page.locator('.home-main')).toBeVisible();
});

test('searching inside a notebook tells you about hits elsewhere', async ({ page }) => {
  await page.click('#notebookList .side-item:has-text("テスト帳")');
  await page.fill('#search', 'せっしょん');
  await expect(page.locator('#noteList li .t')).toHaveText(['ジャムセッションのメモ']);
  await expect(page.locator('#noteList li .t mark')).toHaveText('セッション');
  await expect(page.locator('#searchAll')).toHaveText('ほかのノートにも1件 — すべてのノートで検索');
  await page.click('#searchAll');
  await expect(page.locator('#filterName')).toHaveText('すべてのノート');
  await expect(page.locator('#count')).toHaveText('2 / 37件');
  await expect(page.locator('#searchAll')).toBeHidden();
});
