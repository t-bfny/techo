import { test, expect, seed, readStore, note, titles, newNote, saved } from './helpers.js';

const outsideInputs = page => page.locator('#filterName').click();

test('trash: 30-day purge, range/ctrl selection, delete, Ctrl+Z, restore, empty', async ({ page }) => {
  const day = 86400000;
  await seed(page, {
    notebooks: [{ id: 'nb1', name: 'マイノート', createdAt: 1 }],
    notes: [
      note('old', '31日前に削除', { html: '<img src="att:attold">', deletedAt: Date.now() - 31 * day }),
      note('yday', '昨日削除', { deletedAt: Date.now() - day }),
      ...['A', 'B', 'C', 'D', 'E'].map((t, i) => note(t.toLowerCase(), `ノート${t}`, { updatedAt: 5000 - i })),
    ],
    attachments: [{ id: 'attold', type: 'image/png' }],
  });
  await page.goto('/#list');
  // the 31-day-old note and the attachment only it used are gone for good
  await expect(page.locator('#countTrash')).toHaveText('1');
  expect((await readStore(page, 'attachments')).length).toBe(0);
  await expect.poll(() => titles(page)).toEqual(['ノートA', 'ノートB', 'ノートC', 'ノートD', 'ノートE']);

  await page.click('#noteList li:has-text("ノートB")');
  await page.click('#noteList li:has-text("ノートD")', { modifiers: ['Shift'] });
  await expect(page.locator('#bulkCount')).toHaveText('3件を選択中');
  await page.click('#noteList li:has-text("ノートC")', { modifiers: ['Control'] });
  await expect(page.locator('#noteList li.selected .t')).toHaveText(['ノートB', 'ノートD']);
  await page.click('#bulkDelete');
  await expect.poll(() => titles(page)).toEqual(['ノートA', 'ノートC', 'ノートE']);
  await expect(page.locator('#toastMsg')).toHaveText('2件をゴミ箱に移動しました');

  await outsideInputs(page);
  await page.keyboard.press('Control+z');
  await expect.poll(() => titles(page)).toEqual(['ノートA', 'ノートB', 'ノートC', 'ノートD', 'ノートE']);

  await page.click('#noteList li:has-text("ノートA")');
  await page.click('#deleteBtn'); // the open note's own delete button
  await expect.poll(() => titles(page)).not.toContain('ノートA');

  await page.click('.side-item[data-go="trash"]');
  await expect(page.locator('.trash-row .task-t')).toHaveText(['ノートA', '昨日削除']);
  await expect(page.locator('.trash-row', { hasText: '昨日削除' })).toContainText('あと29日');
  await page.click('.trash-row:has-text("ノートA") button:has-text("復元")');
  await page.click('.trash-row:has-text("昨日削除") button:has-text("完全に削除")');
  await expect(page.locator('.trash-row')).toHaveCount(0);
  await expect(page.locator('#countAll')).toHaveText('5');
  expect((await readStore(page, 'notes')).length).toBe(5);
});

test('editor Ctrl+Z undoes typing, not note operations', async ({ page }) => {
  await page.goto('/#list');
  await newNote(page, 'ノート');
  await page.locator('.tiptap').click();
  await page.keyboard.type('本文');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.tiptap')).not.toContainText('本文');
  await expect(page.locator('#noteList li')).toHaveCount(1);
});

test('move to a notebook and undo it', async ({ page }) => {
  await seed(page, {
    notebooks: [{ id: 'nb1', name: 'マイノート', createdAt: 1 }, { id: 'nb2', name: 'バンド', createdAt: 2 }],
    notes: ['A', 'B', 'C'].map((t, i) => note(t.toLowerCase(), `ノート${t}`, { updatedAt: 5000 - i })),
  });
  await page.goto('/#list');
  const counts = () => page.locator('#notebookList .side-item').allTextContents();
  await page.click('#noteList li:has-text("ノートA")');
  await page.click('#noteList li:has-text("ノートC")', { modifiers: ['Shift'] });
  await page.selectOption('#bulkMove', 'nb2');
  await expect(page.locator('#toastMsg')).toHaveText('3件を「バンド」へ移動しました');
  await expect.poll(counts).toEqual(['バンド3', 'マイノート0']);
  await page.click('#toastUndo');
  await expect.poll(counts).toEqual(['バンド0', 'マイノート3']);
});

