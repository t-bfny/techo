import { registerSW } from 'virtual:pwa-register';
import { Editor } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Youtube, { isValidYoutubeUrl } from '@tiptap/extension-youtube';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import { TaskList } from '@tiptap/extension-list';
import Placeholder from '@tiptap/extension-placeholder';

import {
  uid, getAllAttachments, getAllNotes, putNote, deleteNote, getAllNotebooks, putNotebook, deleteNotebook, requestPersist,
  deleteAttachment,
} from './db.js';
import { resolveHtml, unresolveHtml, storeImage, storeBlob, attachmentUrl, attachmentLink } from './attachments.js';
import { DueTaskItem, allTasks, withTaskChecked, groupOpenTasks, fmtDue, isoDay } from './tasks.js';
import { exportAll, importFile, exportNotesJson, exportNotesHtml } from './backup.js';
import { importEnex, PLACEHOLDER, htmlToText } from './enex.js';
import { JaAutolink } from './autolink.js';
import { sanitizeHtml } from './sanitize.js';
import { setupToolbar, showPopover, showMenuAt, menuSep, menuItem } from './toolbar.js';

const $ = id => document.getElementById(id);

// Outline pushpin shown next to notes pinned to the top of their notebook.
const PIN_ICON = '<svg class="pin" viewBox="0 0 16 16" aria-label="ピン留め"><path d="M10.5 1.5l4 4-2 1-2.5 2.5.5 3.5-1.5 1.5-3-3-3.5 3.5-.5-.5L5.5 10.5l-3-3L4 6l3.5.5L10 4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';

let notes = [];          // in-memory copy for list + search (1000 notes fits easily); excludes trash
let trashed = [];        // notes with deletedAt, kept for TRASH_DAYS
let notebooks = [];
let filter = { type: 'all' };  // all | shortcuts | notebook(id)
let view = 'home';       // home | notebooks | list | note
let tabs = [];           // note ids open as tabs, in order
let currentId = null;
let saveTimer = null;
let loading = false;

// ---------- small storage helpers (per-device UI state only) ----------

const TABS_KEY = 'techo.tabs';
const FILTER_KEY = 'techo.filter';
const FONT_KEY = 'techo.stageFont';

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}

// ---------- editor ----------

const editor = new Editor({
  element: $('editor'),
  extensions: [
    StarterKit.configure({
      link: {
        autolink: true,
        openOnClick: true,
        defaultProtocol: 'https',
        // Attachment links (imported PDFs etc.) are object URLs while the note is open.
        isAllowedUri: (url, ctx) => url.startsWith('blob:') || ctx.defaultValidate(url),
      },
    }),
    Image,
    Youtube.configure({ nocookie: true, width: 640, height: 360, addPasteHandler: false }),
    Table.configure({ resizable: false }),
    TableRow, TableHeader, TableCell,
    TextStyle, Color,
    Highlight.configure({ multicolor: true }),
    TaskList, DueTaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: '本文' }),
    JaAutolink,
  ],
  editorProps: {
    handlePaste: (_view, event) =>
      insertImageFiles(event.clipboardData?.files) || insertYoutubeFromText(event.clipboardData?.getData('text/plain')),
    handleDrop: (_view, event) => insertImageFiles(event.dataTransfer?.files),
  },
  onUpdate: () => { if (!loading) scheduleSave(); },
});

// A freshly inserted image/video stays node-selected, so the next insert would replace it.
// Drop the cursor into a new paragraph right after it instead.
function cursorAfterBlock() {
  const { to } = editor.state.selection;
  editor.chain().insertContentAt(to, { type: 'paragraph' }).setTextSelection(to + 1).focus().run();
}

function insertImageFiles(fileList) {
  const files = [...(fileList || [])].filter(f => f.type.startsWith('image/'));
  if (!files.length) return false;
  (async () => {
    for (const f of files) {
      const src = await storeImage(f);
      editor.chain().focus().setImage({ src }).run();
      cursorAfterBlock();
    }
  })();
  return true;
}

// Pasting a bare YouTube URL (including youtu.be share links) embeds the player.
function insertYoutubeFromText(text) {
  const src = text?.trim();
  if (!src || /\s/.test(src) || !isValidYoutubeUrl(src)) return false;
  if (!editor.chain().focus().setYoutubeVideo({ src }).run()) return false;
  cursorAfterBlock();
  return true;
}

setupToolbar(editor, {
  image: () => $('imageInput').click(),
  file: () => $('fileInput').click(),
  youtube: () => {
    const src = prompt('YouTubeのURL');
    if (src && !insertYoutubeFromText(src)) alert('YouTubeのURLとして読めませんでした');
  },
  link: () => {
    const prev = editor.getAttributes('link').href || '';
    const href = prompt('リンク先のURL(空にすると解除)', prev);
    if (href === null) return;
    const chain = editor.chain().focus().extendMarkRange('link');
    if (!href.trim()) { chain.unsetLink().run(); return; }
    if (editor.state.selection.empty && !prev) {
      chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
    } else {
      chain.setLink({ href }).run();
    }
  },
});

// ---------- notebooks ----------

const byCreated = (a, b) => a.createdAt - b.createdAt;
const defaultNotebook = () => [...notebooks].sort(byCreated)[0];
const notebookName = id => notebooks.find(nb => nb.id === id)?.name || '';

// Every note must belong to a notebook; older data and imports may not.
async function ensureNotebooks() {
  if (!notebooks.length) {
    const nb = { id: uid(), name: 'マイノート', createdAt: Date.now() };
    await putNotebook(nb);
    notebooks.push(nb);
  }
  const ids = new Set(notebooks.map(nb => nb.id));
  for (const n of notes) {
    if (!ids.has(n.notebookId)) { n.notebookId = defaultNotebook().id; await putNote(n); }
  }
}

// ---------- trash ----------

const TRASH_DAYS = 30;
const DAY = 86400000;
const ATT_RE = /att:([a-z0-9]+)/g;

// Templates live in the notes store with template: true, kept out of every list but their own.
let templates = [];
const findNote = id => notes.find(n => n.id === id) || templates.find(n => n.id === id);

async function loadNotes() {
  const all = await getAllNotes();
  notes = all.filter(n => !n.deletedAt && !n.template);
  templates = all.filter(n => !n.deletedAt && n.template);
  trashed = all.filter(n => n.deletedAt);
}

// Deletes for good, along with attachments that no remaining note (live or trashed) uses.
async function purge(list) {
  if (!list.length) return;
  const gone = new Set(list.map(n => n.id));
  const keep = new Set();
  for (const n of [...notes, ...trashed, ...templates]) {
    if (!gone.has(n.id)) for (const m of (n.html || '').matchAll(ATT_RE)) keep.add(m[1]);
  }
  for (const n of list) {
    for (const m of (n.html || '').matchAll(ATT_RE)) if (!keep.has(m[1])) await deleteAttachment(m[1]);
    await deleteNote(n.id);
  }
  trashed = trashed.filter(n => !gone.has(n.id));
  templates = templates.filter(n => !gone.has(n.id));
}

async function trashNotes(ids, { record = true } = {}) {
  const set = new Set(ids);
  if (set.has(currentId) && saveTimer) await saveNow();
  const moved = notes.filter(n => set.has(n.id));
  if (!moved.length) return;
  const now = Date.now();
  for (const n of moved) { n.deletedAt = now; await putNote(n); }
  notes = notes.filter(n => !set.has(n.id));
  trashed.push(...moved);
  for (const id of set) selected.delete(id);
  const i = tabs.indexOf(currentId);
  const wasOpen = set.has(currentId);
  tabs = tabs.filter(t => !set.has(t));
  store(TABS_KEY, tabs);
  if (record) {
    const label = moved.length === 1 ? `「${displayTitle(moved[0])}」` : `${moved.length}件`;
    pushUndo(`${label}をゴミ箱に移動しました`, () => restoreNotes(moved.map(n => n.id), { record: false }));
  }
  if (wasOpen) {
    currentId = null;
    const next = tabs[Math.min(Math.max(i, 0), tabs.length - 1)];
    await go(next ? `n/${next}` : 'list');
  } else {
    renderAll();
  }
}

