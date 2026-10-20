# techo

A notebook that runs in your browser. No account, works offline, and your notes stay on your device.

**→ https://techo.t-bfny.workers.dev**

[日本語](README.md)

## Features

- Paste or drop images, embed YouTube videos (just paste the link), tables, checklists, text color and highlight, table of contents, indentation
- Notebooks, shortcuts, pin to top, tabs, separate windows, per-notebook numbering
- Tasks: give a checklist item a due date and every task across your notes is grouped into overdue / today / tomorrow / upcoming
- Search all notes (Ctrl+K)
- Preview: big, read-only text that keeps the screen on (for reading on a music stand or in a rehearsal room)
- Templates, trash (30 days), printing, five themes, Japanese / English
- Imports Evernote .enex files as they are (images, attachments, checklists, tables…)
- Works on computers, phones and tablets; add it to your home screen and it behaves like an app

## Your data and privacy

- Notes, images and attachments are stored only in your browser (IndexedDB). techo has no server that receives data; nothing is sent to anyone, including the developer.
- No analytics, no ads, no tracking cookies.
- The only outside connections: showing an embedded YouTube video (youtube-nocookie.com), and images you paste as a web address.
- There is no sync between devices yet. "Export" in the sidebar backs everything up into one file; "Import" brings it back on another device.
- Clearing your browser data deletes your notes. Export now and then — techo reminds you after 7 days. On iPhone / iPad, use techo from Safari's "Add to Home Screen".

## Bugs and requests

Please open an [issue](https://github.com/t-bfny/techo/issues).

## Development

```
npm install
npm run dev        # dev server
npm test           # build, then every test (Playwright, about a minute)
npm run test:quick # skip the slow 450 MB export test
npm run deploy     # publish to Cloudflare Workers (maintainer only)
```

- Vite, [Tiptap](https://tiptap.dev/), IndexedDB, vite-plugin-pwa, DOMPurify. No server code: `dist/` is served as static files.
- Tests use your installed Chrome. Without Chrome: `npx playwright install chromium`, then `PW_BUNDLED=1 npm test`. GitHub Actions runs them on every push.
- `npm run preview` and the tests run under the same security headers (CSP) as the site (`public/_headers`). To test a deployed copy: `BASE_URL=https://… npx playwright test`.
- UI text uses the Japanese sentence itself as the translation key (`src/i18n.js`); missing English falls back to Japanese.
- Changing how data is stored: add the next step to `UPGRADES` in `src/db.js` (never edit a shipped step) and a test in `tests/migration.spec.js` that opens data from the previous version. Backup file format: `BACKUP_VERSION` in `src/backup.js`.

## License

[MIT](LICENSE). Licenses of bundled libraries and the font are collected into `public/third-party-licenses.txt` at build time and linked from "About techo" in the app.
