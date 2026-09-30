import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Youtube, { isValidYoutubeUrl } from '@tiptap/extension-youtube';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import Placeholder from '@tiptap/extension-placeholder';

import { uid, getAllNotes, putNote, deleteNote, requestPersist } from './db.js';
import { resolveHtml, unresolveHtml, storeImage } from './attachments.js';
import { exportAll, importFile } from './backup.js';
import { JaAutolink } from './autolink.js';

const $ = id => document.getElementById(id);

let notes = [];          // in-memory copy for list + search (1000 notes fits easily)
let currentId = null;
let saveTimer = null;
let loading = false;

// ---------- editor ----------

const editor = new Editor({
  element: $('editor'),
  extensions: [
    StarterKit.configure({ link: { autolink: true, openOnClick: true, defaultProtocol: 'https' } }),
    Image,
    Youtube.configure({ nocookie: true, width: 640, height: 360, addPasteHandler: false }),
    Table.configure({ resizable: false }),
    TableRow, TableHeader, TableCell,
    Placeholder.configure({ placeholder: '本文' }),
    JaAutolink,
  ],
  editorProps: {
    handlePaste: (_view, event) =>
      insertImageFiles(event.clipboardData?.files) || insertYoutubeFromText(event.clipboardData?.getData('text/plain')),
    handleDrop: (_view, event) => insertImageFiles(event.dataTransfer?.files),
  },
  onUpdate: () => { if (!loading) scheduleSave(); },
  onSelectionUpdate: () => { $('tableTools').hidden = !editor.isActive('table'); },
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
  renderList();
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
  }
  currentId = null;
}

// ---------- list ----------

function matches(note, terms) {
  if (!terms.length) return true;
  const hay = `${note.title}\n${note.text}`.toLowerCase();
  return terms.every(t => hay.includes(t));
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

function renderList() {
  const terms = $('search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = notes.filter(n => matches(n, terms)).sort((a, b) => b.updatedAt - a.updatedAt);
  const ul = $('noteList');
  ul.replaceChildren(...shown.map(n => {
    const li = document.createElement('li');
    li.dataset.id = n.id;
    if (n.id === currentId) li.classList.add('active');
    const lines = (n.text || '').split('\n').map(s => s.trim()).filter(Boolean);
    const title = n.title || lines[0] || '無題';
    const snippet = (n.title ? lines : lines.slice(1)).join(' ').slice(0, 80);
    li.innerHTML = '<div class="row"><span class="t"></span><span class="d"></span></div><div class="s"></div>';
    li.querySelector('.t').textContent = title;
    li.querySelector('.d').textContent = fmtDate(n.updatedAt);
    li.querySelector('.s').textContent = snippet;
    return li;
  }));
  $('count').textContent = terms.length ? `${shown.length} / ${notes.length}件` : `${notes.length}件`;
}

// ---------- open / route ----------

async function openNote(id) {
  const note = notes.find(n => n.id === id);
  if (!note) { location.hash = ''; return; }
  currentId = id;
  loading = true;
  $('titleInput').value = note.title || '';
  editor.commands.setContent(await resolveHtml(note.html || ''), { emitUpdate: false });
  loading = false;
  $('emptyState').hidden = true;
  $('editorWrap').hidden = false;
  document.body.classList.add('show-editor');
  renderList();
}

async function route() {
  const [, id, mode] = location.hash.match(/^#n\/([a-z0-9]+)(?:\/(stage))?$/) || [];
  if (id !== currentId) {
    await leaveCurrent();
    if (id) await openNote(id);
  }
  if (!id) {
    $('editorWrap').hidden = true;
    $('emptyState').hidden = false;
    document.body.classList.remove('show-editor');
    renderList();
  }
  if (mode === 'stage') enterStage(); else exitStage();
}

// ---------- stage (rehearsal) mode ----------

let wakeLock = null;
const FONT_KEY = 'techo.stageFont';

function stageFont(delta = 0) {
  let size = 22;
  try { size = Number(localStorage.getItem(FONT_KEY)) || 22; } catch { /* storage blocked */ }
  size = Math.min(48, Math.max(14, size + delta));
  try { localStorage.setItem(FONT_KEY, String(size)); } catch { /* storage blocked */ }
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

$('newBtn').onclick = async () => {
  const now = Date.now();
  const note = { id: uid(), title: '', html: '', text: '', createdAt: now, updatedAt: now };
  await putNote(note);
  notes.push(note);
  location.hash = `n/${note.id}`;
  setTimeout(() => $('titleInput').focus(), 50);
};

$('noteList').onclick = e => {
  const li = e.target.closest('li');
  if (li) location.hash = `n/${li.dataset.id}`;
};

$('search').oninput = renderList;
$('titleInput').oninput = scheduleSave;
$('titleInput').onkeydown = e => {
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); editor.commands.focus('start'); }
};
$('backBtn').onclick = () => { location.hash = ''; };

$('imageBtn').onclick = () => $('imageInput').click();
$('imageInput').onchange = e => { insertImageFiles(e.target.files); e.target.value = ''; };
$('tableBtn').onclick = () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
$('tableTools').onclick = e => {
  const cmd = e.target.dataset.table;
  if (cmd) editor.chain().focus()[cmd]().run();
};
$('ytBtn').onclick = () => {
  const src = prompt('YouTubeのURL');
  if (src && !insertYoutubeFromText(src)) alert('YouTubeのURLとして読めませんでした');
};
$('stageBtn').onclick = async () => { await saveNow(); location.hash = `n/${currentId}/stage`; };
$('stageExit').onclick = () => { location.hash = `n/${currentId}`; };
$('fontUp').onclick = () => stageFont(2);
$('fontDown').onclick = () => stageFont(-2);

$('deleteBtn').onclick = async () => {
  const note = notes.find(n => n.id === currentId);
  if (!note || !confirm(`「${note.title || '無題'}」を削除しますか`)) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  await deleteNote(note.id);
  notes = notes.filter(n => n.id !== note.id);
  currentId = null;
  location.hash = '';
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
    renderList();
    alert(`${count}件を読み込みました`);
  } catch (err) {
    alert(`読み込めませんでした: ${err.message}`);
  }
};

window.addEventListener('hashchange', route);

// ---------- start ----------

(async () => {
  requestPersist();
  notes = await getAllNotes();
  await route();
})();
