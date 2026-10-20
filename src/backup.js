// Until sync exists, data lives only in this browser. Export/import is the safety net.
import {
  getAllNotes, getAttachmentIds, getAllNotebooks, getNote, putNote, putAttachment, putNotebook, getAttachment,
} from './db.js';
import { sanitizeHtml } from './sanitize.js';
import { fillToc } from './toc.js';
import { t as tr, notebookKey } from './i18n.js';

const toDataUrl = blob => new Promise(r => {
  const fr = new FileReader();
  fr.onload = () => r(fr.result);
  fr.readAsDataURL(blob);
});

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const today = () => new Intl.DateTimeFormat('en-CA').format(new Date()); // local date, not UTC
export const safeName = s => (s || tr('無題')).replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 80);
const attIds = notes => [...new Set(notes.flatMap(n => [...(n.html || '').matchAll(/att:([a-z0-9]+)/g)].map(m => m[1])))];

async function attachmentsFor(ids) {
  const out = [];
  for (const id of ids) {
    const a = await getAttachment(id);
    if (a) out.push({ id: a.id, type: a.type, name: a.name, createdAt: a.createdAt, data: await toDataUrl(a.blob) });
  }
  return out;
}

// Backups can be far bigger than one JS string may hold (an Evernote import with images is
// easily 1GB+), so they are written record by record, one record per line:
//   {"app":"techo","version":2,"exportedAt":…,"records":[
//   {"kind":"notebook","data":{…}},
//   …
//   ]}
// The whole file is still valid JSON; importFile reads it line by line.

// Where the backup goes. On PC Chrome/Edge a save dialog picks the place and the file is
// streamed to disk; elsewhere the parts collect in a Blob (no single huge string) and download.
// Must be the first await after the click, while the browser still counts it as user action.
async function openSink(filename) {
  if (window.showSaveFilePicker) {
    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: tr('techoのバックアップ'), accept: { 'application/json': ['.json'] } }],
      });
    } catch (err) {
      if (err.name === 'AbortError') return null; // closed the dialog
      throw err;
    }
    const w = await handle.createWritable();
    return { name: handle.name, write: s => w.write(s), close: () => w.close(), abort: () => w.abort().catch(() => {}) };
  }
  const parts = [];
  return {
    name: filename,
    write: s => { parts.push(s); },
    close: () => download(new Blob(parts, { type: 'application/json' }), filename),
    abort: () => {},
  };
}

// collect() → {notebooks, notes, attachmentIds}; runs after the dialog, so the dialog opens
// straight from the click. Attachments are read one at a time while writing.
// onProgress(0..1). Returns the saved file name, or null if the save dialog was closed.
async function writeBackup(filename, collect, onProgress = () => {}) {
  const sink = await openSink(filename);
  if (!sink) return null;
  try {
    const { notebooks, notes, attachmentIds } = await collect();
    onProgress(0);
    let buf = '', done = 0;
    const total = notebooks.length + notes.length + attachmentIds.length || 1;
    const flush = async (force) => {
      if (buf && (force || buf.length > 1 << 20)) { await sink.write(buf); buf = ''; }
    };
    let first = true;
    const record = async (kind, data) => {
      buf += (first ? '' : ',\n') + JSON.stringify({ kind, data });
      first = false;
      await flush();
      if (++done % 20 === 0) onProgress(done / total);
    };
    buf = `{"app":"techo","version":${BACKUP_VERSION},"exportedAt":${Date.now()},"records":[\n`;
    for (const nb of notebooks) await record('notebook', nb);
    for (const id of attachmentIds) {
      const a = await getAttachment(id);
      if (a) await record('attachment', { id: a.id, type: a.type, name: a.name, createdAt: a.createdAt, data: await toDataUrl(a.blob) });
      else done++;
    }
    for (const n of notes) await record('note', n);
    buf += '\n]}\n';
    await flush(true);
    await sink.close();
    onProgress(1);
    return sink.name;
  } catch (err) {
    await sink.abort();
    throw err;
  }
}

export function exportAll(onProgress) {
  return writeBackup(`techo-${today()}.json`, async () => ({
    notebooks: await getAllNotebooks(), notes: await getAllNotes(), attachmentIds: await getAttachmentIds(),
  }), onProgress);
}

// Selected notes (and their notebooks/attachments) in the backup format, so 読み込み restores them.
export function exportNotesJson(notes, notebooks, name, onProgress) {
  return writeBackup(`${safeName(name)}.json`, async () => ({ notebooks, notes, attachmentIds: attIds(notes) }), onProgress);
}

