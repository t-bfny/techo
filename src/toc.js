// 目次: a block that lists the note's headings (見出し1〜3) and jumps to them.
// Only an empty <div data-toc> is saved; the list is always rebuilt from the current
// headings, so it never goes stale.
import { Node } from '@tiptap/core';
import { t as tr } from './i18n.js';

function render(box, items, onPick) {
  box.replaceChildren();
  const head = document.createElement('div');
  head.className = 'toc-head';
  head.textContent = tr('目次');
  box.append(head);
  if (!items.length) {
    const p = document.createElement('div');
    p.className = 'toc-empty';
    p.textContent = tr('見出しがありません。見出し1〜3を付けると、ここに並びます。');
    box.append(p);
    return;
  }
  const top = Math.min(...items.map(i => i.level));
  for (const [i, item] of items.entries()) {
    const el = onPick ? document.createElement('button') : document.createElement('a');
    el.className = 'toc-item';
    el.dataset.depth = item.level - top;
    el.textContent = item.text || tr('(無題の見出し)');
    if (onPick) {
      el.type = 'button';
      el.onclick = e => { e.preventDefault(); e.stopPropagation(); onPick(i); };
    } else if (item.href) {
      el.href = item.href;
    }
    box.append(el);
  }
}

export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML: () => [{ tag: 'div[data-toc]' }],
  renderHTML: () => ['div', { 'data-toc': '' }],

  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement('div');
      dom.className = 'toc';
      dom.contentEditable = 'false';
      let positions = [];
      const update = () => {
        const items = [];
        positions = [];
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name !== 'heading') return true;
          items.push({ level: node.attrs.level, text: node.textContent.trim() });
          positions.push(pos);
          return false;
        });
        render(dom, items, i => {
          const target = editor.view.nodeDOM(positions[i]);
          target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
      };
      update();
      editor.on('update', update);
      return {
        dom,
        ignoreMutation: () => true,
        stopEvent: e => !!e.target.closest?.('.toc-item'),
        destroy: () => editor.off('update', update),
      };
    };
  },

  addCommands() {
    return {
      // A paragraph after it so typing continues below the 目次, not above it.
      insertTableOfContents: () => ({ commands }) =>
        commands.insertContent([{ type: this.name }, { type: 'paragraph' }]),
    };
  },
});

// Fills every <div data-toc> inside root from the headings in root (stage, print, export).
// Headings marked data-note-title are the note's own title and are left out.
// links: give headings ids and use #anchors (a standalone exported page); otherwise tapping
// an entry scrolls to it.
export function fillToc(root, { links = false, prefix = 'h' } = {}) {
  const boxes = root.querySelectorAll('div[data-toc]');
  if (!boxes.length) return;
  const heads = [...root.querySelectorAll('h1, h2, h3')]
    .filter(h => !h.hasAttribute('data-note-title') && !h.closest('[data-toc]'));
  const items = heads.map((h, i) => {
    if (links) h.id = `${prefix}-${i + 1}`;
    return { level: Number(h.tagName[1]), text: h.textContent.trim(), href: links ? `#${prefix}-${i + 1}` : null };
  });
  for (const box of boxes) {
    box.classList.add('toc');
    render(box, items, links ? null : i => heads[i].scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }
}
