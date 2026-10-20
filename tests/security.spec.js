// Runs under the site's Content-Security-Policy (vite preview serves public/_headers).
import { test, expect, seed, note, readStore, importFiles } from './helpers.js';

test('the preview server sends the same security headers as the site', async ({ page }) => {
  const res = await page.goto('/');
  expect(res.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
});

// What a note could use to run code, anywhere in the page the user sees.
const liveHazards = page => page.evaluate(() => [...document.querySelectorAll('*')].flatMap(el => [...el.attributes]
  .filter(a => /^on/i.test(a.name) || /^\s*javascript:/i.test(a.value))
  .map(a => `<${el.localName} ${a.name}="${a.value}">`)).concat([...document.querySelectorAll('script:not([src]), iframe:not([src*="youtube"])')].map(e => e.outerHTML.slice(0, 80))));

test('nothing in an imported note can run, wherever the note is shown', async ({ page }) => {
  // Headless Chromium also reports inline handlers inside documents techo only parses
  // (DOMParser, never shown, scripting disabled there), so those reports are not counted;
  // the live page itself is checked for handlers below, and every other violation fails.
  const violations = [];
  page.on('console', m => {
    if (/Content Security Policy|Refused/.test(m.text()) && !/inline event handler/.test(m.text())) violations.push(m.text());
  });
  await page.goto('/#list');
  await importFiles(page, ['evil.enex']);

  const [n] = (await readStore(page, 'notes')).filter(x => x.title === '悪意あるノート');
  expect(n.html).not.toMatch(/onerror|onclick|javascript:|<script|evil\.example/i);
  expect(n.html).toContain('data-youtube-video'); // the good parts survive
  expect(n.html).toContain('data-checked="true"');

  // a note saved by an older version, before sanitizing existed
  await seed(page, { notes: [note('raw', '古い取り込み', { html: '<p>本文</p><img src="x" onerror="window.__pwned=10"><a href="javascript:window.__pwned=11">x</a>' })] });
  await page.goto('/#list');
  await page.evaluate(() => { window.print = () => {}; });
  for (const title of ['悪意あるノート', '古い取り込み']) {
    await page.click(`#noteList li:has-text("${title}")`);
    await expect(page.locator('#titleInput')).toHaveValue(title);
    expect(await liveHazards(page), `editor: ${title}`).toEqual([]);
    await page.keyboard.press('Control+p');
    await expect(page.locator('#printArea article')).toHaveCount(1);
    expect(await liveHazards(page), `print: ${title}`).toEqual([]);
    await page.click('#stageBtn');
    expect(await liveHazards(page), `preview: ${title}`).toEqual([]);
    await page.click('#stageExit');
  }
  await page.click('#noteList li:has-text("悪意あるノート")');
  // attachments that could run code inside techo are handed over as downloads
  const types = await page.evaluate(() => Promise.all([...document.querySelectorAll('.tiptap a[href^="blob:"]')]
    .map(async a => [a.textContent, (await (await fetch(a.href)).blob()).type])));
  expect(types).toEqual(expect.arrayContaining([['添付: page.html', 'application/octet-stream']]));
  expect(await page.evaluate(() => window.__pwned ?? 'none')).toBe('none');
  expect(violations).toEqual([]);
});