async function restoreNotes(ids, { record = true } = {}) {
  const set = new Set(ids);
  const back = trashed.filter(n => set.has(n.id));
  const nbIds = new Set(notebooks.map(nb => nb.id));
  for (const n of back) {
    delete n.deletedAt;
    if (!nbIds.has(n.notebookId)) n.notebookId = defaultNotebook().id; // its notebook was deleted meanwhile
    await putNote(n);
  }
  trashed = trashed.filter(n => !set.has(n.id));
  notes.push(...back);
  if (record) pushUndo(`${back.length}件を復元しました`, () => trashNotes(back.map(n => n.id), { record: false }));
  renderAll();
}

function renderTrashPage() {
  const list = [...trashed].sort((a, b) => b.deletedAt - a.deletedAt);
  $('trashCount').textContent = `${list.length}件`;
  $('emptyTrashBtn').disabled = !list.length;
  $('trashRows').replaceChildren(...(list.length ? [Object.assign(document.createElement('div'), { className: 'rows' })] : [
    Object.assign(document.createElement('p'), { className: 'side-empty', textContent: 'ゴミ箱は空です' }),
  ]));
  const box = $('trashRows').querySelector('.rows');
  if (!box) return;
  box.append(...list.map(n => {
    const left = Math.max(1, Math.ceil((n.deletedAt + TRASH_DAYS * DAY - Date.now()) / DAY));
    const row = document.createElement('div');
    row.className = 'trash-row';
    row.innerHTML = '<div class="trash-main"><span class="task-t ellipsis"></span><span class="dim ellipsis"></span></div>'
      + '<button class="mini">復元</button><button class="mini danger">完全に削除</button>';
    row.querySelector('.task-t').textContent = displayTitle(n);
    row.querySelector('.dim').textContent = `${notebookName(n.notebookId) || '(削除したノートブック)'} · ${fmtDate(n.deletedAt)}に削除 · あと${left}日`;
    const [restore, del] = row.querySelectorAll('button');
    restore.dataset.restore = n.id;
    del.dataset.purge = n.id;
    return row;
  }));
}

// ---------- undo (app-level: delete / move / shortcut) ----------

const undoStack = [];
let toastTimer = null;

function showToast(message, undoable) {
  $('toastMsg').textContent = message;
  $('toastUndo').hidden = !undoable;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000);
}

function pushUndo(message, undo) {
  undoStack.push({ message, undo });
  if (undoStack.length > 50) undoStack.shift();
  showToast(message, true);
}

async function undoLast() {
  const action = undoStack.pop();
  if (!action) return;
  await action.undo();
  showToast('元に戻しました', false);
}

// ---------- selection (Ctrl/Shift+click in the note list) ----------

const selected = new Set();
let anchorId = null;
let shownIds = [];     // list order as last rendered, for Shift ranges

function clearSelection() {
  if (!selected.size) return;
  selected.clear();
  renderList();
}

async function moveNotes(ids, notebookId) {
  const moved = notes.filter(n => ids.includes(n.id) && n.notebookId !== notebookId);
  if (!moved.length) return;
  const before = moved.map(n => [n, n.notebookId]);
  for (const n of moved) { n.notebookId = notebookId; await putNote(n); }
  pushUndo(`${moved.length}件を「${notebookName(notebookId)}」へ移動しました`, async () => {
    for (const [n, prev] of before) { n.notebookId = prev; await putNote(n); }
    renderAll();
  });
  renderAll();
}

// Pin to the top of its notebook (Evernote's "pin"), separate from shortcuts (note.pinned).
async function setPinTop(ids, value) {
  const changed = notes.filter(n => ids.includes(n.id) && !!n.pinTop !== value);
  if (!changed.length) return;
  for (const n of changed) { n.pinTop = value; await putNote(n); }
  pushUndo(`${changed.length}件を${value ? 'ピン留め' : 'ピン留めから外'}しました`, async () => {
    for (const n of changed) { n.pinTop = !value; await putNote(n); }
    renderAll();
  });
  renderAll();
}

async function setPinned(ids, pinned) {
  const changed = notes.filter(n => ids.includes(n.id) && !!n.pinned !== pinned);
  if (!changed.length) return;
  for (const n of changed) { n.pinned = pinned; await putNote(n); }
  pushUndo(`${changed.length}件を${pinned ? 'ショートカットに追加' : 'ショートカットから外'}しました`, async () => {
    for (const n of changed) { n.pinned = !pinned; await putNote(n); }
    renderAll();
  });
  renderAll();
}

// ---------- save ----------

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}

async function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const note = findNote(currentId);
  if (!note) return;
  note.title = $('titleInput').value.trim();
  note.html = unresolveHtml(editor.getHTML());
  note.text = editor.getText();
  note.updatedAt = Date.now();
  await putNote(note);
  renderAll();
}

const isBlank = n => !n.title && !n.text?.trim() && !/<(img|iframe|table)/.test(n.html || '');

// Leaving a note that was created but never written should not leave an empty entry behind.
async function leaveCurrent() {
  if (!currentId) return;
  if (saveTimer) await saveNow();
  const note = findNote(currentId);
  if (note && isBlank(note)) {
    await deleteNote(note.id);
    notes = notes.filter(n => n.id !== note.id);
    templates = templates.filter(n => n.id !== note.id);
    tabs = tabs.filter(t => t !== note.id);
    store(TABS_KEY, tabs);
  }
  currentId = null;
}

// ---------- rendering ----------

const baseTitle = n => n.title || (n.text || '').split('\n').map(s => s.trim()).find(Boolean) || '無題';

// ---------- numbering (per notebook, opt-in) ----------
// Notes in a numbered notebook are counted in creation order. A title that already carries a
// number ("19 …", "tech-259 …") is left untouched and sets the count, so the auto numbers
// continue from it ("tech-260"). Auto numbers are computed, never written into the title,
// which is why deleting or moving a note makes the later ones shift.
const OWN_NUMBER = /^\s*([A-Za-z][A-Za-z0-9_]*-)?(\d+)(?=[\s　.:：、)\]-]|$)/;
let numbers = new Map(); // noteId -> { n, label } (label only for auto-numbered notes)

function computeNumbers() {
  numbers = new Map();
  const byNb = new Map();
  for (const n of notes) {
    if (!byNb.has(n.notebookId)) byNb.set(n.notebookId, []);
    byNb.get(n.notebookId).push(n);
  }
  for (const nb of notebooks) {
    if (!nb.numbered) continue;
    const list = (byNb.get(nb.id) || []).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    let count = 0, prefix = '';
    for (const n of list) {
      const own = (n.title || '').match(OWN_NUMBER);
      if (own) { count = Number(own[2]); prefix = own[1] || ''; numbers.set(n.id, { n: count }); }
      else { count++; numbers.set(n.id, { n: count, label: `${prefix}${count}` }); }
    }
  }
}

const numberLabel = n => numbers.get(n.id)?.label || '';
const numberValue = n => numbers.get(n.id)?.n ?? Number((n.title || '').match(OWN_NUMBER)?.[2] ?? Infinity);
const displayTitle = n => (numberLabel(n) ? `${numberLabel(n)} ${baseTitle(n)}` : baseTitle(n));

// ---------- sort ----------

const SORT_KEY = 'techo.sort';
let sort = { key: 'updated', dir: 'desc' };

function sortNotes(list) {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const cmp = {
    updated: (a, b) => a.updatedAt - b.updatedAt,
    created: (a, b) => a.createdAt - b.createdAt,
    // Across notebooks, numbers only make sense within each one: group by notebook first.
    number: (a, b) => (filter.type === 'notebook' ? 0 : sign * byName(notebookName(a.notebookId), notebookName(b.notebookId)))
      || (numberValue(a) - numberValue(b)) || (a.createdAt - b.createdAt),
  }[sort.key];
  return list.sort((a, b) => sign * cmp(a, b));
}

function matches(note, terms) {
  if (!terms.length) return true;
  const hay = `${numberLabel(note)} ${note.title}\n${note.text}`.toLowerCase();
  return terms.every(t => hay.includes(t));
}

