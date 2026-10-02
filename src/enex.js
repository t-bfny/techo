// Evernote .enex import. One file = one notebook (named after the file, as Evernote exports it).
// ENML is XHTML with a few Evernote-only tags; we rewrite it into HTML Tiptap understands.
import SparkMD5 from 'spark-md5';
import { isValidYoutubeUrl } from '@tiptap/extension-youtube';
import { uid, getAllNotes, putNote, getAllNotebooks, putNotebook, deleteAttachment } from './db.js';
import { storeBlob } from './attachments.js';
import { sanitizeHtml } from './sanitize.js';

const BLOCK = new Set(['DIV', 'P', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'HR', 'IMG', 'EN-MEDIA']);

// "20260629T121628Z" -> ms
function parseTime(s) {
  const m = s?.match(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/);
  return m ? Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6]) : Date.now();
}

function base64ToBytes(b64) {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const styleOf = el => el.getAttribute('style') || '';
const enStyle = (el, key) => styleOf(el).match(new RegExp(`--en-${key}\\s*:\\s*([^;]+)`))?.[1].trim();

function rename(el, tag) {
  const doc = el.ownerDocument;
  const n = doc.createElement(tag);
  while (el.firstChild) n.append(el.firstChild);
  el.replaceWith(n);
  return n;
}

function unwrap(el) {
  el.replaceWith(...el.childNodes);
}

function youtubeEmbed(doc, url) {
  const wrap = doc.createElement('div');
  wrap.setAttribute('data-youtube-video', '');
  const iframe = doc.createElement('iframe');
  iframe.setAttribute('src', url);
  wrap.append(iframe);
  return wrap;
}

// Rewrite one note's ENML body in place. media: hash -> {id, mime, name}
function convertBody(root, media) {
  const doc = root.ownerDocument;

  for (const el of [...root.querySelectorAll('en-crypt')]) {
    el.replaceWith(doc.createTextNode('[暗号化された内容]'));
  }

  for (const el of [...root.querySelectorAll('en-media')]) {
    const m = media.get(el.getAttribute('hash'));
    if (!m) { el.remove(); continue; }
    if (m.mime.startsWith('image/')) {
      const img = doc.createElement('img');
      img.setAttribute('src', `att:${m.id}`);
      el.replaceWith(img);
    } else {
      const a = doc.createElement('a');
      a.setAttribute('href', `att:${m.id}`);
      a.textContent = `添付: ${m.name || m.mime}`;
      const p = doc.createElement('p');
      p.append(a);
      el.replaceWith(p);
    }
  }

  // Code blocks: <div style="--en-codeblock:true">…</div>
  for (const el of [...root.querySelectorAll('div')].filter(d => enStyle(d, 'codeblock') === 'true')) {
    const lines = [...el.children].length ? [...el.children].map(c => c.textContent) : [el.textContent];
    const pre = doc.createElement('pre');
    const code = doc.createElement('code');
    code.textContent = lines.join('\n');
    pre.append(code);
    el.replaceWith(pre);
  }

  // New-style checklists: <ul style="--en-todo:true"><li style="--en-checked:true">
  for (const ul of [...root.querySelectorAll('ul')].filter(u => enStyle(u, 'todo') === 'true')) {
    ul.setAttribute('data-type', 'taskList');
    for (const li of ul.querySelectorAll(':scope > li')) {
      li.setAttribute('data-type', 'taskItem');
      li.setAttribute('data-checked', String(enStyle(li, 'checked') === 'true'));
    }
  }

  // Old-style checkboxes: <div><en-todo checked="true"/>text</div>, grouped into one list per run.
  for (const todo of [...root.querySelectorAll('en-todo')]) {
    const line = todo.closest('div, p, li') || todo.parentElement;
    const checked = todo.getAttribute('checked') === 'true';
    todo.remove();
    const li = doc.createElement('li');
    li.setAttribute('data-type', 'taskItem');
    li.setAttribute('data-checked', String(checked));
    const p = doc.createElement('p');
    while (line.firstChild) p.append(line.firstChild);
    li.append(p);
    const prev = line.previousElementSibling;
    if (prev?.getAttribute('data-type') === 'taskList') {
      prev.append(li);
      line.remove();
    } else {
      const ul = doc.createElement('ul');
      ul.setAttribute('data-type', 'taskList');
      ul.append(li);
      line.replaceWith(ul);
    }
  }

  // Highlights: spans with a background colour become <mark> so the Highlight mark picks them up.
  for (const span of [...root.querySelectorAll('span')]) {
    const bg = styleOf(span).match(/background-color\s*:\s*([^;]+)/)?.[1].trim();
    if (!bg) continue;
    const mark = rename(span, 'mark');
    mark.setAttribute('data-color', bg);
    const color = styleOf(span).match(/(?:^|;)\s*color\s*:\s*([^;]+)/)?.[1].trim();
    if (color) mark.setAttribute('style', `color: ${color}`);
  }
  for (const font of [...root.querySelectorAll('font')]) {
    const color = font.getAttribute('color');
    const span = rename(font, 'span');
    if (color) span.setAttribute('style', `color: ${color}`);
  }

  // Evernote wraps every line in <div>. Divs holding only inline content become paragraphs,
  // divs holding blocks are dissolved so their blocks sit at the top level.
  for (const div of [...root.querySelectorAll('div')].reverse()) {
    if (div.hasAttribute('data-youtube-video')) continue;
    const hasBlock = [...div.children].some(c => BLOCK.has(c.tagName.toUpperCase()));
    if (hasBlock) { unwrap(div); continue; }
    const p = rename(div, 'p');
    // Evernote ends lines (and draws blank lines) with a <br> the paragraph itself already implies.
    const last = p.lastChild;
    if (last?.nodeName === 'BR') last.remove();
  }

  // A paragraph that is nothing but a YouTube link becomes an embedded player.
  for (const p of [...root.querySelectorAll('p')]) {
    const a = p.querySelector('a');
    const href = a?.getAttribute('href') || '';
    if (a && p.textContent.trim() === a.textContent.trim() && isValidYoutubeUrl(href)) {
      p.replaceWith(youtubeEmbed(doc, href));
    }
  }
}

export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const lines = [];
  const walk = node => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) {
        if (!lines.length) lines.push('');
        lines[lines.length - 1] += c.textContent;
      } else if (c.nodeType === 1) {
        const block = BLOCK.has(c.tagName.toUpperCase()) || c.tagName === 'BR';
        if (block) lines.push('');
        walk(c);
        if (block) lines.push('');
      }
    }
  };
  walk(doc.body);
  return lines.map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

