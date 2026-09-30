// Until sync exists, data lives only in this browser. Export/import is the safety net.
import { getAllNotes, getAllAttachments, getAllNotebooks, getNote, putNote, putAttachment, putNotebook } from './db.js';

const toDataUrl = blob => new Promise(r => {
  const fr = new FileReader();
  fr.onload = () => r(fr.result);
  fr.readAsDataURL(blob);
});

export async function exportAll() {
  const notes = await getAllNotes();
  const notebooks = await getAllNotebooks();
  const atts = await getAllAttachments();
  const attachments = await Promise.all(atts.map(async a => ({
    id: a.id, type: a.type, name: a.name, createdAt: a.createdAt, data: await toDataUrl(a.blob),
  })));
  const json = JSON.stringify({ app: 'techo', version: 1, exportedAt: Date.now(), notebooks, notes, attachments });
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `techo-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Newer updatedAt wins, so importing an old backup never overwrites fresh edits.
export async function importFile(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'techo') throw new Error('techoのバックアップではありません');
  const existing = new Set((await getAllNotebooks()).map(nb => nb.id));
  for (const nb of data.notebooks || []) {
    if (!existing.has(nb.id)) await putNotebook(nb);
  }
  for (const a of data.attachments || []) {
    const blob = await (await fetch(a.data)).blob();
    await putAttachment({ id: a.id, blob, type: a.type, name: a.name, createdAt: a.createdAt });
  }
  let count = 0;
  for (const n of data.notes || []) {
    const cur = await getNote(n.id);
    if (!cur || cur.updatedAt < n.updatedAt) { await putNote(n); count++; }
  }
  return count;
}