function inFilter(n) {
  if (filter.type === 'shortcuts') return n.pinned;
  if (filter.type === 'notebook') return n.notebookId === filter.id;
  return true;
}

function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('ja-JP', d.getFullYear() === now.getFullYear()
    ? { month: 'numeric', day: 'numeric' }
    : { year: 'numeric', month: 'numeric', day: 'numeric' });
}

function sideItem(label, count, active, dataset) {
  const b = document.createElement('button');
  b.className = 'side-item' + (active ? ' active' : '');
  Object.assign(b.dataset, dataset);
  b.innerHTML = '<span class="ellipsis"></span><span class="n"></span>';
  b.firstChild.textContent = label;
  b.lastChild.textContent = count ?? '';
  return b;
}

const byName = (a, b) => a.localeCompare(b, 'ja');
const recentNotes = n => [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, n);

function notebookCounts() {
  const counts = {};
  for (const n of notes) counts[n.notebookId] = (counts[n.notebookId] || 0) + 1;
  return counts;
}

// Shortcuts hold both notebooks (shown with their note count, like Evernote) and notes.
function shortcutItems(counts, isActive) {
  const nbs = notebooks.filter(nb => nb.pinned).sort((a, b) => byName(a.name, b.name))
    .map(nb => sideItem(nb.name, counts[nb.id] || 0, isActive('notebook', nb.id), { notebook: nb.id }));
  const ns = notes.filter(n => n.pinned).sort((a, b) => byName(displayTitle(a), displayTitle(b)))
    .map(n => sideItem(displayTitle(n), null, isActive('note', n.id), { note: n.id }));
  const items = [...nbs, ...ns];
  return items.length ? items
    : [Object.assign(document.createElement('p'), { className: 'side-empty', textContent: 'ノートやノートブックの「ショートカット」で追加' })];
}

function renderSidebar() {
  const counts = notebookCounts();
  const onList = view === 'list' || view === 'note';
  const isActive = (kind, id) => kind === 'note' ? id === currentId
    : onList && filter.type === 'notebook' && filter.id === id;

  $('countAll').textContent = notes.length;
  $('countTasks').textContent = allTasks(notes).filter(t => !t.checked).length || '';
  $('countFiles').textContent = fileRefs().size || '';
  $('countTrash').textContent = trashed.length || '';
  $('countTemplates').textContent = templates.length || '';
  for (const g of ['tasks', 'files', 'trash', 'templates']) document.querySelector(`.side-item[data-go="${g}"]`).classList.toggle('active', view === g);
  document.querySelector('.home-btn').classList.toggle('active', view === 'home');
  document.querySelector('.side-item[data-filter="all"]').classList.toggle('active', onList && filter.type === 'all');
  document.querySelector('.side-head [data-go="notebooks"]').classList.toggle('active', view === 'notebooks');

  $('shortcutList').replaceChildren(...shortcutItems(counts, isActive));
  $('recentList').replaceChildren(...recentNotes(5).map(n => sideItem(displayTitle(n), null, n.id === currentId, { note: n.id })));
  $('notebookList').replaceChildren(...[...notebooks].sort((a, b) => byName(a.name, b.name)).map(nb =>
    sideItem(nb.name, counts[nb.id] || 0, isActive('notebook', nb.id), { notebook: nb.id })));
}

function snippetOf(n) {
  const lines = (n.text || '').split('\n').map(s => s.trim()).filter(Boolean);
  return (n.title ? lines : lines.slice(1)).join(' ');
}

function renderHome() {
  $('homeDate').textContent = new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });
  const open = allTasks(notes).filter(t => !t.checked).length;
  $('homeStats').textContent = `${notes.length} notes · ${notebooks.length} notebooks · ${open} tasks`;
  $('homeRecent').replaceChildren(...recentNotes(8).map(n => {
    const card = document.createElement('button');
    card.className = 'card';
    card.dataset.note = n.id;
    card.innerHTML = '<span class="card-t"></span><span class="card-s"></span><span class="card-d"></span>';
    card.children[0].textContent = displayTitle(n);
    card.children[1].textContent = snippetOf(n).slice(0, 120);
    card.children[2].textContent = `${fmtDate(n.updatedAt)} · ${notebookName(n.notebookId)}`;
    return card;
  }));
  if (!notes.length) $('homeRecent').append(Object.assign(document.createElement('p'), { className: 'side-empty', textContent: 'まだノートがありません' }));
  const counts = notebookCounts();
  $('homeShortcuts').replaceChildren(...shortcutItems(counts, () => false));
  const today = isoDay();
  const due = allTasks(notes).filter(t => !t.checked && t.due && t.due <= today).sort((a, b) => a.due.localeCompare(b.due));
  $('homeTasksWrap').hidden = !due.length;
  $('homeTasks').replaceChildren(...due.slice(0, 8).map(taskRow));
  $('homeNotebooks').replaceChildren(...[...notebooks].sort((a, b) => byName(a.name, b.name)).map(nb =>
    sideItem(nb.name, counts[nb.id] || 0, false, { notebook: nb.id })));
}

const expanded = new Set(); // notebook ids opened on the notebooks page

function renderNotebooksPage() {
  const counts = notebookCounts();
  const byNb = {};
  for (const n of notes) (byNb[n.notebookId] ||= []).push(n);
  $('notebookCount').textContent = `${notebooks.length}冊`;

  const rows = [];
  for (const nb of [...notebooks].sort((a, b) => byName(a.name, b.name))) {
    const inside = (byNb[nb.id] || []).sort((a, b) => b.updatedAt - a.updatedAt);
    const open = expanded.has(nb.id);
    const row = document.createElement('div');
    row.className = 'nb-row';
    row.innerHTML = '<span class="nb-name"><button class="caret"></button><button class="link-plain ellipsis"></button></span><span class="dim"></span><span class="dim"></span>';
    const [caret, name] = row.firstChild.children;
    caret.textContent = open ? '▾' : '▸';
    caret.dataset.toggle = nb.id;
    caret.disabled = !inside.length;
    name.textContent = nb.name;
    name.dataset.notebook = nb.id;
    row.children[1].textContent = counts[nb.id] || 0;
    row.children[2].textContent = fmtDate(inside[0]?.updatedAt || nb.createdAt);
    rows.push(row);
    if (!open) continue;
    for (const n of inside) {
      const r = document.createElement('div');
      r.className = 'nb-row child';
      r.innerHTML = '<span class="nb-name"><button class="link-plain ellipsis"></button></span><span></span><span class="dim"></span>';
      const b = r.querySelector('button');
      b.textContent = displayTitle(n);
      b.dataset.note = n.id;
      r.children[2].textContent = fmtDate(n.updatedAt);
      rows.push(r);
    }
  }
  $('nbRows').replaceChildren(...rows);
}

// ---------- tasks page ----------

let taskMode = 'open';

function taskRow(t) {
  const row = document.createElement('div');
  row.className = 'task-row' + (t.checked ? ' done' : '');
  row.innerHTML = '<input type="checkbox"><span class="task-t"></span><span class="task-due"></span><button class="link-plain task-note ellipsis"></button>';
  const [box, text, due, note] = row.children;
  box.checked = t.checked;
  box.dataset.task = `${t.noteId}:${t.index}`;
  text.textContent = t.text;
  due.textContent = fmtDue(t.due);
  if (t.due && !t.checked && t.due < isoDay()) due.classList.add('overdue');
  const n = notes.find(x => x.id === t.noteId);
  note.textContent = n ? displayTitle(n) : '';
  note.dataset.note = t.noteId;
  return row;
}