// A single self-contained HTML page (images inlined) that opens in any browser.
export async function exportNotesHtml(notes, titleOf, name) {
  const urls = new Map((await attachmentsFor(attIds(notes))).map(a => [a.id, a.data]));
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const body = notes.map((n, i) => {
    const art = document.createElement('article');
    art.innerHTML = `<h1 data-note-title>${esc(titleOf(n))}</h1>${
      sanitizeHtml(n.html).replace(/att:([a-z0-9]+)/g, (_, id) => urls.get(id) || '')}`;
    fillToc(art, { links: true, prefix: `n${i + 1}` });
    return art.outerHTML;
  }).join('<hr>');
  const html = `<!doctype html><html lang="${document.documentElement.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(name)}</title>
<style>body{font-family:-apple-system,'Hiragino Sans','Yu Gothic UI','Meiryo',sans-serif;max-width:820px;margin:0 auto;padding:24px;line-height:1.75}
img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px 10px}
pre{background:#f3f3f3;padding:12px;overflow-x:auto}ul[data-type=taskList]{list-style:none;padding-left:4px}
li[data-checked=true]{color:#888;text-decoration:line-through}li[data-type=taskItem]::before{content:'☐ '}li[data-checked=true]::before{content:'☑ '}
li[data-due]::after{content:' (' attr(data-due) ')';color:#888;font-size:.85em}iframe{width:100%;aspect-ratio:16/9;border:0}hr{margin:40px 0}
.toc{border:1px solid #ddd;border-radius:8px;padding:10px 14px;margin:12px 0}.toc-head{font-weight:600;margin-bottom:4px}.toc-item{display:block;padding:2px 0}.toc-item[data-depth='1']{padding-left:1.2em}.toc-item[data-depth='2']{padding-left:2.4em}.toc-empty{color:#888}
[data-indent="1"]{margin-left:2em}[data-indent="2"]{margin-left:4em}[data-indent="3"]{margin-left:6em}[data-indent="4"]{margin-left:8em}[data-indent="5"]{margin-left:10em}[data-indent="6"]{margin-left:12em}[data-indent="7"]{margin-left:14em}[data-indent="8"]{margin-left:16em}</style>
</head><body>${body}</body></html>`;
  download(new Blob([html], { type: 'text/html' }), `${safeName(name)}.html`);
}

// Backup file format: 1 = one JSON document (up to v0.14.1), 2 = one record per line.
// A file from a newer techo may hold things this version would misread or drop, so it is
// refused before anything is written, with a hint to update.
const BACKUP_VERSION = 2;
function checkVersion(version) {
  if (Number(version) > BACKUP_VERSION) throw new Error(tr('新しい版のtechoで書き出されたファイルです。techoを最新にしてから読み込んでください'));
}

// Calls onLine for each line of the file without ever holding the whole file as one string.
async function eachLine(file, onLine) {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let pieces = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    let from = 0, nl;
    while ((nl = value.indexOf('\n', from)) >= 0) {
      pieces.push(value.slice(from, nl));
      const line = pieces.join('');
      pieces = [];
      if ((await onLine(line)) === false) { reader.cancel(); return; }
      from = nl + 1;
    }
    if (from < value.length) pieces.push(value.slice(from));
  }
  if (pieces.length) await onLine(pieces.join(''));
}

// Newer updatedAt wins, so importing an old backup never overwrites fresh edits.
// onProgress(0..1) by bytes read.
export async function importFile(file, onProgress = () => {}) {
  const here = await getAllNotebooks();
  const existing = new Set(here.map(nb => nb.id));
  const byName = new Map(here.map(nb => [notebookKey(nb.name), nb.id]));
  // A backup from another device has its own ids: its "マイノート" (or any notebook whose
  // name is already here) joins the one on this device instead of becoming a second one.
  // Notebooks come first in the file, so the mapping is ready before the notes.
  const sameAs = new Map();
  let count = 0, read = 0, n = 0;
  const put = async (kind, d) => {
    if (kind === 'notebook') {
      if (existing.has(d.id)) return;
      if (byName.has(notebookKey(d.name))) { sameAs.set(d.id, byName.get(notebookKey(d.name))); return; }
      await putNotebook(d);
      existing.add(d.id);
      byName.set(notebookKey(d.name), d.id);
    } else if (kind === 'attachment') {
      const blob = await (await fetch(d.data)).blob();
      await putAttachment({ id: d.id, blob, type: d.type, name: d.name, createdAt: d.createdAt });
    } else if (kind === 'note') {
      const cur = await getNote(d.id);
      // A backup file may come from someone else: never trust its HTML.
      if (!cur || cur.updatedAt < d.updatedAt) {
        await putNote({ ...d, notebookId: sameAs.get(d.notebookId) ?? d.notebookId, html: sanitizeHtml(d.html) });
        count++;
      }
    }
  };

  let lineMode = null; // decided by the first line: v2 (one record per line) or older single JSON
  await eachLine(file, async line => {
    read += line.length + 1;
    if (lineMode === null) {
      const version = Number(line.match(/^\{"app":"techo","version":(\d+),/)?.[1] || 0);
      checkVersion(version);
      lineMode = version >= 2;
      return lineMode; // false: stop reading lines, it is one JSON document
    }
    const rec = line.replace(/,$/, '');
    if (!rec.startsWith('{"kind":')) return true; // the closing ]} line
    const { kind, data } = JSON.parse(rec);
    await put(kind, data);
    if (++n % 20 === 0) onProgress(Math.min(1, read / file.size));
    return true;
  });

  if (!lineMode) {
    // Backups from v0.14.1 and earlier: one JSON document.
    const data = JSON.parse(await file.text());
    if (data.app !== 'techo') throw new Error(tr('techoのバックアップではありません'));
    checkVersion(data.version);
    for (const nb of data.notebooks || []) await put('notebook', nb);
    for (const a of data.attachments || []) await put('attachment', a);
    for (const d of data.notes || []) await put('note', d);
  }
  onProgress(1);
  return count;
}