async function readResources(noteEl) {
  const media = new Map();
  for (const r of noteEl.querySelectorAll('resource')) {
    const data = r.querySelector('data')?.textContent;
    if (!data) continue;
    const bytes = base64ToBytes(data);
    const mime = r.querySelector('mime')?.textContent || 'application/octet-stream';
    const name = r.querySelector('resource-attributes > file-name')?.textContent || '';
    const hash = SparkMD5.ArrayBuffer.hash(bytes.buffer);
    const id = await storeBlob(new Blob([bytes], { type: mime }), name);
    media.set(hash, { id, mime, name });
  }
  return media;
}

// Evernote "tasks" (not checkboxes) live outside the note body as <task> elements; the body
// only has a read-only placeholder <div style="--en-task-group:true; --en-id:GROUP">.
function readTasks(noteEl) {
  const groups = new Map();
  for (const t of noteEl.querySelectorAll(':scope > task')) {
    const get = tag => t.querySelector(`:scope > ${tag}`)?.textContent || '';
    const group = get('taskGroupNoteLevelID');
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({
      title: get('title').trim(),
      done: get('taskStatus') === 'completed',
      due: get('dueDate') ? localDay(parseTime(get('dueDate')), get('timeZone')) : null,
      sort: get('sortWeight'),
    });
  }
  for (const list of groups.values()) list.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
  return groups;
}