function renderTasksPage() {
  const tasks = allTasks(notes);
  const open = tasks.filter(t => !t.checked);
  $('taskCount').textContent = `未完了 ${open.length}件`;
  for (const b of document.querySelectorAll('[data-taskmode]')) b.classList.toggle('on', b.dataset.taskmode === taskMode);
  const groups = taskMode === 'open'
    ? groupOpenTasks(open)
    : [['完了', tasks.filter(t => t.checked)]].filter(([, l]) => l.length);
  const out = groups.map(([label, list]) => {
    const sec = document.createElement('section');
    sec.innerHTML = '<h2 class="page-h"></h2><div class="rows"></div>';
    sec.firstChild.textContent = `${label} ${list.length}`;
    sec.lastChild.append(...list.map(taskRow));
    return sec;
  });
  if (!out.length) {
    out.push(Object.assign(document.createElement('p'), {
      className: 'side-empty',
      textContent: taskMode === 'open' ? 'ノートにチェックリストを書くと、ここにまとめて出ます' : '完了したタスクはまだありません',
    }));
  }
  $('taskGroups').replaceChildren(...out);
}

async function toggleTask(key, checked) {
  const [noteId, index] = key.split(':');
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  note.html = withTaskChecked(note, Number(index), checked);
  note.updatedAt = Date.now();
  await putNote(note);
  renderAll();
}

// ---------- files page ----------

let fileMode = 'all';

// attachment id -> the note that uses it (attachments of deleted notes are left out)
function fileRefs() {
  const refs = new Map();
  for (const n of notes) {
    for (const m of (n.html || '').matchAll(/att:([a-z0-9]+)/g)) if (!refs.has(m[1])) refs.set(m[1], n.id);
  }
  return refs;
}

async function renderFilesPage() {
  const refs = fileRefs();
  const atts = (await getAllAttachments()).filter(a => refs.has(a.id));
  for (const b of document.querySelectorAll('[data-filemode]')) b.classList.toggle('on', b.dataset.filemode === fileMode);
  const isImg = a => (a.type || '').startsWith('image/');
  const shown = atts.filter(a => fileMode === 'all' || (fileMode === 'image') === isImg(a))
    .sort((a, b) => b.createdAt - a.createdAt);
  $('fileCount').textContent = `${shown.length}件`;
  const tiles = await Promise.all(shown.map(async a => {
    const url = await attachmentUrl(a.id);
    const note = notes.find(n => n.id === refs.get(a.id));
    const tile = document.createElement('div');
    tile.className = 'file-tile';
    tile.innerHTML = '<button class="file-thumb"></button><div class="file-meta"><a class="file-name ellipsis" target="_blank" rel="noopener"></a><button class="link-plain file-note ellipsis"></button></div>';
    const thumb = tile.querySelector('.file-thumb');
    thumb.dataset.note = note.id;
    if (isImg(a)) {
      const img = document.createElement('img');
      img.src = url;
      img.loading = 'lazy';
      img.alt = '';
      thumb.append(img);
    } else {
      thumb.textContent = (a.name?.split('.').pop() || a.type.split('/').pop() || 'FILE').toUpperCase().slice(0, 5);
    }
    const link = tile.querySelector('.file-name');
    link.href = await attachmentLink(a.id);
    link.textContent = a.name || (isImg(a) ? '画像' : 'ファイル');
    if (a.name) link.download = a.name;
    const nb = tile.querySelector('.file-note');
    nb.textContent = displayTitle(note);
    nb.dataset.note = note.id;
    return tile;
  }));
  if (view !== 'files') return; // navigated away while loading
  $('fileGrid').replaceChildren(...(tiles.length ? tiles
    : [Object.assign(document.createElement('p'), { className: 'side-empty', textContent: 'ノートに画像やファイルを入れると、ここに並びます' })]));
}

function renderBulkBar() {
  $('bulkBar').hidden = !selected.size;
  if (!selected.size) return;
  $('bulkCount').textContent = `${selected.size}件を選択中`;
  $('bulkMove').replaceChildren(
    Object.assign(document.createElement('option'), { value: '', textContent: 'ノートブックへ移動' }),
    ...[...notebooks].sort((a, b) => byName(a.name, b.name)).map(nb => Object.assign(document.createElement('option'), { value: nb.id, textContent: nb.name })),
  );
  const allPinned = [...selected].every(id => notes.find(n => n.id === id)?.pinned);
  $('bulkPin').textContent = allPinned ? 'ショートカットから外す' : 'ショートカットに追加';
}

