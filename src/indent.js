// Tab / Shift+Tab indentation for paragraphs and headings (saved as data-indent="1..8").
// Lists, tables and code blocks keep their own Tab behavior: list items nest, table cells
// move, code gets a tab character. Tab never moves focus out of the note.
import { Extension } from '@tiptap/core';

export const MAX_INDENT = 8;
const TYPES = ['paragraph', 'heading'];

// Lists/tables/code handle Tab themselves.
function ownTab(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'listItem' || name === 'taskItem' || name === 'tableCell' || name === 'tableHeader' || name === 'codeBlock') return true;
  }
  return false;
}

function shift(editor, delta) {
  const { state, view } = editor;
  const { from, to } = state.selection;
  const tr = state.tr;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!TYPES.includes(node.type.name)) return true;
    const indent = Math.max(0, Math.min(MAX_INDENT, (node.attrs.indent || 0) + delta));
    if (indent !== node.attrs.indent) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent });
    return false;
  });
  if (tr.docChanged) view.dispatch(tr);
  return true;
}

export const Indent = Extension.create({
  name: 'indent',
  priority: 1000,

  addGlobalAttributes() {
    return [{
      types: TYPES,
      attributes: {
        indent: {
          default: 0,
          parseHTML: el => Math.min(MAX_INDENT, Number(el.getAttribute('data-indent')) || 0),
          renderHTML: attrs => (attrs.indent ? { 'data-indent': attrs.indent } : {}),
        },
      },
    }];
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => (ownTab(editor.state) ? false : shift(editor, 1)),
      'Shift-Tab': ({ editor }) => (ownTab(editor.state) ? false : shift(editor, -1)),
      // Backspace at the very start of an indented line steps it back out first.
      Backspace: ({ editor }) => {
        const { selection } = editor.state;
        const { $from, empty } = selection;
        if (!empty || $from.parentOffset !== 0) return false;
        const node = $from.parent;
        if (!TYPES.includes(node.type.name) || !node.attrs.indent || ownTab(editor.state)) return false;
        return shift(editor, -1);
      },
    };
  },
});

// Runs after everything else: if nothing used Tab (e.g. the first list item can't nest),
// swallow it so focus stays in the note instead of jumping to the next button.
export const KeepTab = Extension.create({
  name: 'keepTab',
  priority: 1,
  addKeyboardShortcuts() {
    return { Tab: () => true, 'Shift-Tab': () => true };
  },
});