// Due dates are stored as UTC instants; the day that matters is the one in the task's time zone.
function localDay(ms, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  }
}

function taskListEl(doc, tasks) {
  const ul = doc.createElement('ul');
  ul.setAttribute('data-type', 'taskList');
  for (const t of tasks) {
    const li = doc.createElement('li');
    li.setAttribute('data-type', 'taskItem');
    li.setAttribute('data-checked', String(t.done));
    if (t.due) li.setAttribute('data-due', t.due);
    const p = doc.createElement('p');
    p.textContent = t.title;
    li.append(p);
    ul.append(li);
  }
  return ul;
}

const taskGroupDivs = root => [...root.querySelectorAll('div')].filter(d => enStyle(d, 'task-group') === 'true');

function replaceTaskGroups(root, groups) {
  for (const div of taskGroupDivs(root)) {
    const tasks = groups.get(enStyle(div, 'id')) || [];
    if (tasks.length) div.replaceWith(taskListEl(root.ownerDocument, tasks)); else div.remove();
  }
}

// Text an older techo left where Evernote's task placeholder was converted as plain paragraphs.
export const PLACEHOLDER = 'サポートされていないコンテンツです';
const PLACEHOLDER_DETAIL = 'タスク機能のためのプレースホルダ';

// For a note already edited in techo: swap only the leftover placeholder paragraphs for the
// real tasks (in the same order they appear in Evernote), keeping every other edit.
function repairPlaceholders(html, el) {
  const enml = (el.querySelector(':scope > content')?.textContent || '')
    .replace(/<(en-media|en-todo)\b([^>]*?)\s*\/>/g, '<$1$2></$1>');
  const src = new DOMParser().parseFromString(enml, 'text/html');
  const groups = readTasks(el);
  const lists = taskGroupDivs(src).map(div => groups.get(enStyle(div, 'id')) || []);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const marks = [...doc.body.querySelectorAll('p')].filter(p => p.textContent.includes(PLACEHOLDER));
  if (!marks.length) return null;
  marks.forEach((p, i) => {
    const next = p.nextElementSibling;
    if (next?.textContent.includes(PLACEHOLDER_DETAIL)) next.remove();
    const tasks = lists[i] || [];
    if (tasks.length) p.replaceWith(taskListEl(doc, tasks)); else p.remove();
  });
  return sanitizeHtml(doc.body.innerHTML);
}

// Reads the file in chunks and yields one <note> element at a time. Some exports are
// close to 1 GB, more than a browser can hold as a single string. Each chunk is scanned
// once; a note's pieces are only joined when its closing tag arrives.
async function* streamNotes(file, onBytes) {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let read = 0, checked = false, inNote = false, parts = [], carry = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    read += value.length;
    onBytes(read);
    if (!checked) {
      checked = true;
      if (!value.slice(0, 4096).includes('<en-export')) {
        reader.cancel();
        throw new Error(`${file.name} はEvernoteの書き出しファイルとして読めませんでした`);
      }
    }
    let rest = carry + value;
    carry = '';
    while (rest) {
      if (!inNote) {
        const i = rest.indexOf('<note>');
        if (i < 0) { carry = rest.slice(-6); break; }
        inNote = true;
        parts = [];
        rest = rest.slice(i);
      }
      const j = rest.indexOf('</note>');
      if (j < 0) { parts.push(rest.slice(0, -6)); carry = rest.slice(-6); break; } // tag may straddle chunks
      parts.push(rest.slice(0, j + 7));
      rest = rest.slice(j + 7);
      inNote = false;
      const text = parts.join('');
      parts = [];
      yield parseNote(text);
    }
  }
}

// Evernote sometimes writes a bare "&" (seen in its auto-generated image captions), which is
// invalid XML. Retry once with those escaped; if the note still won't parse, report it.
const BARE_AMP = /&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g;