function renderList() {
  const terms = $('search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const scoped = notes.filter(inFilter);
  const sorted = sortNotes(scoped.filter(n => matches(n, terms)));
  // Inside a notebook, pinned notes stay on top whatever the sort; the rest follow in order.
  const shown = filter.type === 'notebook' ? [...sorted.filter(n => n.pinTop), ...sorted.filter(n => !n.pinTop)] : sorted;
  $('sortSelect').value = sort.key;
  $('sortDir').textContent = sort.dir === 'asc' ? '↑' : '↓';
  $('sortDir').title = sort.dir === 'asc' ? '昇順(古い・小さい順)' : '降順(新しい・大きい順)';

  $('filterName').textContent = filter.type === 'notebook' ? notebookName(filter.id)
    : filter.type === 'shortcuts' ? 'ショートカット' : 'すべてのノート';
  $('count').textContent = terms.length ? `${shown.length} / ${scoped.length}件` : `${scoped.length}件`;
  $('notebookTools').hidden = filter.type !== 'notebook';
  $('numberedMark').hidden = !notebooks.find(nb => nb.id === filter.id)?.numbered;

  const showNotebook = filter.type !== 'notebook';
  shownIds = shown.map(n => n.id);
  for (const id of [...selected]) if (!notes.some(n => n.id === id)) selected.delete(id);
  renderBulkBar();
  $('noteList').replaceChildren(...shown.map(n => {
    const li = document.createElement('li');
    li.dataset.id = n.id;
    if (n.id === currentId) li.classList.add('active');
    if (selected.has(n.id)) li.classList.add('selected');
    const lines = (n.text || '').split('\n').map(s => s.trim()).filter(Boolean);
    const snippet = (n.title ? lines : lines.slice(1)).join(' ').slice(0, 80);
    li.innerHTML = `<div class="row"><span class="t"></span>${n.pinTop ? PIN_ICON : ''}<span class="d"></span></div><div class="s"></div><div class="nb"></div>`;
    li.querySelector('.t').textContent = displayTitle(n);
    li.querySelector('.d').textContent = fmtDate(n.updatedAt);
    li.querySelector('.s').textContent = snippet;
    li.querySelector('.nb').textContent = showNotebook ? notebookName(n.notebookId) : '';
    return li;
  }));
}

function renderTabs() {
  $('tabList').replaceChildren(...tabs.map(id => {
    const n = findNote(id);
    const tab = document.createElement('div');
    tab.className = 'tab' + (id === currentId ? ' active' : '');
    tab.dataset.id = id;
    tab.innerHTML = '<span class="ellipsis"></span><button class="tab-close" title="閉じる">×</button>';
    tab.firstChild.textContent = n ? (n.template ? `テンプレート: ${displayTitle(n)}` : displayTitle(n)) : '';
    return tab;
  }));
  $('tabList').querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderCrumbs() {
  const note = findNote(currentId);
  if (!note) return;
  $('templateMark').hidden = !note.template;
  $('pinBtn').hidden = !!note.template;
  const sel = $('nbSelect');
  sel.replaceChildren(...[...notebooks].sort((a, b) => a.name.localeCompare(b.name, 'ja')).map(nb =>
    Object.assign(document.createElement('option'), { value: nb.id, textContent: nb.name })));
  sel.value = note.notebookId;
  $('crumbTitle').textContent = displayTitle(note);
  $('noteNumber').textContent = numberLabel(note);
  $('pinBtn').classList.toggle('on', !!note.pinned);
}

function renderAll() {
  computeNumbers();
  renderSidebar();
  if (view === 'home') renderHome();
  if (view === 'notebooks') renderNotebooksPage();
  if (view === 'tasks') renderTasksPage();
  if (view === 'files') renderFilesPage();
  if (view === 'trash') renderTrashPage();
  if (view === 'templates') renderTemplatesPage();
  renderList();
  renderTabs();
  renderCrumbs();
}

// ---------- open / tabs / route ----------

// Opening a note replaces the active tab, like Evernote; newTab keeps the current one open.
function openNote(id, { newTab = false } = {}) {
  if (!tabs.includes(id)) {
    const i = tabs.indexOf(currentId);
    if (newTab || i < 0) tabs.splice(i < 0 ? tabs.length : i + 1, 0, id);
    else tabs[i] = id;
    store(TABS_KEY, tabs);
  }
  return go(`n/${id}`);
}

async function closeTab(id) {
  const i = tabs.indexOf(id);
  if (i < 0) return;
  if (id === currentId) {
    await leaveCurrent();
    tabs = tabs.filter(t => t !== id);
    store(TABS_KEY, tabs);
    const next = tabs[Math.min(i, tabs.length - 1)];
    go(next ? `n/${next}` : 'list');
  } else {
    tabs = tabs.filter(t => t !== id);
    store(TABS_KEY, tabs);
    renderTabs();
  }
}

async function showNote(id) {
  const note = findNote(id);
  if (!note) { go(''); return; }
  if (!tabs.includes(id)) { tabs.push(id); store(TABS_KEY, tabs); }
  currentId = id;
  loading = true;
  $('titleInput').value = note.title || '';
  editor.commands.setContent(await resolveHtml(note.html || ''), { emitUpdate: false });
  // Fresh state = fresh undo history, so undo can never bring back the previous note.
  const { doc, plugins } = editor.state;
  editor.view.updateState(EditorState.create({ doc, plugins }));
  loading = false;
  $('emptyState').hidden = true;
  $('editorWrap').hidden = false;
  document.body.classList.add('show-editor');
  renderAll();
}

// Routes run one at a time, in order: opening a note is async, and a second navigation
// (or typing into the new note) must not interleave with the first.
let routing = Promise.resolve();
let routedHash = null;

function route() {
  if (location.hash === routedHash) return routing;
  routedHash = location.hash;
  routing = routing.then(doRoute);
  return routing;
}

function go(hash) {
  location.hash = hash;
  return route();
}

// #home (default) | #notebooks | #list | #n/ID | #n/ID/stage
async function doRoute() {
  const hash = location.hash;
  const [, id, mode] = hash.match(/^#n\/([a-z0-9]+)(?:\/(stage))?$/) || [];
  view = id ? 'note' : ({ '#notebooks': 'notebooks', '#list': 'list', '#tasks': 'tasks', '#files': 'files', '#trash': 'trash', '#templates': 'templates' })[hash] || 'home';
  document.body.dataset.view = view;
  if (id !== currentId) {
    await leaveCurrent();
    if (id) await showNote(id);
  }
  if (!id) {
    $('editorWrap').hidden = true;
    $('emptyState').hidden = false;
    document.body.classList.remove('show-editor');
  }
  renderAll();
  if (mode === 'stage') enterStage(); else exitStage();
}

async function newNote({ newTab = true } = {}) {
  const now = Date.now();
  const notebookId = filter.type === 'notebook' ? filter.id : defaultNotebook().id;
  const note = { id: uid(), title: '', html: '', text: '', notebookId, pinned: false, createdAt: now, updatedAt: now };
  await putNote(note);
  notes.push(note);
  closeDrawer();
  await openNote(note.id, { newTab });
  $('titleInput').focus();
}

// ---------- templates ----------
// A template is a copy of a note. Saving one turns dates in its title ("Task - @2026-10-01")
// into {{date}}; using it fills in today's date, unchecks every task and drops due dates,
// so the daily note starts clean. Nothing is created automatically.

const DATE_RE = /\d{4}-\d{2}-\d{2}/g;
const fillDate = s => (s || '').replaceAll('{{date}}', isoDay());
const templateLabel = t => (t.title || '無題').replaceAll('{{date}}', '〈日付〉');

// Right-click → コピーを作成: same notebook, "… のコピー", attachments shared with the original.
async function duplicateNotes(list) {
  if (saveTimer) await saveNow();
  const now = Date.now();
  const copies = list.map((n, i) => ({
    ...n, id: uid(), title: `${baseTitle(n)} のコピー`, pinned: false, pinTop: false, sourceKey: undefined,
    createdAt: now + i, updatedAt: now + i,
  }));
  for (const c of copies) { delete c.sourceKey; await putNote(c); }
  notes.push(...copies);
  pushUndo(`${copies.length === 1 ? `「${copies[0].title}」` : `${copies.length}件のコピー`}を作成しました`, async () => {
    const ids = new Set(copies.map(c => c.id));
    for (const c of copies) await deleteNote(c.id);
    notes = notes.filter(n => !ids.has(n.id));
    tabs = tabs.filter(t => !ids.has(t));
    store(TABS_KEY, tabs);
    if (ids.has(currentId)) { currentId = null; await go('list'); } else renderAll();
  });
  if (copies.length === 1) await openNote(copies[0].id); else renderAll();
}

async function saveAsTemplate(note) {
  if (note.id === currentId && saveTimer) await saveNow();
  const now = Date.now();
  const t = {
    id: uid(), template: true, title: (note.title || '').replace(DATE_RE, '{{date}}'),
    html: note.html || '', text: note.text || '', notebookId: note.notebookId, createdAt: now, updatedAt: now,
  };
  await putNote(t);
  templates.push(t);
  pushUndo(`テンプレート「${templateLabel(t)}」を保存しました`, async () => {
    await deleteNote(t.id); // its attachments stay: the original note still uses them
    templates = templates.filter(x => x.id !== t.id);
    renderAll();
  });
  renderAll();
}

function freshFromTemplate(html) {
  const doc = new DOMParser().parseFromString(fillDate(html), 'text/html');
  for (const li of doc.querySelectorAll('li[data-checked]')) {
    li.setAttribute('data-checked', 'false');
    for (const a of ['data-due', 'data-due-label', 'data-overdue']) li.removeAttribute(a);
  }
  for (const box of doc.querySelectorAll('li input[type="checkbox"]')) box.removeAttribute('checked');
  return doc.body.innerHTML;
}

async function newFromTemplate(t, { newTab = true } = {}) {
  const now = Date.now();
  const html = freshFromTemplate(t.html || '');
  const notebookId = notebooks.some(nb => nb.id === t.notebookId) ? t.notebookId
    : filter.type === 'notebook' ? filter.id : defaultNotebook().id;
  const note = { id: uid(), title: fillDate(t.title), html, text: htmlToText(html), notebookId, pinned: false, createdAt: now, updatedAt: now };
  await putNote(note);
  notes.push(note);
  closeDrawer();
  await openNote(note.id, { newTab });
  editor.commands.focus('end');
}

async function deleteTemplate(t) {
  if (!confirm(`テンプレート「${templateLabel(t)}」を削除しますか`)) return;
  const wasOpen = currentId === t.id;
  tabs = tabs.filter(id => id !== t.id);
  store(TABS_KEY, tabs);
  if (wasOpen) { currentId = null; await go('templates'); }
  await purge([t]);
  renderAll();
}

// 新規作成: straight to a blank note until a template exists, then a small chooser.
function newMenu(anchor) {
  if (!templates.length) { newNote(); return; }
  const r = anchor.getBoundingClientRect();
  showMenuAt(r.left, r.bottom + 6, p => p.append(
    menuItem('空のノート', () => newNote()),
    menuSep(),
    menuLabel('テンプレートから'),
    ...[...templates].sort((a, b) => byName(a.title || '', b.title || '')).map(t => menuItem(fillDate(t.title) || '無題', () => newFromTemplate(t))),
  ));
}

function renderTemplatesPage() {
  const list = [...templates].sort((a, b) => byName(a.title || '', b.title || ''));
  $('templateCount').textContent = `${list.length}件`;
  if (!list.length) {
    $('templateRows').replaceChildren(Object.assign(document.createElement('p'), {
      className: 'side-empty', textContent: '元にしたいノートを右クリック →「テンプレートとして保存」で作れます',
    }));
    return;
  }
  const box = Object.assign(document.createElement('div'), { className: 'rows' });
  box.append(...list.map(t => {
    const row = document.createElement('div');
    row.className = 'trash-row';
    row.innerHTML = '<div class="trash-main"><span class="task-t ellipsis"></span><span class="dim ellipsis"></span></div>'
      + '<button class="mini">使う</button><button class="mini">編集</button><button class="mini danger">削除</button>';
    row.querySelector('.task-t').textContent = templateLabel(t);
    row.querySelector('.dim').textContent = `作成先: ${notebookName(t.notebookId) || '(現在のノートブック)'} · 今日なら「${fillDate(t.title) || '無題'}」`;
    const [use, edit, del] = row.querySelectorAll('button');
    use.dataset.useTemplate = t.id;
    edit.dataset.editTemplate = t.id;
    del.dataset.deleteTemplate = t.id;
    return row;
  }));
  $('templateRows').replaceChildren(box);
}

// On a wide screen an open note stays open while the list changes; otherwise show the list.
function setFilter(f) {
  filter = f;
  selected.clear();
  store(FILTER_KEY, f);
  closeDrawer();
  if (view !== 'note' || matchMedia('(max-width: 760px)').matches) go('list');
  renderAll();
}

async function createNotebook({ open = true } = {}) {
  const name = prompt('新しいノートブックの名前')?.trim();
  if (!name) return;
  const nb = { id: uid(), name, pinned: false, createdAt: Date.now() };
  await putNotebook(nb);
  notebooks.push(nb);
  if (open) setFilter({ type: 'notebook', id: nb.id }); else renderAll();
}

// Shared by the sidebar, home and notebooks page: every clickable item carries a data-* target.
function handleNav(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.toggle) {
    expanded.has(d.toggle) ? expanded.delete(d.toggle) : expanded.add(d.toggle);
    renderNotebooksPage();
    return;
  }
  if (d.go) { closeDrawer(); go(d.go); }
  if (d.filter) setFilter({ type: d.filter });
  if (d.notebook) setFilter({ type: 'notebook', id: d.notebook });
  if (d.note) { closeDrawer(); openNote(d.note); }
  if ('new' in d) newMenu(b);
  if (d.useTemplate) { const t = templates.find(x => x.id === d.useTemplate); if (t) newFromTemplate(t); }
  if (d.editTemplate) openNote(d.editTemplate);
  if (d.deleteTemplate) { const t = templates.find(x => x.id === d.deleteTemplate); if (t) deleteTemplate(t); }
  if ('drawer' in d) openDrawer();
}

// ---------- drawer (sidebar on narrow screens) ----------

function openDrawer() { document.body.classList.add('drawer-open'); $('scrim').hidden = false; }
function closeDrawer() { document.body.classList.remove('drawer-open'); $('scrim').hidden = true; }

// ---------- stage (rehearsal) mode ----------

let wakeLock = null;

function stageFont(delta = 0) {
  const size = Math.min(48, Math.max(14, (Number(load(FONT_KEY, 22)) || 22) + delta));
  store(FONT_KEY, size);
  document.documentElement.style.setProperty('--stage-size', `${size}px`);
}

async function lockScreenOn() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* denied or unsupported */ }
}

