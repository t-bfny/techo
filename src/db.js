// IndexedDB wrapper. notes: {id, title, html, text, createdAt, updatedAt}
// attachments: {id, blob, type, createdAt}  (html references them as att:ID)

const DB_NAME = 'techo';
const DB_VERSION = 1;
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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error);
  }));
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const getAllNotes = () => tx('notes', 'readonly', s => s.getAll());
export const getNote = id => tx('notes', 'readonly', s => s.get(id));
export const putNote = note => tx('notes', 'readwrite', s => s.put(note));
export const deleteNote = id => tx('notes', 'readwrite', s => s.delete(id));

export const getAttachment = id => tx('attachments', 'readonly', s => s.get(id));
export const getAllAttachments = () => tx('attachments', 'readonly', s => s.getAll());
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
