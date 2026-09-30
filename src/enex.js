// Evernote .enex import. One file = one notebook (named after the file, as Evernote exports it).
// ENML is XHTML with a few Evernote-only tags; we rewrite it into HTML Tiptap understands.
import SparkMD5 from 'spark-md5';
import { isValidYoutubeUrl } from '@tiptap/extension-youtube';
import { uid, getAllNotes, putNote, getAllNotebooks, putNotebook } from './db.js';
import { storeBlob } from './attachments.js';

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

// onProgress(done, total) is called after each note.
export async function importEnex(file, onProgress = () => {}) {
  const xml = new DOMParser().parseFromString(await file.text(), 'application/xml');
  if (xml.querySelector('parsererror') || !xml.querySelector('en-export')) {
    throw new Error(`${file.name} はEvernoteの書き出しファイルとして読めませんでした`);
  }

  const name = file.name.replace(/\.enex$/i, '') || 'Evernote';
  let notebook = (await getAllNotebooks()).find(nb => nb.name === name);
  if (!notebook) {
    notebook = { id: uid(), name, createdAt: Date.now() };
    await putNotebook(notebook);
  }

  // Same title + created time = same Evernote note, so re-importing a file is harmless.
  const seen = new Set((await getAllNotes()).map(n => n.sourceKey).filter(Boolean));
  const noteEls = [...xml.querySelectorAll('en-export > note')];
  let added = 0, skipped = 0;

  for (const [i, el] of noteEls.entries()) {
    const title = el.querySelector(':scope > title')?.textContent.trim() || '';
    const created = parseTime(el.querySelector(':scope > created')?.textContent);
    const sourceKey = `enex:${created}:${title}`;
    if (seen.has(sourceKey)) { skipped++; onProgress(i + 1, noteEls.length); continue; }

    const media = await readResources(el);
    // The HTML parser ignores "/>" on unknown tags, which would swallow everything after
    // an <en-media/> into it. Close them explicitly first.
    const enml = (el.querySelector(':scope > content')?.textContent || '')
      .replace(/<(en-media|en-todo)\b([^>]*?)\s*\/>/g, '<$1$2></$1>');
    const parsed = new DOMParser().parseFromString(enml, 'text/html');
    const body = parsed.querySelector('en-note') || parsed.body;
    convertBody(body, media);
    const html = body.innerHTML;

    await putNote({
      id: uid(),
      title,
      html,
      text: htmlToText(html),
      notebookId: notebook.id,
      pinned: false,
      tags: [...el.querySelectorAll(':scope > tag')].map(t => t.textContent),
      sourceKey,
      createdAt: created,
      updatedAt: parseTime(el.querySelector(':scope > updated')?.textContent) || created,
    });
    seen.add(sourceKey);
    added++;
    onProgress(i + 1, noteEls.length);
  }
  return { notebook: notebook.name, added, skipped };
}