function enterStage() {
  $('stageBody').innerHTML = `<h1></h1>${sanitizeHtml(editor.getHTML())}`;
  const cur = notes.find(n => n.id === currentId);
  $('stageBody').querySelector('h1').textContent = [cur && numberLabel(cur), $('titleInput').value || '無題'].filter(Boolean).join(' ');
  $('stage').hidden = false;
  stageFont();
  lockScreenOn();
}

function exitStage() {
  if ($('stage').hidden) return;
  $('stage').hidden = true;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// The OS drops the wake lock whenever the tab is hidden; take it back on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('stage').hidden) lockScreenOn();
  if (document.visibilityState === 'hidden' && saveTimer) saveNow();
});

// ---------- events ----------

$('newBtn').onclick = e => newMenu(e.currentTarget);
$('newTabBtn').onclick = e => newMenu(e.currentTarget);
$('menuBtn').onclick = openDrawer;
$('scrim').onclick = closeDrawer;

for (const id of ['sidebar', 'homeView', 'notebooksView', 'tasksView', 'filesView', 'templatesView']) $(id).addEventListener('click', handleNav);
for (const id of ['homeView', 'tasksView']) {
  $(id).addEventListener('change', e => { if (e.target.dataset.task) toggleTask(e.target.dataset.task, e.target.checked); });
}
$('tasksView').addEventListener('click', e => {
  const m = e.target.closest('[data-taskmode]')?.dataset.taskmode;
  if (m) { taskMode = m; renderTasksPage(); }
});
$('filesView').addEventListener('click', e => {
  const m = e.target.closest('[data-filemode]')?.dataset.filemode;
  if (m) { fileMode = m; renderFilesPage(); }
});
$('newNotebookBtn').onclick = () => createNotebook({ open: false });


$('addNotebookBtn').onclick = () => createNotebook();

// ---------- notebook actions (list header buttons and right-click share these) ----------

const filterNotebook = () => notebooks.find(x => x.id === filter.id);

async function toggleNumbering(nb) {
  nb.numbered = !nb.numbered;
  await putNotebook(nb);
  pushUndo(`「${nb.name}」の連番を${nb.numbered ? 'オン' : 'オフ'}にしました`, async () => {
    nb.numbered = !nb.numbered;
    await putNotebook(nb);
    renderAll();
  });
  renderAll();
}

async function togglePinNotebook(nb) {
  nb.pinned = !nb.pinned;
  await putNotebook(nb);
  pushUndo(`「${nb.name}」を${nb.pinned ? 'ショートカットに追加' : 'ショートカットから外'}しました`, async () => {
    nb.pinned = !nb.pinned;
    await putNotebook(nb);
    renderAll();
  });
  renderAll();
}

async function renameNotebook(nb) {
  const name = prompt('ノートブックの名前', nb.name)?.trim();
  if (!name || name === nb.name) return;
  const before = nb.name;
  nb.name = name;
  await putNotebook(nb);
  pushUndo(`ノートブック名を「${name}」に変更しました`, async () => { nb.name = before; await putNotebook(nb); renderAll(); });
  renderAll();
}

async function removeNotebook(nb) {
  if (notebooks.length === 1) { alert('最後のノートブックは削除できません'); return; }
  const inside = notes.filter(n => n.notebookId === nb.id);
  const fallback = [...notebooks].filter(x => x.id !== nb.id).sort(byCreated)[0];
  const msg = inside.length
    ? `「${nb.name}」を削除します。中のノート${inside.length}件は「${fallback.name}」へ移動します。`
    : `「${nb.name}」を削除しますか`;
  if (!confirm(msg)) return;
  for (const n of inside) { n.notebookId = fallback.id; await putNote(n); }
  await deleteNotebook(nb.id);
  notebooks = notebooks.filter(x => x.id !== nb.id);
  if (filter.type === 'notebook' && filter.id === nb.id) setFilter({ type: 'all' }); else renderAll();
}

function exportNotebook(nb, format) {
  const inside = sortNotes(notes.filter(n => n.notebookId === nb.id));
  if (format === 'html') exportNotesHtml(inside, displayTitle, nb.name);
  else exportNotesJson(inside, [nb], nb.name);
}

// ---------- right-click menus ----------

async function renameNote(note) {
  const input = prompt('ノートの名前', note.title || '');
  if (input === null || input.trim() === (note.title || '')) return;
  if (note.id === currentId && saveTimer) await saveNow();
  const before = note.title || '';
  const apply = async title => {
    note.title = title;
    note.updatedAt = Date.now();
    await putNote(note);
    if (note.id === currentId) $('titleInput').value = title;
    renderAll();
  };
  await apply(input.trim());
  pushUndo(`名前を「${input.trim() || '無題'}」に変更しました`, () => apply(before));
}

function exportNotes(list, format) {
  const name = list.length === 1 ? displayTitle(list[0]) : `techo-${list.length}件`;
  if (format === 'html') exportNotesHtml(list, displayTitle, name);
  else exportNotesJson(list, notebooks.filter(nb => list.some(n => n.notebookId === nb.id)), name);
}

const menuLabel = text => Object.assign(document.createElement('div'), { className: 'menu-label', textContent: text });
const danger = item => { item.classList.add('danger'); return item; };
const sortedNotebooks = () => [...notebooks].sort((a, b) => byName(a.name, b.name));

