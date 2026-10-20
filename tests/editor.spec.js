import { test, expect, newNote, saved, readStore } from './helpers.js';

const editor = page => page.locator('.tiptap');

test('a note is saved as you type and is still there after reloading', async ({ page }) => {
  await page.goto('/#list');
  await newNote(page, 'Autumn Leaves', 'ベースから4小節');
  await page.reload();
  await page.click('#noteList li:has-text("Autumn Leaves")');
  await expect(page.locator('#titleInput')).toHaveValue('Autumn Leaves');
  await expect(editor(page)).toContainText('ベースから4小節');
  const [stored] = await readStore(page, 'notes');
  expect(stored.text).toContain('ベースから4小節');
});

test('toolbar formatting ends up in the saved note', async ({ page }) => {
  await page.goto('/#list');
  await newNote(page, '書式');
  await editor(page).click();
  await page.keyboard.type('赤い太字');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');
  await page.click('[data-cmd="bold"]');
  await page.click('[data-pop="color"]');
  await page.click('.swatch.text[title="赤"]');
  await page.click('[data-pop="highlight"]');
  await page.click('.swatch.hl[title="黄"]');
  await page.keyboard.press('End');
  await page.waitForTimeout(100); // the editor picks up the moved cursor a moment later
  await page.keyboard.press('Enter');
  await page.click('[data-cmd="taskList"]');
  await page.keyboard.type('テンポ確認');
  await saved(page);
  const [n] = await readStore(page, 'notes');
  expect(n.html).toContain('<strong>');
  expect(n.html).toMatch(/color: (rgb\(229, 72, 77\)|#e5484d)/);
  expect(n.html).toContain('<mark');
  expect(n.html).toContain('data-type="taskList"');
});

test('undo never brings back the previous note', async ({ page }) => {
  await page.goto('/#list');
  await newNote(page, '一つ目', '最初のノートの本文');
  await newNote(page, '二つ目');
  await page.click('[data-cmd="undo"]').catch(() => {});
  await expect(page.locator('#titleInput')).toHaveValue('二つ目');
  await expect(editor(page)).not.toContainText('最初のノートの本文');
});

test('YouTube links become an embedded player', async ({ page }) => {
  await page.goto('/#list');
  await newNote(page, '動画');
  await editor(page).click();
  page.answer = 'https://youtu.be/jNQXAC9IVRw';
  await page.click('[data-pop="insert"]');
  await page.click('#popover .menu-item:has-text("YouTube動画")');
  await expect(editor(page).locator('iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/jNQXAC9IVRw/);
});

test('table of contents lists the headings, follows edits and jumps to them', async ({ page }) => {
  await page.goto('/#list');
  await newNote(page, '曲構成');
  await editor(page).click();
  await page.click('[data-pop="insert"]');
  await page.click('#popover .menu-item:has-text("目次")');
  await expect(editor(page).locator('.toc')).toContainText('見出しがありません');
  for (const [level, name] of [['2', 'イントロ'], ['2', 'Aメロ'], ['3', 'ブレイク'], ['2', 'サビ']]) {
    await page.selectOption('#blockSelect', level);
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    for (let i = 0; i < 15; i++) { await page.keyboard.type(`${name}のメモ`); await page.keyboard.press('Enter'); }
  }
  const items = editor(page).locator('.toc-item');
  await expect(items).toHaveText(['イントロ', 'Aメロ', 'ブレイク', 'サビ']);
  await expect(items.nth(2)).toHaveAttribute('data-depth', '1');
  // the toc sits above what was typed after it
  expect(await editor(page).evaluate(el => el.firstElementChild.classList.contains('toc'))).toBe(true);

  await page.locator('#editorScroll').evaluate(el => { el.scrollTop = 0; });
  await items.filter({ hasText: 'サビ' }).click();
  await expect(editor(page).locator('h2', { hasText: 'サビ' })).toBeInViewport();

  await editor(page).locator('h2', { hasText: 'イントロ' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('(4小節)');
  await expect(items.first()).toHaveText('イントロ(4小節)');

  await saved(page);
  const [n] = await readStore(page, 'notes');
  expect(n.html).toContain('<div data-toc=""></div>'); // only the placeholder is stored

  await page.click('#stageBtn');
  await expect(page.locator('#stageBody .toc-item')).toHaveText(['イントロ(4小節)', 'Aメロ', 'ブレイク', 'サビ']);
});

test('Tab indents text, nests lists and moves through tables; focus stays in the note', async ({ page }) => {
  await page.goto('/#list');
  await newNote(page, 'インデント');
  await editor(page).click();
  const k = page.keyboard;
  await k.type('段落0'); await k.press('Enter');
  await k.press('Tab'); await k.type('段落1'); await k.press('Enter'); // new line keeps the indent
  await k.press('Tab'); await k.type('段落2'); await k.press('Enter');
  await k.press('Shift+Tab'); await k.press('Shift+Tab'); await k.type('戻した'); await k.press('Enter');
  await k.press('Tab'); await k.press('Tab'); await k.press('Backspace'); await k.type('BSで1段'); await k.press('Enter');
  await k.press('Shift+Tab');
  const indents = () => editor(page).locator(':scope > p').evaluateAll(ps => ps.filter(p => p.textContent).map(p => `${p.dataset.indent || 0}:${p.textContent}`));
  await expect.poll(indents).toEqual(['0:段落0', '1:段落1', '2:段落2', '0:戻した', '1:BSで1段']);

  await page.click('[data-cmd="taskList"]');
  await k.type('タスク');
  await k.press('Tab'); // first item can't nest: Tab is swallowed, focus stays
  await expect(editor(page)).toBeFocused();
  await k.press('Enter'); await k.press('Tab'); await k.type('子タスク');
  await expect(editor(page).locator('ul ul li p')).toHaveText('子タスク');
  await k.press('Enter'); await k.press('Enter'); await k.press('Enter');

  await page.click('[data-pop="insert"]');
  await page.click('#popover .menu-item:has-text("表")');
  await k.type('A'); await k.press('Tab'); await k.type('B');
  await expect(editor(page).locator('table tr').first().locator('th, td').first()).toHaveText('A');
  await expect(editor(page).locator('table tr').first().locator('th, td').nth(1)).toHaveText('B');

  await saved(page);
  await page.reload();
  await page.click('#noteList li:has-text("インデント")');
  await expect.poll(indents).toEqual(['0:段落0', '1:段落1', '2:段落2', '0:戻した', '1:BSで1段']);
  await page.click('#stageBtn');
  expect(await page.locator('#stageBody p[data-indent="2"]').evaluate(p => parseFloat(getComputedStyle(p).marginLeft))).toBeGreaterThan(0);
});

test('tabs: middle-click opens another, they survive a reload, × closes one', async ({ page }) => {
  await page.goto('/#list');
  await newNote(page, 'セットリスト');
  await newNote(page, '曲メモ');
  await page.click('#tabList .tab.active .tab-close');
  await page.click('#noteList li:has-text("セットリスト")');
  await page.click('#noteList li:has-text("曲メモ")', { button: 'middle' });
  await expect(page.locator('#tabList .tab')).toHaveText([/セットリスト/, /曲メモ/]);
  await page.reload();
  await expect(page.locator('#tabList .tab')).toHaveText([/セットリスト/, /曲メモ/]);
  await page.locator('#tabList .tab', { hasText: '曲メモ' }).locator('.tab-close').click();
  await expect(page.locator('#tabList .tab')).toHaveText([/セットリスト/]);
});

test('preview: big text and a way back', async ({ page }) => {
  await page.goto('/#list');
  await newNote(page, 'スタジオ用', '1コーラス目はブラシ');
  await page.click('#stageBtn');
  await expect(page.locator('#stage')).toBeVisible();
  await expect(page.locator('#stageBody h1')).toHaveText('スタジオ用');
  const size = () => page.locator('#stageBody').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  const before = await size();
  await page.click('#fontUp');
  expect(await size()).toBeGreaterThan(before);
  await page.click('#stageExit');
  await expect(page.locator('#stage')).toBeHidden();
});
