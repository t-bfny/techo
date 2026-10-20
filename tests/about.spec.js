import { test, expect, seed, note } from './helpers.js';

test.describe('first start', () => {
  test.use({ welcome: true });

  test('a fresh browser gets one welcome note, only once', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#homeRecent .card-t')).toHaveText(['techoへようこそ']);
    await page.goto('/#list');
    await page.click('#noteList li');
    await expect(page.locator('.tiptap')).toContainText('どこにも送られません');
    await expect(page.locator('#notice')).toBeHidden(); // no backup nagging before anything is written
    await expect(page.locator('#countTasks')).toHaveText('');
    await page.click('#deleteBtn');
    await page.reload();
    await expect(page.locator('#countAll')).toHaveText('0');
  });

  test('no welcome note next to existing notes', async ({ page }) => {
    await seed(page, { notebooks: [{ id: 'nb1', name: 'マイノート', createdAt: 1 }], notes: [note('a', '前からあるメモ')] });
    await page.goto('/');
    await expect(page.locator('#homeRecent .card-t')).toHaveText(['前からあるメモ']);
  });

  test.describe('in English', () => {
    test.use({ locale: 'en-US' });
    test('the welcome note is in English', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('#homeRecent .card-t')).toHaveText(['Welcome to techo']);
    });
  });
});

test('About: from the home screen and the version number, says where data lives, links to Issues', async ({ page }) => {
  await page.goto('/');
  await page.click('.home-foot button');
  await expect(page.locator('#aboutView')).toBeVisible();
  await expect(page.locator('#aboutView h2:visible')).toContainText(['メモはどこに保存されるか', 'バックアップ']);
  await expect(page.locator('#aboutView a:visible', { hasText: 'GitHub の Issues' })).toHaveAttribute('href', 'https://github.com/t-bfny/techo/issues');
  await expect(page.locator('#aboutVersion')).toHaveText(/^v\d+\.\d+\.\d+$/);
  await page.click('.home-btn');
  await page.click('#appVersion');
  await expect(page).toHaveURL(/#about$/);
});

test.describe('About in English', () => {
  test.use({ locale: 'en-US' });
  test('shows only the English text', async ({ page }) => {
    await page.goto('/#about');
    await expect(page.locator('#aboutView h2:visible').first()).toHaveText('Where your notes are stored');
    await expect(page.locator('#aboutView [lang="ja"]')).toBeHidden();
  });
});

test('third-party licenses are published with the app', async ({ page }) => {
  const res = await page.goto('/third-party-licenses.txt');
  expect(res.status()).toBe(200);
  const text = await res.text();
  for (const name of ['@tiptap/core', 'prosemirror-view', 'dompurify', 'workbox-window', 'Space Grotesk']) expect(text).toContain(name);
});