function parseNote(text) {
  const parse = t => {
    const doc = new DOMParser().parseFromString(t, 'application/xml');
    return doc.querySelector('parsererror') ? null : doc.documentElement;
  };
  const el = parse(text) || parse(text.replace(BARE_AMP, '&amp;'));
  if (el) return { el };
  const title = text.slice(0, 2000).match(/<title>([\s\S]*?)<\/title>/)?.[1] || '(タイトル不明)';
  return { failed: title };
}

function convertNote(el, media) {
  // The HTML parser ignores "/>" on unknown tags, which would swallow everything after
  // an <en-media/> into it. Close them explicitly first.
  const enml = (el.querySelector(':scope > content')?.textContent || '')
    .replace(/<(en-media|en-todo)\b([^>]*?)\s*\/>/g, '<$1$2></$1>');
  const parsed = new DOMParser().parseFromString(enml, 'text/html');
  const body = parsed.querySelector('en-note') || parsed.body;
  replaceTaskGroups(body, readTasks(el));
  convertBody(body, media);
  return sanitizeHtml(body.innerHTML);
}

// onProgress(notesDone, fraction of the file read)
export async function importEnex(file, onProgress = () => {}) {
  const name = file.name.replace(/\.enex$/i, '') || 'Evernote';
  let notebook = (await getAllNotebooks()).find(nb => nb.name === name);
  const ensureNotebook = async () => {
    if (!notebook) {
      notebook = { id: uid(), name, pinned: false, createdAt: Date.now() };
      await putNotebook(notebook);
    }
    return notebook.id;
  };

  // Same title + created time = same Evernote note. A note already imported is only
  // replaced if it was never edited in techo (its updatedAt is still Evernote's).
  const existing = new Map((await getAllNotes()).filter(n => n.sourceKey).map(n => [n.sourceKey, n]));
  let added = 0, updated = 0, repaired = 0, skipped = 0, fraction = 0;
  const failed = [];

  for await (const { el, failed: bad } of streamNotes(file, bytes => { fraction = Math.min(1, bytes / file.size); })) {
    if (!el) { failed.push(bad); continue; }
    const title = el.querySelector(':scope > title')?.textContent.trim() || '';
    const created = parseTime(el.querySelector(':scope > created')?.textContent);
    const changed = parseTime(el.querySelector(':scope > updated')?.textContent) || created;
    const sourceKey = `enex:${created}:${title}`;
    const prev = existing.get(sourceKey);
    // Leave notes alone that were edited in techo or are sitting in the trash, except for
    // filling in Evernote tasks an older version left as "unsupported" placeholders.
    if (prev && (prev.updatedAt !== changed || prev.deletedAt)) {
      const fixed = !prev.deletedAt && prev.html?.includes(PLACEHOLDER) && repairPlaceholders(prev.html, el);
      if (fixed) {
        prev.html = fixed;
        prev.text = htmlToText(fixed);
        prev.updatedAt = Date.now();
        await putNote(prev);
        repaired++;
      } else {
        skipped++;
      }
      onProgress(added + updated + repaired + skipped, fraction);
      continue;
    }

    const media = await readResources(el);
    const html = convertNote(el, media);
    if (prev) {
      for (const m of (prev.html || '').matchAll(/att:([a-z0-9]+)/g)) await deleteAttachment(m[1]);
    }
    const note = {
      id: prev?.id || uid(),
      title,
      html,
      text: htmlToText(html),
      notebookId: prev?.notebookId || await ensureNotebook(),
      pinned: prev?.pinned || false,
      tags: [...el.querySelectorAll(':scope > tag')].map(t => t.textContent),
      sourceKey,
      createdAt: created,
      updatedAt: changed,
    };
    await putNote(note);
    existing.set(sourceKey, note);
    if (prev) updated++; else added++;
    onProgress(added + updated + repaired + skipped, fraction);
  }
  return { notebook: name, added, updated, repaired, skipped, failed };
}
