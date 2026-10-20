import fs from 'node:fs';
import { test, expect, seed, note, readStore, importFiles, newNote, fixture } from './helpers.js';

const exportBackup = async (page, trigger) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const path = test.info().outputPath(dl.suggestedFilename());
  await dl.saveAs(path);
  return path;
};

test('Evernote import converts what techo understands; importing again adds no duplicates', async ({ page }) => {
  await page.goto('/#list');
  const msg = await importFiles(page, ['sample.enex']);
  expect(msg).toBe('sample: 2件を追加');
  await expect(page.locator('#notebookList')).toContainText('sample');
  await page.click('#noteList li:has-text("全部入り")');
  const ed = page.locator('.tiptap');
  await expect(ed).toContainText('一行目 です');
  await expect(ed.locator('img')).toHaveCount(1);
  await expect(ed.locator('li[data-checked="true"]')).toHaveText([/済みタスク/, /新形式済み/]);
  await expect(ed.locator('li[data-checked="false"]')).toHaveText([/未完タスク/, /新形式未完/]);
  await expect(ed.locator('pre code')).toContainText('const a = 1;');
  await expect(ed.locator('mark')).toHaveText('ハイライト');
  await expect(ed.locator('table td')).toHaveText(['A1', 'B1', 'A2', 'B2']);
  await expect(ed.locator('iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/jNQXAC9IVRw/);
  await expect(ed.locator('iframe')).not.toHaveAttribute('src', /controls=0/); // the player keeps its controls
  await expect(ed.locator('a', { hasText: '添付: 譜面.pdf' })).toBeVisible();
  await expect(ed).toContainText('[暗号化された内容]');

  // unedited notes are converted again (to pick up converter fixes), never duplicated
  const again = await importFiles(page, ['sample.enex']);
  expect(again).toBe('sample: 0件を追加、2件を取り込み直し');
  expect((await readStore(page, 'notes')).length).toBe(2);
});

test('a backup restores notes, notebooks and images in another browser', async ({ page, browser }) => {
  await seed(page, {
    notebooks: [{ id: 'nb1', name: 'マイノート', createdAt: 1 }, { id: 'nb2', name: 'Tech', createdAt: 2 }],
    notes: [note('a1', 'A-1'), note('a2', 'A-tech', { notebookId: 'nb2', html: '<p>改行\nあり</p><img src="att:img1">' })],
    attachments: [{ id: 'img1', type: 'image/png', content: 'PNGDATA' }],
  });
  await page.goto('/');
  // the reminder's own button exports everything
  await expect(page.locator('#noticeMsg')).toContainText('まだ一度も書き出し');
  const path = await exportBackup(page, () => page.click('#noticeA'));
  await expect(page.locator('#notice')).toBeHidden();
  await expect(page.locator('#toastMsg')).toContainText('に書き出しました');
  const text = fs.readFileSync(path, 'utf8');
  expect(text.split('\n')[0]).toMatch(/^\{"app":"techo","version":2,/);
  expect(JSON.parse(text).records.map(r => r.kind).sort()).toEqual(['attachment', 'note', 'note', 'notebook', 'notebook']);

  // another device: its own empty マイノート, its own Tech
  const other = await (await browser.newContext()).newPage();
  other.on('dialog', d => d.accept('Tech'));
  await other.goto('/');
  await other.click('#addNotebookBtn');
  const dialog = other.waitForEvent('dialog');
  await other.setInputFiles('#importInput', path);
  expect((await dialog).message()).toContain('2件を読み込みました');
  await expect(other.locator('#notebookList .side-item')).toHaveText(['Tech1', 'マイノート1']); // merged by name, no duplicates
  const att = await other.evaluate(() => new Promise(r => indexedDB.open('techo').onsuccess = e =>
    e.target.result.transaction('attachments').objectStore('attachments').get('img1').onsuccess = async a => r(await a.target.result.blob.text())));
  expect(att).toBe('PNGDATA');
  await other.context().close();
});

test('backups from v0.14.1 and earlier still import', async ({ page }) => {
  await page.goto('/');
  expect(await importFiles(page, ['backup-v1.json'])).toBe('backup-v1.json: 2件を読み込みました');
  await expect(page.locator('#notebookList')).toContainText('Tech2');
  expect((await readStore(page, 'attachments')).map(a => a.id)).toEqual(['v1img']);
});

test('a backup from a newer techo is refused before anything is written', async ({ page }) => {
  await page.goto('/');
  const path = test.info().outputPath('future.json');
  fs.writeFileSync(path, '{"app":"techo","version":99,"exportedAt":1,"records":[\n{"kind":"note","data":{"id":"zz","title":"未来","html":"","text":"","createdAt":1,"updatedAt":1}}\n]}\n');
  const dialog = page.waitForEvent('dialog');
  await page.setInputFiles('#importInput', path);
  expect((await dialog).message()).toContain('新しい版のtechoで書き出されたファイルです');
  expect(await readStore(page, 'notes')).toEqual([]);
});

test('.enex and .json can be picked together from the one import button', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#importInput')).toHaveAttribute('accept', /\.enex/);
  const msg = await importFiles(page, ['sample.enex', 'backup-v1.json']);
  expect(msg).toBe('sample: 2件を追加\nbackup-v1.json: 2件を読み込みました');
});

test('an export that fails says why and offers to retry', async ({ page }) => {
  await page.goto('/#list');
  await newNote(page, 'メモ');
  await page.evaluate(() => {
    window.showSaveFilePicker = async () => ({
      name: 'x.json',
      createWritable: async () => ({ write: async () => { throw new DOMException('disk full', 'QuotaExceededError'); }, close: async () => {}, abort: async () => {} }),
    });
  });
  await page.click('#exportBtn');
  await expect(page.locator('#noticeMsg')).toHaveText('書き出しに失敗しました(QuotaExceededError: disk full)');
  await expect(page.locator('#noticeA')).toHaveText('もう一度');
  expect(await page.evaluate(() => localStorage.getItem('techo.lastBackup'))).toBeNull();
});

test('closing the save dialog is not an error', async ({ page }) => {
  await page.goto('/#list');
  await newNote(page, 'メモ');
  await page.evaluate(() => { window.showSaveFilePicker = async () => { throw new DOMException('closed', 'AbortError'); }; });
  await page.click('#exportBtn');
  await page.waitForTimeout(300);
  await expect(page.locator('#notice')).toBeHidden();
});

// The old exporter built one giant string and died silently past ~512M characters.
test('a backup bigger than one JavaScript string can hold still exports', async ({ page }) => {
  test.slow();
  await seed(page, { notebooks: [{ id: 'nb1', name: 'マイノート', createdAt: 1 }] });
  await page.evaluate(async () => {
    const db = await new Promise(r => { indexedDB.open('techo').onsuccess = e => r(e.target.result); });
    for (let i = 0; i < 45; i++) {
      const bytes = new Uint8Array(10 * 1024 * 1024);
      for (let j = 0; j < bytes.length; j += 4096) bytes[j] = (i * 31 + j) & 255;
      await new Promise(r => {
        const t = db.transaction(['attachments', 'notes'], 'readwrite');
        t.objectStore('attachments').put({ id: `big${i}`, blob: new Blob([bytes], { type: 'image/jpeg' }), type: 'image/jpeg', name: `p${i}.jpg`, createdAt: 1 });
        t.objectStore('notes').put({ id: `b${i}`, title: `写真${i}`, html: `<img src="att:big${i}">`, text: '', notebookId: 'nb1', createdAt: 1, updatedAt: 1 });
        t.oncomplete = r;
      });
    }
    db.close();
  });
  await page.goto('/');
  await page.evaluate(() => {
    window.__chars = 0;
    window.showSaveFilePicker = async o => ({ name: o.suggestedName, createWritable: async () => ({
      write: async s => { window.__chars += s.length; }, close: async () => { window.__closed = true; }, abort: async () => {} }) });
  });
  await page.click('#exportBtn');
  await expect.poll(() => page.evaluate(() => window.__closed), { timeout: 120_000 }).toBe(true);
  expect(await page.evaluate(() => window.__chars)).toBeGreaterThan(600_000_000);
  await expect(page.locator('#toastMsg')).toContainText('に書き出しました');
});

test('fixtures are where the tests expect them', () => {
  for (const f of ['sample.enex', 'evil.enex', 'score.pdf', 'backup-v1.json']) expect(fs.existsSync(fixture(f))).toBe(true);
});