test('pin to the top of a notebook, whatever the sort', async ({ page }) => {
  await seed(page, {
    notebooks: [{ id: 'nbT', name: 'Tech', createdAt: 1 }],
    notes: ['tech-246 古い', 'tech-247 中', 'tech-248 新しめ'].map((t, i) =>
      note(`t${i}`, t, { notebookId: 'nbT', createdAt: 1000 + i, updatedAt: 9000 + i })),
  });
  await page.goto('/#list');
  await page.click('#notebookList .side-item:has-text("Tech")');
  await page.click('#noteList li:has-text("tech-246")', { button: 'right' });
  await page.click('#popover .menu-item:text-is("ピン留め")');
  await expect.poll(() => titles(page)).toEqual(['tech-246 古い', 'tech-248 新しめ', 'tech-247 中']);
  await expect(page.locator('#noteList li').first().locator('.pin')).toBeVisible();
  await page.selectOption('#sortSelect', 'created');
  await page.click('#sortDir');
  await expect.poll(() => titles(page)).toEqual(['tech-246 古い', 'tech-247 中', 'tech-248 新しめ']);
  // "all notes" keeps plain order, only the icon shows
  await page.click('.side-item[data-filter="all"]');
  await page.click('#sortDir');
  await expect.poll(() => titles(page)).toEqual(['tech-248 新しめ', 'tech-247 中', 'tech-246 古い']);
});

test('numbering keeps hand-written numbers and fills in the rest', async ({ page }) => {
  await seed(page, {
    notebooks: [{ id: 'nbR', name: 'Relationship', createdAt: 1 }, { id: 'nbT', name: 'Tech', createdAt: 2 }],
    notes: [
      ...['1 最初', '2　全角スペース', '3 三つ目', '番号なしA', '番号なしB'].map((t, i) =>
        note(`r${i}`, t, { notebookId: 'nbR', createdAt: 1000 + i, updatedAt: 5000 - i })),
      ...['tech-258 前', 'tech-259 Claude Code', 'メモ無番号'].map((t, i) =>
        note(`t${i}`, t, { notebookId: 'nbT', createdAt: 2000 + i, updatedAt: 9000 - i })),
    ],
  });
  await page.goto('/#list');
  await page.click('#notebookList .side-item:has-text("Relationship")');
  await page.click('#notebookMenuBtn');
  await page.click('#popover .menu-item:has-text("連番をオンにする")');
  await page.selectOption('#sortSelect', 'number');
  await expect.poll(() => titles(page)).toEqual(['1 最初', '2　全角スペース', '3 三つ目', '4 番号なしA', '5 番号なしB']);

  await page.click('#noteList li:has-text("番号なしA")', { button: 'right' });
  await page.click('#popover .menu-item:text-is("削除")');
  await expect.poll(() => titles(page)).toEqual(['1 最初', '2　全角スペース', '3 三つ目', '4 番号なしB']);

  await page.click('#notebookList .side-item:has-text("Tech")');
  await page.click('#notebookMenuBtn');
  await page.click('#popover .menu-item:has-text("連番をオンにする")');
  await newNote(page, '新しいノート');
  await expect(page.locator('#noteNumber')).toHaveText('tech-261');
  // stored titles are never rewritten
  const stored = (await readStore(page, 'notes')).map(n => n.title);
  expect(stored).toContain('番号なしB');
  expect(stored).toContain('メモ無番号');
});

