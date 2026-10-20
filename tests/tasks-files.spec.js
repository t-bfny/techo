import { test, expect, newNote, fixture } from './helpers.js';

const iso = d => new Intl.DateTimeFormat('en-CA').format(d);

test('due dates, the Tasks page, checking from it, and the home screen', async ({ page }) => {
  await page.goto('/#list');
  await newNote(page, 'リハ準備');
  await page.keyboard.press('Enter');
  await page.click('[data-cmd="taskList"]');
  const k = page.keyboard;
  const nextTask = async () => { await page.waitForTimeout(100); await k.press('End'); await page.waitForTimeout(100); await k.press('Enter'); };
  await k.type('譜面を印刷');
  await expect(page.locator('#dueBtn')).toBeVisible();
  await page.click('#dueBtn'); await page.click('#popover .menu-item:has-text("今日")');
  await expect(page.locator('#dueBtn')).toHaveText(/^期限 /);
  await nextTask(); await k.type('スタジオ予約');
  await page.click('#dueBtn'); await page.fill('.due-input', '2020-09-20');
  await nextTask(); await k.type('弦を張り替える');
  await page.click('#dueBtn'); await page.click('#popover .menu-item:has-text("明日")');
  await nextTask(); await k.type('いつかやる');
  await expect(page.locator('.tiptap li[data-due]')).toHaveCount(3); // a new task does not inherit the due date

  await page.click('.side-item[data-go="tasks"]');
  const groups = page.locator('#taskGroups section h2');
  await expect(groups).toHaveText(['期限切れ 1', '今日 1', '明日 1', '期限なし 1']);
  await page.locator('.task-row', { hasText: 'スタジオ予約' }).locator('input').check();
  await expect(groups).toHaveText(['今日 1', '明日 1', '期限なし 1']);
  await page.click('[data-taskmode="done"]');
  await expect(page.locator('#taskGroups .task-t')).toHaveText(['スタジオ予約']);

  await page.locator('.task-row', { hasText: 'スタジオ予約' }).locator('.task-note').click();
  await expect(page.locator('.tiptap li[data-checked="true"]')).toHaveText(/スタジオ予約/);
  await expect(page.locator('.tiptap li[data-due]').first()).toHaveAttribute('data-due', iso(new Date()));

  await page.click('.home-btn');
  await expect(page.locator('#homeTasks .task-t')).toHaveText(['譜面を印刷']);
});

test('attach a PDF; the Files page lists it and opens its note', async ({ page }) => {
  await page.goto('/#list');
  await newNote(page, '譜面メモ');
  await page.locator('.tiptap').click();
  await page.click('[data-pop="insert"]');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#popover .menu-item:has-text("ファイル")')]);
  await chooser.setFiles(fixture('score.pdf'));
  await expect(page.locator('.tiptap a', { hasText: '添付: score.pdf' })).toBeVisible();
  await page.click('.side-item[data-go="files"]');
  await expect(page.locator('.file-tile .file-name')).toHaveText(['score.pdf']);
  await page.click('[data-filemode="image"]');
  await expect(page.locator('.file-tile')).toHaveCount(0);
  await page.click('[data-filemode="other"]');
  await page.click('.file-tile .file-thumb');
  await expect(page.locator('#titleInput')).toHaveValue('譜面メモ');
});
