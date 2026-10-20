// IndexedDB wrapper.
// notes: {id, title, html, text, notebookId, pinned, pinTop, template, deletedAt, sourceKey,
//         savedBy, createdAt, updatedAt}   (fields added later are optional: old records lack them)
// notebooks: {id, name, pinned, numbered, createdAt}
// attachments: {id, blob, type, name, createdAt}  (html references them as att:ID)

import { t as tr } from './i18n.js';

const DB_NAME = 'techo';

// ---------- changing the stored shape ----------
// Each change gets the next number and one step below; never edit a step that has shipped.
// The browser runs every step between the version it has and DB_VERSION, in order, inside
// one upgrade transaction: if a step throws, the whole upgrade rolls back and the old data
// stays as it was. A step may add/remove stores and indexes, or rewrite records through
// tx.objectStore(...).openCursor(). Add a test in tests/migration.spec.js that opens data
// made at the previous version. (Notes without a notebook are fixed after loading, by
// ensureNotebooks in main.js, so steps don't need to know the default notebook.)
const UPGRADES = {
  // v0.1: notes and their attachments
  1: db => {
    db.createObjectStore('notes', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
    db.createObjectStore('attachments', { keyPath: 'id' });
  },
  // v0.4: notebooks
  2: db => {
    db.createObjectStore('notebooks', { keyPath: 'id' });
  },
};
export const DB_VERSION = Math.max(...Object.keys(UPGRADES).map(Number));

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      for (let v = e.oldVersion + 1; v <= DB_VERSION; v++) UPGRADES[v](req.result, req.transaction);
    };
    // Another tab still runs an older techo and holds the database open.
    req.onblocked = () => window.dispatchEvent(new CustomEvent('techo:db-blocked'));
    req.onsuccess = () => {
      const db = req.result;
      // A newer version opened in another tab wants to upgrade: step aside instead of blocking it.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    // VersionError: the data was already upgraded by a newer techo than this (cached) one.
    req.onerror = () => { dbPromise = null; reject(req.error); };
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
