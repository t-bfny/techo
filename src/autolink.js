// Tiptap's autolink only finds URLs separated by spaces, which misses Japanese text like
// "参照。https://…". This links any http(s) URL once the cursor has moved past it.
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

const URL_RE = /https?:\/\/[\x21-\x7e]+/g;
const TRAILING = /[.,;:!?'")\]]+$/;

export const JaAutolink = Extension.create({
  name: 'jaAutolink',
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction: (trs, _old, state) => {
        if (!trs.some(t => t.docChanged)) return null;
        const link = state.schema.marks.link;
        const cursor = state.selection.empty ? state.selection.from : -1;
        const tr = state.tr;
        state.doc.descendants((node, pos, parent) => {
          if (!node.isText || parent.type.spec.code || node.marks.some(m => m.type === link)) return;
          for (const m of node.text.matchAll(URL_RE)) {
            const from = pos + m.index;
            if (from + m[0].length === cursor) continue; // still typing it
            const url = m[0].replace(TRAILING, '');
            const to = from + url.length;
            tr.addMark(from, to, link.create({ href: url }));
          }
        });
        return tr.steps.length ? tr : null;
      },
    })];
  },
});
