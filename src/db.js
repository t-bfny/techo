// IndexedDB wrapper.
// notes: {id, title, html, text, notebookId, pinned, createdAt, updatedAt}
// notebooks: {id, name, createdAt}
// attachments: {id, blob, type, createdAt}  (html references them as att:ID)

import { t as tr } from './i18n.js';

const DB_NAME = 'techo';
const DB_VERSION = 2;
let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('attachments')) {
        db.createObjectStore('attachments', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('notebooks')) {
        db.createObjectStore('notebooks', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // A newer version opened in another tab wants to upgrade: step aside instead of blocking it.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Other tabs of techo hear about every write, so their lists don't go stale and an open
// note can tell it was changed elsewhere.
export const channel = 'BroadcastChannel' in window ? new BroadcastChannel('techo-data') : null;
export const TAB_ID = Math.random().toString(36).slice(2);

function tx(store, mode, fn, id) {
  return open().then(db => new Promise((resolve, reject) => {
    const failWith = err => {
      if (mode === 'readwrite') window.dispatchEvent(new CustomEvent('techo:write-failed', { detail: err }));
      reject(err);
    };
    let t, result;
    try {
      t = db.transaction(store, mode);
      result = fn(t.objectStore(store));
    } catch (err) {
      failWith(err); // e.g. the record can't be stored, or the connection was closed
      return;
    }
    t.oncomplete = () => {
      if (mode === 'readwrite') channel?.postMessage({ type: 'changed', store, id, from: TAB_ID });
      resolve(result && 'result' in result ? result.result : result);
    };
    // A full disk aborts the transaction (QuotaExceededError) rather than erroring it;
    // without onabort the promise would never settle and saving would hang forever.
    const fail = () => failWith(t.error || new Error(tr('保存できませんでした')));
    t.onerror = fail;
    t.onabort = fail;
  }));
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const getAllNotes = () => tx('notes', 'readonly', s => s.getAll());
export const getNote = id => tx('notes', 'readonly', s => s.get(id));
// savedBy lets an open note tell "changed by another tab" apart from this tab's own writes.
export const putNote = note => { note.savedBy = TAB_ID; return tx('notes', 'readwrite', s => s.put(note), note.id); };
export const deleteNote = id => tx('notes', 'readwrite', s => s.delete(id), id);

export const getAllNotebooks = () => tx('notebooks', 'readonly', s => s.getAll());
export const putNotebook = nb => tx('notebooks', 'readwrite', s => s.put(nb), nb.id);
export const deleteNotebook = id => tx('notebooks', 'readwrite', s => s.delete(id));

export const getAttachment =id => tx('attachments', 'readonly', s => s.get(id));
export const getAllAttachments = () => tx('attachments', 'readonly', s => s.getAll());
export const getAttachmentIds = () => tx('attachments', 'readonly', s => s.getAllKeys());
export const putAttachment = att => tx('attachments', 'readwrite', s => s.put(att));
export const deleteAttachment = id => tx('attachments', 'readwrite', s => s.delete(id));

// Ask the browser not to evict our data under storage pressure.
export async function requestPersist() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* not supported */ }
}
