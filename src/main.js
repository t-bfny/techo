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
} from './db.js';
import { resolveHtml, unresolveHtml, storeImage, storeBlob, attachmentUrl } from './attachments.js';
import { DueTaskItem, allTasks, withTaskChecked, groupOpenTasks, fmtDue, isoDay } from './tasks.js';
import { exportAll, importFile } from './backup.js';
import { importEnex } from './enex.js';
import { JaAutolink } from './autolink.js';
import { setupToolbar, showPopover, menuItem } from './toolbar.js';

const $ = id => document.getElementById(id);

let notes = [];          // in-memory copy for list + search (1000 notes fits easily)
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

// ---------- save ----------

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}

async function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const note = notes.find(n => n.id === currentId);
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
  const note = notes.find(n => n.id === currentId);
  if (note && isBlank(note)) {
    await deleteNote(note.id);
    notes = notes.filter(n => n.id !== note.id);
    tabs = tabs.filter(t => t !== note.id);
    store(TABS_KEY, tabs);
  }
  currentId = null;
}

// ---------- rendering ----------

const displayTitle = n => n.title || (n.text || '').split('\n').map(s => s.trim()).find(Boolean) || '無題';

function matches(note, terms) {
  if (!terms.length) return true;
  const hay = `${note.title}\n${note.text}`.toLowerCase();
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
  for (const g of ['tasks', 'files']) document.querySelector(`.side-item[data-go="${g}"]`).classList.toggle('active', view === g);
  document.querySelector('.side-item[data-go="home"]').classList.toggle('active', view === 'home');
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
    link.href = url;
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

function renderList() {
  const terms = $('search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const scoped = notes.filter(inFilter);
  const shown = scoped.filter(n => matches(n, terms)).sort((a, b) => b.updatedAt - a.updatedAt);

  $('filterName').textContent = filter.type === 'notebook' ? notebookName(filter.id)
    : filter.type === 'shortcuts' ? 'ショートカット' : 'すべてのノート';
  $('count').textContent = terms.length ? `${shown.length} / ${scoped.length}件` : `${scoped.length}件`;
  $('notebookTools').hidden = filter.type !== 'notebook';
  $('pinNotebookBtn').classList.toggle('on', !!notebooks.find(nb => nb.id === filter.id)?.pinned);

  const showNotebook = filter.type !== 'notebook';
  $('noteList').replaceChildren(...shown.map(n => {
    const li = document.createElement('li');
    li.dataset.id = n.id;
    if (n.id === currentId) li.classList.add('active');
    const lines = (n.text || '').split('\n').map(s => s.trim()).filter(Boolean);
    const snippet = (n.title ? lines : lines.slice(1)).join(' ').slice(0, 80);
    li.innerHTML = '<div class="row"><span class="t"></span><span class="d"></span></div><div class="s"></div><div class="nb"></div>';
    li.querySelector('.t').textContent = displayTitle(n);
    li.querySelector('.d').textContent = fmtDate(n.updatedAt);
    li.querySelector('.s').textContent = snippet;
    li.querySelector('.nb').textContent = showNotebook ? notebookName(n.notebookId) : '';
    return li;
  }));
}

function renderTabs() {
  $('tabList').replaceChildren(...tabs.map(id => {
    const n = notes.find(x => x.id === id);
    const tab = document.createElement('div');
    tab.className = 'tab' + (id === currentId ? ' active' : '');
    tab.dataset.id = id;
    tab.innerHTML = '<span class="ellipsis"></span><button class="tab-close" title="閉じる">×</button>';
    tab.firstChild.textContent = n ? displayTitle(n) : '';
    return tab;
  }));
  $('tabList').querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderCrumbs() {
  const note = notes.find(n => n.id === currentId);
  if (!note) return;
  const sel = $('nbSelect');
  sel.replaceChildren(...[...notebooks].sort((a, b) => a.name.localeCompare(b.name, 'ja')).map(nb =>
    Object.assign(document.createElement('option'), { value: nb.id, textContent: nb.name })));
  sel.value = note.notebookId;
  $('crumbTitle').textContent = displayTitle(note);
  $('pinBtn').classList.toggle('on', !!note.pinned);
}

function renderAll() {
  renderSidebar();
  if (view === 'home') renderHome();
  if (view === 'notebooks') renderNotebooksPage();
  if (view === 'tasks') renderTasksPage();
  if (view === 'files') renderFilesPage();
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
  const note = notes.find(n => n.id === id);
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
  view = id ? 'note' : ({ '#notebooks': 'notebooks', '#list': 'list', '#tasks': 'tasks', '#files': 'files' })[hash] || 'home';
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

// On a wide screen an open note stays open while the list changes; otherwise show the list.
function setFilter(f) {
  filter = f;
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
  if ('new' in d) newNote();
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
  $('stageBody').innerHTML = `<h1></h1>${editor.getHTML()}`;
  $('stageBody').querySelector('h1').textContent = $('titleInput').value || '無題';
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

$('newBtn').onclick = () => newNote();
$('newTabBtn').onclick = () => newNote();
$('menuBtn').onclick = openDrawer;
$('scrim').onclick = closeDrawer;

for (const id of ['sidebar', 'homeView', 'notebooksView', 'tasksView', 'filesView']) $(id).addEventListener('click', handleNav);
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

$('pinNotebookBtn').onclick = async () => {
  const nb = notebooks.find(x => x.id === filter.id);
  if (!nb) return;
  nb.pinned = !nb.pinned;
  await putNotebook(nb);
  renderAll();
};

$('addNotebookBtn').onclick = () => createNotebook();

$('renameNotebookBtn').onclick = async () => {
  const nb = notebooks.find(x => x.id === filter.id);
  const name = nb && prompt('ノートブックの名前', nb.name)?.trim();
  if (!name) return;
  nb.name = name;
  await putNotebook(nb);
  renderAll();
};

$('deleteNotebookBtn').onclick = async () => {
  const nb = notebooks.find(x => x.id === filter.id);
  if (!nb) return;
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
  setFilter({ type: 'all' });
};

$('noteList').addEventListener('click', e => {
  const li = e.target.closest('li');
  if (li) openNote(li.dataset.id, { newTab: e.ctrlKey || e.metaKey });
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
  const note = notes.find(n => n.id === currentId);
  if (!note) return;
  note.notebookId = e.target.value;
  await putNote(note);
  renderAll();
};

$('pinBtn').onclick = async () => {
  const note = notes.find(n => n.id === currentId);
  if (!note) return;
  note.pinned = !note.pinned;
  await putNote(note);
  renderAll();
};

// Phones have no room for every header button; the rarely used ones live here.
$('moreBtn').onclick = e => {
  const note = notes.find(n => n.id === currentId);
  if (!note) return;
  showPopover(e.currentTarget, p => {
    p.classList.remove('swatches');
    p.append(
      menuItem(note.pinned ? 'ショートカットから外す' : 'ショートカットに追加', () => $('pinBtn').click()),
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
    const href = await attachmentUrl(id);
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

$('deleteBtn').onclick = async () => {
  const note = notes.find(n => n.id === currentId);
  if (!note || !confirm(`「${displayTitle(note)}」を削除しますか`)) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  await deleteNote(note.id);
  notes = notes.filter(n => n.id !== note.id);
  const i = tabs.indexOf(note.id);
  tabs = tabs.filter(t => t !== note.id);
  store(TABS_KEY, tabs);
  currentId = null;
  const next = tabs[Math.min(i, tabs.length - 1)];
  go(next ? `n/${next}` : 'list');
};

$('exportBtn').onclick = () => exportAll();
$('importBtn').onclick = () => $('importInput').click();
$('importInput').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const count = await importFile(file);
    notes = await getAllNotes();
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
  notes = await getAllNotes();
  notebooks = await getAllNotebooks();
  renderAll();
  if (results.length) {
    alert(results.map(r => [
      `${r.notebook}: ${r.added}件を追加`,
      r.updated && `${r.updated}件を取り込み直し`,
      r.skipped && `techoで編集済みの${r.skipped}件はそのまま`,
      r.failed.length && `読めなかった${r.failed.length}件: ${r.failed.join(' / ')}`,
    ].filter(Boolean).join('、')).join('\n'));
  }
};

window.addEventListener('hashchange', route);

// ---------- start ----------

(async () => {
  requestPersist();
  notes = await getAllNotes();
  notebooks = await getAllNotebooks();
  await ensureNotebooks();
  const ids = new Set(notes.map(n => n.id));
  tabs = load(TABS_KEY, []).filter(id => ids.has(id));
  const f = load(FILTER_KEY, { type: 'all' });
  filter = f.type === 'notebook' && !notebooks.some(nb => nb.id === f.id) ? { type: 'all' } : f;
  await route();
})();
