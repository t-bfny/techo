// Writes the Evernote/PDF test files next to this script. They are committed, so this only
// needs to run again when they should change:  node tests/fixtures/make-fixtures.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';

const here = new URL('.', import.meta.url);
const write = (name, data) => fs.writeFileSync(new URL(name, here), data);
const md5 = b => crypto.createHash('md5').update(b).digest('hex');
const resource = (b, mime, name) => `<resource><data encoding="base64">${b.toString('base64')}</data><mime>${mime}</mime>`
  + `<resource-attributes><file-name>${name}</file-name></resource-attributes></resource>`;
const head = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd"><en-export>';
const enNote = body => `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>${body}</en-note>`;

// sample.enex: two notes with everything techo converts — image, old and new task formats,
// code block, highlight/color, table, YouTube link, PDF attachment, encrypted block.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const pdf = Buffer.from('%PDF-1.4 test');
const full = enNote('<div>一行目&nbsp;です</div>'
  + `<div><en-media hash="${md5(png)}" type="image/png" /></div><div>画像の後の行</div>`
  + '<div><en-todo checked="true"/>済みタスク</div><div><en-todo checked="false"/>未完タスク</div>'
  + '<ul style="--en-todo:true;"><li style="--en-checked:true;"><div>新形式済み</div></li><li style="--en-checked:false;"><div>新形式未完</div></li></ul>'
  + '<div style="--en-codeblock:true;"><div>const a = 1;</div><div>console.log(a);</div></div>'
  + '<div><span style="background-color: rgb(255, 239, 158);--en-highlight:yellow;">ハイライト</span>と<span style="color:rgb(229, 72, 77);">赤字</span></div>'
  + '<table><tr><td><div>A1</div></td><td><div>B1</div></td></tr><tr><td><div>A2</div></td><td><div>B2</div></td></tr></table>'
  + '<div><a href="https://www.youtube.com/watch?v=jNQXAC9IVRw">https://www.youtube.com/watch?v=jNQXAC9IVRw</a></div>'
  + '<div>参考 <a href="https://example.com">example</a></div>'
  + `<div><en-media hash="${md5(pdf)}" type="application/pdf" /></div>`
  + '<en-crypt hint="h">xxxx</en-crypt><div><br/></div><div>最終行</div>');
const sampleNote = (title, t) => `<note><title>${title}</title><created>${t}</created><updated>${t}</updated><tag>リハ</tag>`
  + `<content><![CDATA[${full}]]></content>${resource(png, 'image/png', 'dot.png')}${resource(pdf, 'application/pdf', '譜面.pdf')}</note>`;
write('sample.enex', `${head}${sampleNote('全部入り', '20250101T010203Z')}${sampleNote('二件目', '20250102T010203Z')}</en-export>`);

// evil.enex: things an imported note must never be able to run.
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>parent.__pwned="svg"</script></svg>');
const html = Buffer.from('<html><body><script>opener&&(opener.__pwned="html")</script>x</body></html>');
const evil = enNote('<div>普通の行</div><div><img src="x" onerror="window.__pwned=1"/></div>'
  + '<div><a href="javascript:window.__pwned=2">悪いリンク</a></div><script>window.__pwned=3</script>'
  + '<div onclick="window.__pwned=4" style="color:red">クリック</div><iframe src="https://evil.example/"></iframe>'
  + '<div><a href="https://www.youtube.com/watch?v=jNQXAC9IVRw">https://www.youtube.com/watch?v=jNQXAC9IVRw</a></div>'
  + '<div><en-todo checked="true"/>タスク</div>'
  + `<div><en-media hash="${md5(html)}" type="text/html"/></div><div><en-media hash="${md5(svg)}" type="image/svg+xml"/></div>`);
write('evil.enex', '<?xml version="1.0" encoding="UTF-8"?><en-export><note><title>悪意あるノート</title>'
  + '<created>20250101T000000Z</created><updated>20250101T000000Z</updated>'
  + `<content><![CDATA[${evil}]]></content>${resource(html, 'text/html', 'page.html')}${resource(svg, 'image/svg+xml', 'pic.svg')}</note></en-export>`);

// backup-v1.json: the backup format of v0.14.1 and earlier (one JSON document).
write('backup-v1.json', JSON.stringify({
  app: 'techo', version: 1, exportedAt: Date.UTC(2026, 8, 1),
  notebooks: [{ id: 'nbOld', name: 'Tech', createdAt: 2, numbered: true }],
  notes: [
    { id: 'v1a', title: 'tech-258 前', html: '<p>旧形式のノート</p><img src="att:v1img">', text: '旧形式のノート', notebookId: 'nbOld', createdAt: 2000, updatedAt: 9000 },
    { id: 'v1b', title: 'tech-259 後', html: '<p>二つ目</p>', text: '二つ目', notebookId: 'nbOld', createdAt: 2001, updatedAt: 9001 },
  ],
  attachments: [{ id: 'v1img', type: 'image/png', name: 'dot.png', createdAt: 2000, data: `data:image/png;base64,${png.toString('base64')}` }],
}));

// score.pdf: any file to attach through Insert → File.
write('score.pdf', '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
