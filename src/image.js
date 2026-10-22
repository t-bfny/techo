// Images with an optional caption (見出し). Saved as <figure><img><figcaption>, the standard
// HTML for it, so preview, print, export and pasting elsewhere all keep it; an image without
// a caption stays a plain <img> like before. The caption box shows under a selected image.
// align (left | center | right; none = left) is data-align on the <figure>, or on the <img>.
import Image from '@tiptap/extension-image';
import { TextSelection } from '@tiptap/pm/state';
import { t as tr } from './i18n.js';

export const CaptionImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: {
        default: '',
        parseHTML: el => el.closest('figure')?.querySelector('figcaption')?.textContent.trim() || '',
        renderHTML: () => ({}), // written as <figcaption>, not as an attribute
      },
      align: {
        default: null,
        parseHTML: el => {
          const v = el.closest('figure')?.getAttribute('data-align') || el.getAttribute('data-align');
          return ['left', 'center', 'right'].includes(v) ? v : null;
        },
        renderHTML: () => ({}), // placed by renderHTML below
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure',
        getAttrs: el => {
          const img = el.querySelector('img');
          if (!img?.getAttribute('src')) return false;
          return {
            src: img.getAttribute('src'), alt: img.getAttribute('alt'), title: img.getAttribute('title'),
            caption: el.querySelector('figcaption')?.textContent.trim() || '',
            align: ['left', 'center', 'right'].includes(el.getAttribute('data-align')) ? el.getAttribute('data-align') : null,
          };
        },
      },
      ...(this.parent?.() || []),
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const align = node.attrs.align ? { 'data-align': node.attrs.align } : {};
    if (!node.attrs.caption) return ['img', { ...HTMLAttributes, ...align }];
    return ['figure', align, ['img', HTMLAttributes], ['figcaption', {}, node.attrs.caption]];
  },

  // The caption counts as the note's text, so search finds it.
  renderText: ({ node }) => node.attrs.caption || '',

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('figure');
      dom.className = 'img-figure';
      const img = document.createElement('img');
      const cap = document.createElement('input');
      cap.className = 'img-caption';
      cap.placeholder = tr('画像の見出し(キャプション)');
      cap.setAttribute('aria-label', tr('画像の見出し(キャプション)'));
      dom.append(img, cap);

      const show = n => {
        if (img.getAttribute('src') !== n.attrs.src) img.src = n.attrs.src;
        img.alt = n.attrs.alt || '';
        if (cap.value !== n.attrs.caption) cap.value = n.attrs.caption;
        dom.classList.toggle('has-caption', !!n.attrs.caption);
        if (n.attrs.align) dom.dataset.align = n.attrs.align; else delete dom.dataset.align;
      };
      show(node);

      cap.addEventListener('input', () => {
        const pos = getPos();
        if (typeof pos === 'number') editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'caption', cap.value));
      });
      cap.addEventListener('keydown', e => {
        if (e.isComposing) return;
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          // on to the text below the image (making a paragraph if there is none)
          e.preventDefault();
          const { state, view } = editor;
          const pos = getPos();
          const after = pos + state.doc.nodeAt(pos).nodeSize;
          const tr = state.tr;
          if (!state.doc.resolve(after).nodeAfter?.isTextblock) tr.insert(after, state.schema.nodes.paragraph.create());
          view.dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)));
          view.focus(); // now, not next frame: the next keys belong to the text below
        }
        if (e.key === 'Escape') { e.preventDefault(); editor.view.focus(); }
      });

      return {
        dom,
        update: n => {
          if (n.type !== node.type) return false;
          node = n;
          show(n);
          return true;
        },
        selectNode: () => dom.classList.add('ProseMirror-selectednode'),
        deselectNode: () => dom.classList.remove('ProseMirror-selectednode'),
        stopEvent: e => e.target === cap, // typing in the box is not editing the note text
        ignoreMutation: () => true,
      };
    };
  },
});
