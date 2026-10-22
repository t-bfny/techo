import { test, expect, seed, note, readStore, saved } from './helpers.js';

const body = '<p>AIが書いた文章です。AIらしさを消したい。</p><p><strong>ai</strong>という小文字も、Ai も。</p>'
  + '<p>次の段落にも AI。</p><p>2026年10月22日と2026年1月5日。</p>';

test.beforeEach(async ({ page }) => {
  await seed(page, {
    notebooks: [{ id: 'nb1', name: 'マイノート', createdAt: 1 }],
    notes: [note('a', '寄稿の下書き', { html: body }), note('b', '別のノート', { html: '<p>AIはここにも</p>', updatedAt: 1 })],
  });
  await page.goto('/#n/a');
  await expect(page.locator('#titleInput')).toHaveValue('寄稿の下書き');
});

const count = page => page.locator('#findCount');
const hits = page => page.locator('.tiptap .find-hit');

test('Ctrl+F finds in the open note only, highlights every hit and steps through them', async ({ page }) => {
  await page.locator('.tiptap').click();
  await page.keyboard.press('Control+Home'); // the search starts from the hit nearest the cursor
  await page.keyboard.press('Control+f');
  await expect(page.locator('#findInput')).toBeFocused();
  await page.keyboard.type('AI');
  await expect(count(page)).toHaveText('1 / 5'); // case-insensitive by default: ai and Ai too
  await expect(hits(page)).toHaveCount(5);
  await expect(page.locator('.tiptap .find-current')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(count(page)).toHaveText('2 / 5');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.press('Shift+Enter');
  await expect(count(page)).toHaveText('5 / 5'); // wraps around
  await page.click('#findCase');
  await expect(count(page)).toHaveText(/\/ 3$/);
  await page.fill('#findInput', '存在しない言葉');
  await expect(count(page)).toHaveText('見つかりません');
  await expect(page.locator('#replaceAllBtn')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('#findBar')).toBeHidden();
  await expect(hits(page)).toHaveCount(0);
});

test('replace one, then all; formatting stays; Ctrl+Z undoes "replace all" in one step', async ({ page }) => {
  await page.click('#findBtn');
  await page.fill('#findInput', 'AI');
  await page.fill('#replaceInput', '生成AI');
  await page.click('#findCase'); // exact "AI" only
  await expect(count(page)).toHaveText('1 / 3');
  await page.click('#replaceOne');
  await expect(page.locator('.tiptap p').first()).toHaveText('生成AIが書いた文章です。AIらしさを消したい。');
  await expect(count(page)).toHaveText(/\/ 3$/); // 生成AI itself contains AI
  await page.fill('#findInput', 'ai');
  await page.click('#findCase'); // back to any case
  await page.fill('#replaceInput', 'エーアイ');
  await page.click('#replaceAllBtn');
  await expect(page.locator('#toastMsg')).toContainText('件を置換しました');
  await expect(page.locator('.tiptap')).not.toContainText(/ai/i);
  await expect(page.locator('.tiptap strong')).toHaveText('エーアイ'); // the bold word stays bold
  await saved(page);
  const [stored] = (await readStore(page, 'notes')).filter(n => n.id === 'a');
  expect(stored.text).not.toMatch(/ai/i);
  const other = (await readStore(page, 'notes')).find(n => n.id === 'b');
  expect(other.html).toContain('AIはここにも'); // other notes are never touched

  await page.locator('.tiptap p').last().click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.tiptap')).toContainText('AIらしさ'); // all of them back at once
});

test('regular expressions with $1, and Enter in "replace with" replaces and moves on', async ({ page }) => {
  await page.locator('.tiptap').click();
  await page.keyboard.press('Control+h');
  await page.keyboard.type('(\\d{4})年(\\d{1,2})月');
  await page.click('#findRegex');
  await expect(count(page)).toHaveText(/\/ 2$/);
  await page.fill('#replaceInput', '$1/$2/');
  await page.locator('#replaceInput').press('Enter');
  await page.locator('#replaceInput').press('Enter');
  await expect(page.locator('.tiptap p').last()).toHaveText('2026/10/22日と2026/1/5日。');
  await page.fill('#findInput', '(');
  await expect(count(page)).toHaveText('正規表現の書き方が正しくありません');
});

test('the search follows you to another note', async ({ page }) => {
  await page.click('#findBtn');
  await page.fill('#findInput', 'AI');
  await expect(count(page)).toHaveText('1 / 5');
  await page.goto('/#n/b');
  await expect(page.locator('#titleInput')).toHaveValue('別のノート');
  await expect(count(page)).toHaveText('1 / 1');
});
