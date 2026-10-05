// Until sync exists, data lives only in this browser. Export/import is the safety net.
import {
  getAllNotes, getAllAttachments, getAllNotebooks, getNote, putNote, putAttachment, putNotebook, getAttachment,
} from './db.js';
import { sanitizeHtml } from './sanitize.js';
import { fillToc } from './toc.js';

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
export const safeName = s => (s || '無題').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 80);
const attIds = notes => [...new Set(notes.flatMap(n => [...(n.html || '').matchAll(/att:([a-z0-9]+)/g)].map(m => m[1])))];

async function attachmentsFor(ids) {
  const out = [];
  for (const id of ids) {
    const a = await getAttachment(id);
    if (a) out.push({ id: a.id, type: a.type, name: a.name, createdAt: a.createdAt, data: await toDataUrl(a.blob) });
  }
  return out;
}

function writeJson(payload, filename) {
  const json = JSON.stringify({ app: 'techo', version: 1, exportedAt: Date.now(), ...payload });
  download(new Blob([json], { type: 'application/json' }), filename);
}

export async function exportAll() {
  const atts = await getAllAttachments();
  const attachments = await Promise.all(atts.map(async a => ({
    id: a.id, type: a.type, name: a.name, createdAt: a.createdAt, data: await toDataUrl(a.blob),
  })));
  writeJson({ notebooks: await getAllNotebooks(), notes: await getAllNotes(), attachments }, `techo-${today()}.json`);
}

// Selected notes (and their notebooks/attachments) in the backup format, so 読み込み restores them.
export async function exportNotesJson(notes, notebooks, name) {
  writeJson({ notebooks, notes, attachments: await attachmentsFor(attIds(notes)) }, `${safeName(name)}.json`);
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
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(name)}</title>
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

// Newer updatedAt wins, so importing an old backup never overwrites fresh edits.
export async function importFile(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'techo') throw new Error('techoのバックアップではありません');
  const existing = new Set((await getAllNotebooks()).map(nb => nb.id));
  for (const nb of data.notebooks || []) {
    if (!existing.has(nb.id)) await putNotebook(nb);
  }
  for (const a of data.attachments || []) {
    const blob = await (await fetch(a.data)).blob();
    await putAttachment({ id: a.id, blob, type: a.type, name: a.name, createdAt: a.createdAt });
  }
  let count = 0;
  for (const n of data.notes || []) {
    const cur = await getNote(n.id);
    // A backup file may come from someone else: never trust its HTML.
    if (!cur || cur.updatedAt < n.updatedAt) { await putNote({ ...n, html: sanitizeHtml(n.html) }); count++; }
  }
  return count;
}
