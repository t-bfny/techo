import { test, expect, newNote, saved } from './helpers.js';

const stored = (page, title) => page.evaluate(t => new Promise(r => indexedDB.open('techo').onsuccess = e =>
  e.target.result.transaction('notes').objectStore('notes').getAll().onsuccess = a => r(a.target.result.find(n => n.title === t)?.text)), title);
const notice = page => page.locator('#noticeMsg');
const typeAtEnd = async (page, text) => {
  await page.locator('.tiptap').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
  await saved(page);
};

test('two tabs on one note: warned, stale saves are stopped, latest or overwrite', async ({ page, context }) => {
  await page.goto('/#list');
  await newNote(page, '共有ノート', '最初の本文');
  const url = page.url();
  const other = await context.newPage();
  await other.goto(url);
  await expect(notice(other)).toContainText('別のタブでも開いています');
  await expect(notice(page)).toContainText('別のタブでも開いています');

  await typeAtEnd(page, ' Aの追記');
  await expect(notice(other)).toContainText('別のタブでこのノートが変更されました');

  await typeAtEnd(other, ' Bの追記'); // written on an old copy: must not overwrite A
  await expect(notice(other)).toContainText('保存を止めました');
  expect(await stored(page, '共有ノート')).toBe('最初の本文 Aの追記');

  await other.click('#noticeA'); // 最新を読み込む
  await expect(other.locator('.tiptap')).toHaveText('最初の本文 Aの追記');
  await typeAtEnd(other, ' B2');
  expect(await stored(page, '共有ノート')).toBe('最初の本文 Aの追記 B2');

  await typeAtEnd(page, ' A2'); // now A is the stale one, and overwrites on purpose
  await expect(notice(page)).toContainText('保存を止めました');
  await page.click('#noticeB'); // こちらで上書き
  await expect.poll(() => stored(page, '共有ノート')).toBe('最初の本文 Aの追記 A2');
});

test('other tabs keep their lists in sync and hear about deletions', async ({ page, context }) => {
  await page.goto('/#list');
  await newNote(page, '消されるノート');
  const other = await context.newPage();
  await other.goto(page.url());
  await page.goto('/#list');
  await newNote(page, '2つめ');
  await expect(other.locator('#countAll')).toHaveText('2');
  await page.click('#noteList li:has-text("消されるノート")');
  await page.click('#deleteBtn');
  await expect(notice(other)).toContainText('別のタブで削除');
});

test('a failed save is announced, nothing freezes, and retrying saves it', async ({ page }) => {
  await page.goto('/#list');
  await newNote(page, '2つめ');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    window.__restore = () => { IDBObjectStore.prototype.put = put; };
    IDBObjectStore.prototype.put = function (v) { const r = put.call(this, v); this.transaction.abort(); return r; };
  });
  await typeAtEnd(page, '失敗中に書いた文');
  await expect(page.locator('#notice')).toHaveAttribute('data-kind', 'error');
  await expect(notice(page)).toContainText('保存できませんでした');
  await page.click('.home-btn');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'home');
  await page.evaluate(() => window.__restore());
  await page.click('#noticeA'); // もう一度保存
  await expect.poll(() => stored(page, '2つめ')).toBe('失敗中に書いた文');
  await expect(page.locator('#notice')).toBeHidden();
});

test('closing the tab with unsaved changes asks first', async ({ page }) => {
  await page.goto('/#list');
  await newNote(page, 'メモ');
  await page.evaluate(() => { IDBObjectStore.prototype.put = function () { this.transaction.abort(); }; });
  await typeAtEnd(page, '保存できない文');
  const prevented = await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); dispatchEvent(e); return e.defaultPrevented; });
  expect(prevented).toBe(true);
});

test('backup reminder: shown until exported, "later" snoozes it', async ({ page }) => {
  await page.goto('/#list');
  await expect(page.locator('#notice')).toBeHidden(); // nothing to back up yet
  await newNote(page, 'メモ');
  await page.reload();
  await expect(notice(page)).toContainText('まだ一度も書き出し');
  await page.click('#noticeB'); // あとで
  await page.reload();
  await expect(page.locator('#notice')).toBeHidden();
  await page.evaluate(() => { localStorage.removeItem('techo.backupSnooze'); localStorage.setItem('techo.lastBackup', String(Date.now() - 8 * 86400000)); });
  await page.reload();
  await expect(notice(page)).toContainText('最後の書き出しから8日');
  await Promise.all([page.waitForEvent('download'), page.click('#noticeA')]);
  await page.reload();
  await expect(page.locator('#notice')).toBeHidden();
});