function noteMenu(x, y, ids, extra = []) {
  const list = notes.filter(n => ids.includes(n.id));
  if (!list.length) return;
  const one = list.length === 1 ? list[0] : null;
  const allPinned = list.every(n => n.pinned);
  const allTop = list.every(n => n.pinTop);
  showMenuAt(x, y, p => p.append(
    ...(one ? [
      menuItem('開く', () => openNote(one.id)),
      menuItem('新しいタブで開く', () => openNote(one.id, { newTab: true })),
      menuItem('名前を変更', () => renameNote(one)),
      menuItem('コピーを作成', () => duplicateNotes(list)),
      menuItem('テンプレートとして保存', () => saveAsTemplate(one)),
    ] : [menuLabel(`${list.length}件を選択中`), menuItem(`${list.length}件のコピーを作成`, () => duplicateNotes(list))]),
    ...extra,
    menuSep(),
    menuItem(allTop ? 'ピン留めを外す' : 'ピン留め', () => setPinTop(ids, !allTop)),
    menuItem(allPinned ? 'ショートカットから外す' : 'ショートカットに追加', () => setPinned(ids, !allPinned)),
    menuItem('ノートブックへ移動…', () => showMenuAt(x, y, q => q.append(
      menuLabel('移動先'),
      ...sortedNotebooks().map(nb => menuItem(nb.name, () => moveNotes(ids, nb.id))),
    ))),
    menuSep(),
    menuItem('書き出し(HTML)', () => exportNotes(list, 'html')),
    menuItem('書き出し(techo形式 .json)', () => exportNotes(list, 'json')),
    menuItem(one ? '印刷' : `${list.length}件を印刷`, () => printNotes(list)),
    menuSep(),
    danger(menuItem(one ? '削除' : `${list.length}件を削除`, () => trashNotes(ids))),
  ));
}

function notebookMenu(x, y, nb) {
  showMenuAt(x, y, p => p.append(
    menuItem('開く', () => setFilter({ type: 'notebook', id: nb.id })),
    menuItem('名前を変更', () => renameNotebook(nb)),
    menuItem(nb.numbered ? '連番をオフにする' : '連番をオンにする', () => toggleNumbering(nb)),
    menuItem(nb.pinned ? 'ショートカットから外す' : 'ショートカットに追加', () => togglePinNotebook(nb)),
    menuSep(),
    menuItem('書き出し(HTML)', () => exportNotebook(nb, 'html')),
    menuItem('書き出し(techo形式 .json)', () => exportNotebook(nb, 'json')),
    menuItem('印刷', () => printNotes(sortNotes(notes.filter(n => n.notebookId === nb.id)))),
    menuSep(),
    danger(menuItem('削除', () => removeNotebook(nb))),
  ));
}

// ---------- print ----------
// Copies the notes into #printArea, which is the only thing shown under @media print.

async function printNotes(list) {
  if (!list.length) return;
  if (saveTimer) await saveNow();
  const area = $('printArea');
  // Stored HTML goes straight into the page here, so it is cleaned first (older imports
  // were saved before sanitizing existed).
  const bodies = await Promise.all(list.map(n => resolveHtml(sanitizeHtml(n.html))));
  area.replaceChildren(...list.map((n, i) => {
    const art = document.createElement('article');
    art.className = 'print-note';
    art.innerHTML = '<h1></h1><div class="print-meta"></div>' + bodies[i];
    art.querySelector('h1').textContent = displayTitle(n);
    art.querySelector('.print-meta').textContent = `${notebookName(n.notebookId)} · ${new Date(n.updatedAt).toLocaleDateString('ja-JP')}`;
    return art;
  }));
  // Paper can't play video: print the YouTube link instead of the player.
  for (const box of area.querySelectorAll('div[data-youtube-video]')) {
    const src = box.querySelector('iframe')?.getAttribute('src') || '';
    const id = src.match(/embed\/([\w-]+)/)?.[1];
    const p = document.createElement('p');
    p.className = 'print-yt';
    p.textContent = `YouTube: ${id ? `https://www.youtube.com/watch?v=${id}` : src}`;
    box.replaceWith(p);
  }
  await Promise.all([...area.querySelectorAll('img')].map(img =>
    img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
  window.print();
}
window.addEventListener('afterprint', () => $('printArea').replaceChildren());

// Ctrl+P prints notes (not the app screen), even while typing in a note.
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'p') return;
  const list = selected.size ? notes.filter(n => selected.has(n.id)) : notes.filter(n => n.id === currentId);
  if (!list.length) return;
  e.preventDefault();
  printNotes(list);
});

// Text areas keep the browser's own menu (copy, paste, spellcheck); everything else gets ours.
document.addEventListener('contextmenu', e => {
  if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  const { clientX: x, clientY: y } = e;
  const hit = sel => e.target.closest(sel);
  let el;
  if ((el = hit('#noteList li'))) {
    const id = el.dataset.id;
    if (!selected.has(id)) { selected.clear(); renderList(); }
    noteMenu(x, y, selected.has(id) ? [...selected] : [id]);
  } else if ((el = hit('.tab'))) {
    const id = el.dataset.id;
    noteMenu(x, y, [id], [menuItem('タブを閉じる', () => closeTab(id))]);
  } else if ((el = hit('.trash-row'))) {
    const id = el.querySelector('[data-restore]').dataset.restore;
    const n = trashed.find(t => t.id === id);
    showMenuAt(x, y, p => p.append(
      menuItem('復元', () => restoreNotes([id])),
      danger(menuItem('完全に削除', async () => {
        if (n && confirm(`「${displayTitle(n)}」を完全に削除します。元に戻せません。`)) { await purge([n]); renderAll(); }
      })),
    ));
  } else if ((el = hit('[data-notebook]'))) {
    const nb = notebooks.find(x2 => x2.id === el.dataset.notebook);
    if (nb) notebookMenu(x, y, nb);
  } else if ((el = hit('[data-note]'))) {
    noteMenu(x, y, [el.dataset.note]);
  } else {
    return;
  }
  e.preventDefault();
});

$('notebookMenuBtn').onclick = e => {
  const nb = filterNotebook();
  const r = e.currentTarget.getBoundingClientRect();
  if (nb) notebookMenu(r.left, r.bottom + 6, nb);
};

$('sortSelect').onchange = e => {
  sort = { key: e.target.value, dir: e.target.value === 'number' ? 'asc' : 'desc' };
  store(SORT_KEY, sort);
  renderList();
};
$('sortDir').onclick = () => {
  sort = { ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
  store(SORT_KEY, sort);
  renderList();
};


$('noteList').addEventListener('mousedown', e => { if (e.shiftKey) e.preventDefault(); }); // no text selection on Shift+click
$('noteList').addEventListener('click', e => {
  const li = e.target.closest('li');
  if (!li) return;
  const id = li.dataset.id;
  if (e.shiftKey) {
    const from = shownIds.indexOf(shownIds.includes(anchorId) ? anchorId : currentId);
    const to = shownIds.indexOf(id);
    selected.clear();
    if (from < 0) selected.add(id);
    else shownIds.slice(Math.min(from, to), Math.max(from, to) + 1).forEach(x => selected.add(x));
    renderList();
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    if (!selected.size && currentId && shownIds.includes(currentId)) selected.add(currentId);
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    anchorId = id;
    renderList();
    return;
  }
  selected.clear();
  anchorId = id;
  openNote(id);
});
$('noteList').addEventListener('auxclick', e => {
  const li = e.target.closest('li');
  if (li && e.button === 1) { e.preventDefault(); openNote(li.dataset.id, { newTab: true }); }
});

$('tabList').addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  if (e.target.closest('.tab-close')) closeTab(tab.dataset.id);
  else go(`n/${tab.dataset.id}`);
});
$('tabList').addEventListener('auxclick', e => {
  const tab = e.target.closest('.tab');
  if (tab && e.button === 1) { e.preventDefault(); closeTab(tab.dataset.id); }
});

