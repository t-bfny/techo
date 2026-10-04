// Formatting toolbar + the popovers it opens (insert menu, due date, text color, highlight).
import { addDays as offsetDay, fmtDue } from './tasks.js';

const $ = id => document.getElementById(id);

// Mid-saturation so they read on both the dark and light theme.
const TEXT_COLORS = [
  ['なし', null], ['グレー', '#8b8d98'], ['赤', '#e5484d'], ['オレンジ', '#f76b15'],
  ['黄', '#d6a300'], ['緑', '#30a46c'], ['青', '#3e8ed0'], ['紫', '#8e4ec6'],
];
const HIGHLIGHTS = [
  ['なし', null], ['黄', 'rgba(255, 214, 10, 0.40)'], ['緑', 'rgba(48, 164, 108, 0.35)'],
  ['青', 'rgba(62, 142, 208, 0.35)'], ['赤', 'rgba(229, 72, 77, 0.35)'], ['紫', 'rgba(142, 78, 198, 0.35)'],
];

const TOGGLES = {
  bold: e => e.chain().focus().toggleBold().run(),
  italic: e => e.chain().focus().toggleItalic().run(),
  underline: e => e.chain().focus().toggleUnderline().run(),
  strike: e => e.chain().focus().toggleStrike().run(),
  bulletList: e => e.chain().focus().toggleBulletList().run(),
  orderedList: e => e.chain().focus().toggleOrderedList().run(),
  taskList: e => e.chain().focus().toggleTaskList().run(),
  undo: e => e.chain().focus().undo().run(),
  redo: e => e.chain().focus().redo().run(),
};

let openFor = null; // button that owns the open popover

function closePopover() {
  $('popover').hidden = true;
  openFor = null;
}

export function showPopover(button, build) {
  if (openFor === button) { closePopover(); return; }
  const pop = $('popover');
  pop.replaceChildren();
  build(pop);
  pop.hidden = false;
  const r = button.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  openFor = button;
}

// Right-click menus: same popover, placed at the pointer and kept inside the window.
export function showMenuAt(x, y, build) {
  const pop = $('popover');
  pop.replaceChildren();
  pop.classList.remove('swatches');
  build(pop);
  pop.hidden = false;
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(x, innerWidth - w - 8))}px`;
  pop.style.top = `${Math.max(8, Math.min(y, innerHeight - h - 8))}px`;
  openFor = null;
}

export function menuSep() {
  return Object.assign(document.createElement('div'), { className: 'menu-sep' });
}

export function menuItem(label, onClick) {
  const b = document.createElement('button');
  b.className = 'menu-item';
  b.textContent = label;
  b.onclick = () => { closePopover(); onClick(); };
  return b;
}

function swatches(pop, colors, current, apply, kind) {
  pop.classList.add('swatches');
  for (const [name, value] of colors) {
    const b = document.createElement('button');
    b.className = `swatch ${kind}`;
    b.title = name;
    if (value) b.style.setProperty('--c', value); else b.classList.add('none');
    if ((current || null) === value) b.classList.add('on');
    b.onclick = () => { closePopover(); apply(value); };
    pop.append(b);
  }
}

export function setupToolbar(editor, insert) {
  const bar = $('toolbar');

  // Keep focus in the editor when pressing toolbar buttons (matters on phones).
  bar.addEventListener('mousedown', e => {
    if (e.target.closest('button')) e.preventDefault();
  });
  $('popover').addEventListener('mousedown', e => { if (!e.target.closest('input')) e.preventDefault(); });

  bar.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cmd) TOGGLES[b.dataset.cmd](editor);
    if (b.dataset.table) editor.chain().focus()[b.dataset.table]().run();
    const pop = b.dataset.pop;
    if (pop === 'insert') {
      showPopover(b, p => {
        p.classList.remove('swatches');
        p.append(
          menuItem('画像', insert.image),
          menuItem('ファイル(PDFなど)', insert.file),
          menuItem('表', () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()),
          menuItem('YouTube動画', insert.youtube),
          menuItem('リンク', insert.link),
          menuItem('チェックリスト', () => editor.chain().focus().toggleTaskList().run()),
          menuItem('引用', () => editor.chain().focus().toggleBlockquote().run()),
          menuItem('区切り線', () => editor.chain().focus().setHorizontalRule().run()),
          menuItem('目次', () => editor.chain().focus().insertTableOfContents().run()),
        );
      });
    }
    if (pop === 'due') {
      showPopover(b, p => {
        p.classList.remove('swatches');
        const setDue = due => editor.chain().focus().updateAttributes('taskItem', { due }).run();
        const input = document.createElement('input');
        input.type = 'date';
        input.className = 'due-input';
        input.value = editor.getAttributes('taskItem').due || '';
        input.onchange = () => { if (input.value) { closePopover(); setDue(input.value); } };
        p.append(
          input,
          menuItem('今日', () => setDue(offsetDay(0))),
          menuItem('明日', () => setDue(offsetDay(1))),
          menuItem('来週', () => setDue(offsetDay(7))),
          menuItem('期限を外す', () => setDue(null)),
        );
      });
    }
    if (pop === 'color') {
      showPopover(b, p => swatches(p, TEXT_COLORS, editor.getAttributes('textStyle').color, c =>
        c ? editor.chain().focus().setColor(c).run() : editor.chain().focus().unsetColor().run(), 'text'));
    }
    if (pop === 'highlight') {
      showPopover(b, p => swatches(p, HIGHLIGHTS, editor.getAttributes('highlight').color, c =>
        c ? editor.chain().focus().setHighlight({ color: c }).run() : editor.chain().focus().unsetHighlight().run(), 'hl'));
    }
  });

  $('blockSelect').onchange = e => {
    const v = e.target.value;
    const chain = editor.chain().focus();
    (v === 'p' ? chain.setParagraph() : chain.setHeading({ level: Number(v) })).run();
  };

  document.addEventListener('mousedown', e => {
    if (!$('popover').hidden && !e.target.closest('#popover') && !e.target.closest('[data-pop]')) closePopover();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePopover(); });
  $('editorScroll').addEventListener('scroll', closePopover, { passive: true });

  const sync = () => {
    for (const b of bar.querySelectorAll('[data-cmd]')) {
      const c = b.dataset.cmd;
      if (c === 'undo') b.disabled = !editor.can().undo();
      else if (c === 'redo') b.disabled = !editor.can().redo();
      else b.classList.toggle('on', editor.isActive(c));
    }
    const level = [1, 2, 3].find(l => editor.isActive('heading', { level: l }));
    $('blockSelect').value = level ? String(level) : 'p';
    $('colorMark').style.setProperty('--c', editor.getAttributes('textStyle').color || 'currentColor');
    $('hlMark').style.setProperty('--c', editor.getAttributes('highlight').color || 'transparent');
    $('tableTools').hidden = !editor.isActive('table');
    const inTask = editor.isActive('taskItem');
    $('dueBtn').hidden = !inTask;
    const due = inTask && editor.getAttributes('taskItem').due;
    $('dueBtn').textContent = due ? `期限 ${fmtDue(due)}` : '期限';
    $('dueBtn').classList.toggle('on', !!due);
  };
  editor.on('transaction', sync);
  sync();
}
