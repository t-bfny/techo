// Shared test setup. Every test gets a fresh browser profile (empty IndexedDB), so tests
// never see each other's notes.
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';

export { expect };

export const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

export const test = base.extend({
  // A fresh browser normally gets a welcome note; most tests want a truly empty start.
  welcome: [false, { option: true }],
  // What prompt() answers; tests set page.answer = '…' before triggering one.
  page: async ({ page, welcome }, use) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.dialogs = [];
    page.answer = '';
    page.on('dialog', d => { page.dialogs.push(d.message()); d.accept(d.type() === 'prompt' ? page.answer : undefined); });
    // Headless Chrome has a save dialog API but nobody to answer it: use the download path.
    await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
    if (!welcome) await page.addInitScript(() => { if (!localStorage.getItem('techo.welcomed')) localStorage.setItem('techo.welcomed', 'true'); });
    await use(page);
    expect(errors, 'uncaught errors in the page').toEqual([]);
  },
});

// Writes records straight into techo's database before the app starts.
// Call on a blank page of the same origin (it opens the DB at the current version).
export async function seed(page, { notebooks = [], notes = [], attachments = [], version = 2 } = {}) {
  await page.goto('/icon.svg');
  await page.evaluate(async ({ notebooks, notes, attachments, version }) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('techo', version);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
        if (!d.objectStoreNames.contains('attachments')) d.createObjectStore('attachments', { keyPath: 'id' });
        if (version >= 2 && !d.objectStoreNames.contains('notebooks')) d.createObjectStore('notebooks', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const stores = ['notes', 'attachments', ...(version >= 2 ? ['notebooks'] : [])];
    await new Promise((resolve, reject) => {
      const t = db.transaction(stores, 'readwrite');
      for (const n of notes) t.objectStore('notes').put(n);
      for (const a of attachments) t.objectStore('attachments').put({ ...a, blob: new Blob([a.content ?? 'x'], { type: a.type }) });
      for (const nb of notebooks) t.objectStore('notebooks').put(nb);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
    db.close();
  }, { notebooks, notes, attachments, version });
}

// Everything in one store, read without going through the app.
export const readStore = (page, store) => page.evaluate(name => new Promise(resolve => {
  indexedDB.open('techo').onsuccess = e => {
    const db = e.target.result;
    db.transaction(name).objectStore(name).getAll().onsuccess = r => { resolve(r.target.result); db.close(); };
  };
}), store);

// ids must look like techo's own (lowercase letters and digits): routes only match those.
export const note = (id, title, extra = {}) => ({
  id, title, html: `<p>${title}の本文</p>`, text: `${title}の本文`, notebookId: 'nb1', createdAt: 1000, updatedAt: 2000, ...extra,
});

export const titles = page => page.locator('#noteList li .t').allTextContents();

// 新規作成 with no templates → straight into a blank note; waits until saved.
export async function newNote(page, title, body) {
  await page.click('#newBtn');
  await expect(page.locator('#titleInput')).toBeFocused();
  await page.fill('#titleInput', title);
  if (body) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(body);
  }
  await saved(page);
}

// The autosave runs ~500ms after the last change.
export const saved = page => page.waitForTimeout(900);

export async function importFiles(page, files) {
  const before = page.dialogs.length;
  await page.setInputFiles('#importInput', files.map(fixture));
  await expect.poll(() => page.dialogs.length, { timeout: 30_000 }).toBeGreaterThan(before);
  return page.dialogs.at(-1);
}
