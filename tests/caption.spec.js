import fs from 'node:fs';
import { test, expect, newNote, readStore, saved, seed, note } from './helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('an image gets a caption: typed under it, saved as <figure>, shown in preview', async ({ page }) => {
  const file = test.info().outputPath('dot.png');
  fs.writeFileSync(file, PNG);
  await page.goto('/#list');
  await newNote(page, '寄稿');
  await page.locator('.tiptap').click();
  await page.click('[data-pop="insert"]');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#popover .menu-item:text-is("画像")')]);
  await chooser.setFiles(file);
  const figure = page.locator('.tiptap figure.img-figure');
  await expect(figure.locator('img')).toBeVisible();
  const caption = figure.locator('.img-caption');
  await expect(caption).toBeHidden(); // no empty box under every image

  await figure.locator('img').click();
  await expect(caption).toBeVisible();
  await caption.click();
  await page.keyboard.type('図1 スタジオの配置');
  await page.keyboard.press('Enter'); // on to the text below
  await page.keyboard.type('本文の続き');
  await expect(page.locator('.tiptap > p').filter({ hasText: '本文' })).toHaveText('本文の続き');
  await expect(caption).toHaveValue('図1 スタジオの配置');
  await expect(caption).toBeVisible(); // a caption stays visible once written
  await saved(page);

  const [n] = await readStore(page, 'notes');
  expect(n.html).toMatch(/<figure><img src="att:[a-z0-9]+"[^>]*><figcaption>図1 スタジオの配置<\/figcaption><\/figure>/);
  expect(n.text).toContain('図1 スタジオの配置'); // findable in search

  await page.reload();
  await page.click('#noteList li:has-text("寄稿")');
  await expect(page.locator('.tiptap .img-caption')).toHaveValue('図1 スタジオの配置');
  await page.click('#stageBtn');
  await expect(page.locator('#stageBody figure figcaption')).toHaveText('図1 スタジオの配置');
});

test('images without a caption are stored as before', async ({ page }) => {
  await seed(page, {
    notebooks: [{ id: 'nb1', name: 'マイノート', createdAt: 1 }],
    notes: [note('a', '古い画像', { html: '<p>前</p><img src="att:img1"><p>後</p>' })],
    attachments: [{ id: 'img1', type: 'image/png' }],
  });
  await page.goto('/#n/a');
  await expect(page.locator('.tiptap figure img')).toHaveCount(1);
  await page.locator('.tiptap p').last().click();
  await page.keyboard.type('追記');
  await saved(page);
  const [n] = await readStore(page, 'notes');
  expect(n.html).toContain('<img src="att:img1">');
  expect(n.html).not.toContain('<figure');
});

test('align an image left, center or right; kept with and without a caption', async ({ page }) => {
  await seed(page, {
    notebooks: [{ id: 'nb1', name: 'マイノート', createdAt: 1 }],
    notes: [note('a', '画像の配置', { html: '<p>前</p><img src="att:img1"><p>後</p>' })],
    attachments: [{ id: 'img1', type: 'image/svg+xml', content: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="#456"/></svg>' }],
  });
  await page.goto('/#n/a');
  await expect(page.locator('#imageTools')).toBeHidden();
  const figure = page.locator('.tiptap figure.img-figure');
  await figure.locator('img').click();
  await expect(page.locator('#imageTools')).toBeVisible();
  await expect(page.locator('#imageTools [data-align="left"]')).toHaveClass(/on/);

  await page.click('#imageTools [data-align="center"]');
  await expect(figure).toHaveAttribute('data-align', 'center');
  await expect(page.locator('#imageTools [data-align="center"]')).toHaveClass(/on/);
  const offset = () => figure.locator('img').evaluate(img => img.getBoundingClientRect().left - img.closest('.tiptap').getBoundingClientRect().left);
  expect(await offset()).toBeGreaterThan(100);
  await saved(page);
  expect((await readStore(page, 'notes'))[0].html).toContain('<img src="att:img1" data-align="center">');

  await page.click('#imageTools [data-align="right"]');
  await figure.locator('.img-caption').click();
  await page.keyboard.type('右の図');
  await saved(page);
  expect((await readStore(page, 'notes'))[0].html).toMatch(/<figure data-align="right"><img src="att:img1"><figcaption>右の図<\/figcaption><\/figure>/);
  await page.click('#stageBtn');
  const stageImg = page.locator('#stageBody figure[data-align="right"] img');
  await expect(stageImg).toBeVisible();
  await page.click('#stageExit');

  await figure.locator('img').click();
  await page.click('#imageTools [data-align="left"]');
  await expect(figure).not.toHaveAttribute('data-align', /./);
  expect(await offset()).toBeLessThan(5);
});