test('rename, copy (with undo) and delete a notebook', async ({ page }) => {
  await seed(page, {
    notebooks: [{ id: 'nb1', name: 'マイノート', createdAt: 1 }, { id: 'nb2', name: 'バンド', createdAt: 2 }],
    notes: [note('a', 'セットリスト', { notebookId: 'nb2' })],
  });
  await page.goto('/#list');
  page.answer = 'セットリスト 秋';
  await page.click('#noteList li:has-text("セットリスト")', { button: 'right' });
  await page.click('#popover .menu-item:has-text("名前を変更")');
  await expect.poll(() => titles(page)).toEqual(['セットリスト 秋']);

  await page.click('#noteList li', { button: 'right' });
  await page.click('#popover .menu-item:has-text("コピーを作成")');
  await expect(page.locator('#titleInput')).toHaveValue('セットリスト 秋 のコピー');
  await expect(page.locator('#countAll')).toHaveText('2');
  await page.click('#toastUndo');
  await expect(page.locator('#countAll')).toHaveText('1');

  await page.click('#notebookList .side-item:has-text("バンド")', { button: 'right' });
  await page.click('#popover .menu-item:text-is("削除")');
  await expect(page.locator('#notebookList .side-item')).toHaveText(['マイノート1']);
  expect(page.dialogs.at(-1)).toContain('中のノート1件は「マイノート」へ移動します');
});

test('templates: save one, create from it (fresh date, unchecked), edit and delete it', async ({ page }) => {
  await seed(page, {
    notebooks: [{ id: 'nb1', name: 'task', createdAt: 1 }],
    notes: [note('d', 'Task - @2026-10-01', {
      html: '<h2>今日</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="true" data-due="2026-10-01"><p>練習</p></li><li data-type="taskItem" data-checked="false"><p>譜面</p></li></ul>',
      text: '今日 練習 譜面',
    })],
  });
  await page.goto('/#list');
  await page.click('#newBtn'); // no templates: straight into a blank note
  await expect(page.locator('#titleInput')).toBeFocused();
  await page.click('.side-item[data-filter="all"]');
  await page.click('#noteList li:has-text("Task - @")', { button: 'right' });
  await page.click('#popover .menu-item:has-text("テンプレートとして保存")');
  await expect(page.locator('#countTemplates')).toHaveText('1');
  await page.click('.side-item[data-go="templates"]');
  await expect(page.locator('#templateRows .trash-row')).toContainText('Task - @〈日付〉');

  await page.click('#newBtn');
  await expect(page.locator('#popover .menu-label')).toHaveText('テンプレートから');
  await page.click('#popover .menu-item:has-text("Task - @")');
  const today = new Intl.DateTimeFormat('en-CA').format(new Date());
  await expect(page.locator('#titleInput')).toHaveValue(`Task - @${today}`);
  await expect(page.locator('.tiptap li[data-checked]')).toHaveCount(2);
  await expect(page.locator('.tiptap li[data-checked="true"]')).toHaveCount(0);
  await expect(page.locator('.tiptap li[data-due]')).toHaveCount(0);

  await page.click('.side-item[data-go="templates"]');
  await page.click('#templateRows button:has-text("編集")');
  await expect(page.locator('#templateMark')).toBeVisible();
  await page.click('#deleteBtn');
  await expect(page.locator('#countTemplates')).toHaveText('');
});

test('shortcuts: a note and a notebook show up in the sidebar', async ({ page }) => {
  await seed(page, {
    notebooks: [{ id: 'nb1', name: 'マイノート', createdAt: 1 }],
    notes: [note('a', 'よく見るメモ')],
  });
  await page.goto('/#list');
  await page.click('#noteList li');
  await page.click('#pinBtn');
  await expect(page.locator('#shortcutList')).toContainText('よく見るメモ');
  await page.click('#notebookList .side-item', { button: 'right' });
  await page.click('#popover .menu-item:has-text("ショートカットに追加")');
  await expect(page.locator('#shortcutList')).toContainText('マイノート');
  await saved(page);
});