$('search').oninput = renderList;
$('titleInput').oninput = () => { scheduleSave(); $('crumbTitle').textContent = $('titleInput').value || '無題'; };
$('titleInput').onkeydown = e => {
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); editor.commands.focus('start'); }
};
$('backBtn').onclick = () => { go('list'); };

$('nbSelect').onchange = async e => {
  const t = templates.find(x => x.id === currentId);
  if (t) { t.notebookId = e.target.value; await putNote(t); renderAll(); return; } // where its notes get created
  if (currentId) moveNotes([currentId], e.target.value);
};

$('pinBtn').onclick = () => {
  const note = notes.find(n => n.id === currentId);
  if (note) setPinned([note.id], !note.pinned);
};

// Phones have no room for every header button; the rarely used ones live here.
$('moreBtn').onclick = e => {
  const note = notes.find(n => n.id === currentId);
  if (!note) return;
  showPopover(e.currentTarget, p => {
    p.classList.remove('swatches');
    p.append(
      menuItem(note.pinned ? 'ショートカットから外す' : 'ショートカットに追加', () => $('pinBtn').click()),
      menuItem('印刷', () => printNotes([note])),
      Object.assign(menuItem('削除', () => $('deleteBtn').click()), { className: 'menu-item danger' }),
    );
  });
};

// Any file (PDF scores, audio...) goes in as an "添付: name" link; images keep going inline.
$('fileInput').onchange = async e => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) {
    if (f.type.startsWith('image/')) { insertImageFiles([f]); continue; }
    const id = await storeBlob(f, f.name);
    const href = await attachmentLink(id);
    editor.chain().focus().insertContent({
      type: 'paragraph',
      content: [{ type: 'text', text: `添付: ${f.name}`, marks: [{ type: 'link', attrs: { href } }] }],
    }).run();
  }
};

$('imageInput').onchange =e => { insertImageFiles(e.target.files); e.target.value = ''; };
$('stageBtn').onclick = async () => { await saveNow(); go(`n/${currentId}/stage`); };
$('stageExit').onclick = () => { go(`n/${currentId}`); };
$('fontUp').onclick = () => stageFont(2);
$('fontDown').onclick = () => stageFont(-2);

// Deleting moves to the trash; no confirm needed since Ctrl+Z / 元に戻す brings it back.
$('deleteBtn').onclick = () => {
  const t = templates.find(x => x.id === currentId);
  if (t) deleteTemplate(t); else if (currentId) trashNotes([currentId]);
};

$('exportBtn').onclick = () => exportAll();
$('importBtn').onclick = () => $('importInput').click();
$('importInput').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const count = await importFile(file);
    await loadNotes();
    notebooks = await getAllNotebooks();
    await ensureNotebooks();
    renderAll();
    alert(`${count}件を読み込みました`);
  } catch (err) {
    alert(`読み込めませんでした: ${err.message}`);
  }
};

$('enexBtn').onclick = () => $('enexInput').click();
$('enexInput').onchange = async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  const btn = $('enexBtn');
  btn.disabled = true;
  const results = [];
  try {
    for (const [fi, file] of files.entries()) {
      results.push(await importEnex(file, (done, fraction) => {
        btn.textContent = `取り込み中 ${fi + 1}/${files.length}ファイル目 ${done}件 (${Math.round(fraction * 100)}%)`;
      }));
    }
  } catch (err) {
    alert(`取り込みに失敗しました: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Evernoteから取り込み';
  }
  await loadNotes();
  notebooks = await getAllNotebooks();
  renderAll();
  if (results.length) {
    alert(results.map(r => [
      `${r.notebook}: ${r.added}件を追加`,
      r.updated && `${r.updated}件を取り込み直し`,
      r.repaired && `${r.repaired}件のタスクを修復`,
      r.skipped && `techoで編集済み・ゴミ箱の${r.skipped}件はそのまま`,
      r.failed.length && `読めなかった${r.failed.length}件: ${r.failed.join(' / ')}`,
    ].filter(Boolean).join('、')).join('\n'));
  }
};

$('bulkDelete').onclick = () => trashNotes([...selected]);
$('bulkClear').onclick = clearSelection;
$('bulkPin').onclick = () => {
  const ids = [...selected];
  setPinned(ids, !ids.every(id => notes.find(n => n.id === id)?.pinned));
};
$('bulkMove').onchange = e => { if (e.target.value) moveNotes([...selected], e.target.value); };

$('trashView').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.restore) restoreNotes([b.dataset.restore]);
  if (b.dataset.purge) {
    const n = trashed.find(x => x.id === b.dataset.purge);
    if (n && confirm(`「${displayTitle(n)}」を完全に削除します。元に戻せません。`)) { await purge([n]); renderAll(); }
  }
});
$('emptyTrashBtn').onclick = async () => {
  if (!trashed.length || !confirm(`ゴミ箱の${trashed.length}件を完全に削除します。元に戻せません。`)) return;
  await purge([...trashed]);
  renderAll();
  showToast('ゴミ箱を空にしました', false);
};

$('toastUndo').onclick = () => { $('toast').hidden = true; undoLast(); };

// Ctrl+Z / Delete / Esc act on notes only when you are not typing; inside the editor and
// inputs they keep their normal text meaning.
document.addEventListener('keydown', e => {
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && undoStack.length) { e.preventDefault(); undoLast(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) { e.preventDefault(); trashNotes([...selected]); }
  if (e.key === 'Escape') clearSelection();
});

window.addEventListener('hashchange', route);

// ---------- start ----------

// ---------- theme (home-screen toggle; follows the OS until one is picked) ----------

const THEME_KEY = 'techo.theme';
const systemTheme = () => (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
const currentTheme = () => document.documentElement.dataset.theme || systemTheme();

// value, label, swatch (base color, accent color)
const THEMES = [
  ['dark', 'グラファイト', ['#141518', '#8fb4ff']],
  ['light', 'ペーパー', ['#f6f6f4', '#3f4652']],
  ['red', 'ボルドー', ['#3a1d24', '#ff8fa8']],
  ['green', 'フォレスト', ['#1c3328', '#6ee7b7']],
  ['blue', 'インディゴ', ['#1b2840', '#7dd3fc']],
];

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  const label = THEMES.find(([v]) => v === currentTheme())?.[1] || '';
  $('themeBtn').textContent = `テーマ: ${label}`;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]').content = bg;
}

$('themeBtn').onclick = e => {
  const r = e.currentTarget.getBoundingClientRect();
  showMenuAt(r.left, r.bottom + 6, p => p.append(...THEMES.map(([value, label, swatch]) => {
    const item = menuItem(label, () => { store(THEME_KEY, value); applyTheme(value); });
    const dot = Object.assign(document.createElement('span'), { className: 'theme-swatch' });
    dot.style.background = `linear-gradient(135deg, ${swatch[0]} 50%, ${swatch[1]} 50%)`;
    item.prepend(dot);
    if (value === currentTheme()) item.classList.add('current');
    return item;
  })));
};
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyTheme());
applyTheme();

// A new deploy takes over as soon as it is downloaded, instead of the old cached app
// quietly running until every tab is closed.
registerSW({ immediate: true });

(async () => {
  requestPersist();
  $('appVersion').textContent = `v${__APP_VERSION__}`;
  await loadNotes();
  await purge(trashed.filter(n => n.deletedAt < Date.now() - TRASH_DAYS * DAY));
  notebooks = await getAllNotebooks();
  await ensureNotebooks();
  const ids = new Set(notes.map(n => n.id));
  tabs = load(TABS_KEY, []).filter(id => ids.has(id));
  sort = { ...sort, ...load(SORT_KEY, {}) };
  const f = load(FILTER_KEY, { type: 'all' });
  filter = f.type === 'notebook' && !notebooks.some(nb => nb.id === f.id) ? { type: 'all' } : f;
  await route();
  const leftover = notes.filter(n => n.html?.includes(PLACEHOLDER)).length;
  if (leftover) showToast(`${leftover}件のノートにEvernoteのタスクが未変換です。その.enexを取り込み直すと直ります`, false);
})();
