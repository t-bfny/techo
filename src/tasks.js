// Tasks are the checklist items inside notes. They stay in the note's HTML;
// this module only reads them out for the Tasks page and flips their checkbox.
import { TaskItem as BaseTaskItem } from '@tiptap/extension-list';

// Checklist item + optional due date (YYYY-MM-DD), shown as a badge after the text.
export const DueTaskItem = BaseTaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      due: {
        default: null,
        keepOnSplit: false, // Enter after a dated task starts an undated one

        parseHTML: el => el.getAttribute('data-due') || null,
        // The label/overdue flag are display-only; parseHTML reads data-due alone.
        renderHTML: attrs => (attrs.due ? {
          'data-due': attrs.due,
          'data-due-label': fmtDue(attrs.due),
          ...(attrs.due < isoDay() ? { 'data-overdue': '' } : {}),
        } : {}),
      },
    };
  },
});

const ITEM = 'li[data-type="taskItem"], ul[data-type="taskList"] > li';
const cache = new Map(); // noteId -> {updatedAt, tasks}

function parseTasks(note) {
  const hit = cache.get(note.id);
  if (hit && hit.updatedAt === note.updatedAt) return hit.tasks;
  let tasks = [];
  if (/data-checked/.test(note.html || '')) {
    const doc = new DOMParser().parseFromString(note.html, 'text/html');
    tasks = [...doc.querySelectorAll(ITEM)].map((li, index) => {
      const body = li.querySelector(':scope > div, :scope > p') || li;
      const own = [...body.childNodes].filter(n => !(n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName)));
      return {
        noteId: note.id,
        index,
        text: own.map(n => n.textContent).join('').trim(),
        checked: li.getAttribute('data-checked') === 'true',
        due: li.getAttribute('data-due') || null,
      };
    }).filter(t => t.text);
  }
  cache.set(note.id, { updatedAt: note.updatedAt, tasks });
  return tasks;
}

export const allTasks = notes => notes.flatMap(parseTasks);

// Returns the note's HTML with the index-th checklist item set to `checked`.
export function withTaskChecked(note, index, checked) {
  const doc = new DOMParser().parseFromString(note.html, 'text/html');
  const li = doc.querySelectorAll(ITEM)[index];
  if (!li) return note.html;
  li.setAttribute('data-checked', String(checked));
  return doc.body.innerHTML;
}

const pad = n => String(n).padStart(2, '0');
export const isoDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoDay(d);
}

// Groups for the Tasks page, in display order.
export function groupOpenTasks(tasks) {
  const today = isoDay();
  const tomorrow = addDays(1);
  const groups = [['期限切れ', []], ['今日', []], ['明日', []], ['今後', []], ['期限なし', []]];
  for (const t of tasks) {
    const g = !t.due ? 4 : t.due < today ? 0 : t.due === today ? 1 : t.due === tomorrow ? 2 : 3;
    groups[g][1].push(t);
  }
  for (const [, list] of groups) list.sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  return groups.filter(([, list]) => list.length);
}

export function fmtDue(due) {
  if (!due) return '';
  const [y, m, d] = due.split('-').map(Number);
  const sameYear = y === new Date().getFullYear();
  return sameYear ? `${m}/${d}` : `${y}/${m}/${d}`;
}
