// Data made by older (and newer) versions of techo. When a step is added to UPGRADES in
// src/db.js, add a test here that opens data made at the version before it.
import { test, expect, seed, readStore } from './helpers.js';

const dbVersion = page => page.evaluate(() => new Promise(r => {
  indexedDB.open('techo').onsuccess = e => { r(e.target.result.version); e.target.result.close(); };
}));

test('v1 data (no notebooks yet) is upgraded and nothing is lost', async ({ page }) => {
  await seed(page, {
    version: 1,
    notes: [{ id: 'old1', title: '旧ノート', html: '<p>v0.1のメモ</p>', text: 'v0.1のメモ', createdAt: 1, updatedAt: Date.now() - 86400000 }],
    attachments: [{ id: 'att1', type: 'image/png', content: 'IMG' }],
  });
  await page.goto('/#list');
  await expect(page.locator('#noteList li')).toHaveText([/旧ノート/]);
  await expect(page.locator('#notebookList .side-item')).toHaveText(['マイノート1']); // made and filled on upgrade
  expect(await dbVersion(page)).toBe(2);
  const [n] = await readStore(page, 'notes');
  const [nb] = await readStore(page, 'notebooks');
  expect(n.notebookId).toBe(nb.id);
  expect(n.text).toBe('v0.1のメモ');
  expect((await readStore(page, 'attachments')).map(a => a.id)).toEqual(['att1']);
});

test('a fresh browser gets the current version from scratch', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#notebookList .side-item')).toHaveText(['マイノート0']);
  expect(await dbVersion(page)).toBe(2);
});

test('data already upgraded by a newer techo: says so instead of breaking, writes nothing', async ({ page }) => {
  await page.goto('/icon.svg');
  await page.evaluate(() => new Promise(r => {
    const req = indexedDB.open('techo', 99);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('notes', { keyPath: 'id' });
      req.result.createObjectStore('attachments', { keyPath: 'id' });
      req.result.createObjectStore('notebooks', { keyPath: 'id' });
    };
    req.onsuccess = () => { req.result.close(); r(); };
  }));
  await page.goto('/');
  await expect(page.locator('#notice')).toHaveAttribute('data-kind', 'error');
  await expect(page.locator('#noticeMsg')).toContainText('新しい版のtechoで更新されています');
  await expect(page.locator('#noticeA')).toHaveText('再読み込み');
  expect(await dbVersion(page)).toBe(99);
});
