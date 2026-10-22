// 検索と置換 in the open note. Matches are found per paragraph (a hit never spans two
// blocks or jumps over an image), shown as decorations, and replaced with one transaction
// each, so Ctrl+Z undoes a replace — "replace all" included — in one step.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const findKey = new PluginKey('find');

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// query: { term, caseSensitive, regex } → RegExp, or null when there is nothing to look for
// (or the pattern doesn't compile: the panel says so).
export function toRegExp({ term, caseSensitive, regex }) {
  if (!term) return null;
  try {
    return new RegExp(regex ? term : escapeRe(term), caseSensitive ? 'gu' : 'giu');
  } catch {
    return null;
  }
}

function findMatches(doc, re) {
  const out = [];
  if (!re) return out;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // The block's text with a map back to document positions; anything that isn't text
    // (images, line breaks) splits it.
    let text = '';
    const at = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text.length; i++) at.push(pos + 1 + offset + i);
        text += child.text;
      } else {
        at.push(-1);
        text += '￼';
      }
    });
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (!m[0]) { re.lastIndex++; continue; } // empty matches (e.g. /a*/) would loop forever
      const from = at[m.index], last = at[m.index + m[0].length - 1];
      if (from >= 0 && last >= 0 && !m[0].includes('￼')) out.push({ from, to: last + 1, match: m });
    }
    return false;
  });
  return out;
}

const empty = { query: null, re: null, matches: [], current: -1, decorations: DecorationSet.empty };

function build(doc, query, current) {
  const re = query ? toRegExp(query) : null;
  const matches = findMatches(doc, re);
  const cur = matches.length ? Math.min(Math.max(current, 0), matches.length - 1) : -1;
  const decorations = DecorationSet.create(doc, matches.map((m, i) =>
    Decoration.inline(m.from, m.to, { class: i === cur ? 'find-hit find-current' : 'find-hit' })));
  return { query, re, matches, current: cur, decorations };
}

// $1, $& etc. work in regex mode; a plain replacement is taken literally.
function replacementFor(state, m) {
  if (!state.query.regex) return state.query.replace ?? '';
  return m.match[0].replace(new RegExp(state.re.source, state.re.flags.replace('g', '')), state.query.replace ?? '');
}

export const Find = Extension.create({
  name: 'find',

  addProseMirrorPlugins() {
    return [new Plugin({
      key: findKey,
      state: {
        init: () => empty,
        apply(tr, prev, _old, newState) {
          const meta = tr.getMeta(findKey);
          if (meta?.query !== undefined) {
            if (!meta.query) return empty;
            // start from the first hit at or after the cursor
            const all = build(newState.doc, meta.query, 0);
            const i = all.matches.findIndex(m => m.from >= (meta.near ?? 0));
            return i > 0 ? build(newState.doc, meta.query, i) : all;
          }
          if (meta?.current !== undefined) return build(newState.doc, prev.query, meta.current);
          if (tr.docChanged && prev.query) {
            // Keep the current hit near where it was after an edit or a replace.
            const pos = prev.matches[prev.current] ? tr.mapping.map(prev.matches[prev.current].from) : 0;
            const next = build(newState.doc, prev.query, 0);
            const i = next.matches.findIndex(m => m.from >= pos);
            return i > 0 ? build(newState.doc, prev.query, i) : next;
          }
          return prev;
        },
      },
      props: { decorations: state => findKey.getState(state).decorations },
    })];
  },

  addCommands() {
    return {
      // query: { term, replace, caseSensitive, regex }, or null to clear
      setFindQuery: query => ({ state, tr, dispatch }) => {
        if (dispatch) tr.setMeta(findKey, { query, near: state.selection.from }).setMeta('addToHistory', false);
        return true;
      },
      findStep: dir => ({ state, tr, dispatch, view }) => {
        const s = findKey.getState(state);
        if (!s.matches.length) return false;
        if (dispatch) {
          tr.setMeta(findKey, { current: (s.current + dir + s.matches.length) % s.matches.length });
          requestAnimationFrame(() => scrollToFind(view));
        }
        return true;
      },
      replaceCurrent: () => ({ state, tr, dispatch }) => {
        const s = findKey.getState(state);
        const m = s.matches[s.current];
        if (!m) return false;
        if (dispatch) tr.insertText(replacementFor(s, m), m.from, m.to);
        return true;
      },
      replaceAll: () => ({ state, tr, dispatch }) => {
        const s = findKey.getState(state);
        if (!s.matches.length) return false;
        if (dispatch) for (const m of [...s.matches].reverse()) tr.insertText(replacementFor(s, m), m.from, m.to);
        return true;
      },
    };
  },
});

export const findState = editor => findKey.getState(editor.state);

// Brings the current hit into the middle of the note.
export function scrollToFind(view) {
  const s = findKey.getState(view.state);
  const m = s.matches[s.current];
  if (!m) return;
  const { node } = view.domAtPos(m.from);
  (node.nodeType === 1 ? node : node.parentElement)?.scrollIntoView({ block: 'center', behavior: 'instant' });
}
