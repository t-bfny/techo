// UI language. The Japanese text is the key, so the code still reads in Japanese:
//   t('{n}件を復元しました', { n: 3 })  →  ja: 3件を復元しました / en: Restored 3 notes
// A key may end in "#context" when one Japanese word needs two English ones
// ('画像#filter' → "Images"); the context is dropped for Japanese.
// Missing English falls back to the Japanese text, so nothing ever shows blank.

const LANG_KEY = 'techo.lang';

export const LANG = (() => {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'ja' || saved === 'en') return saved;
  } catch { /* storage blocked */ }
  return /^ja\b/i.test(navigator.language || '') ? 'ja' : 'en';
})();
export const LOCALE = LANG === 'ja' ? 'ja-JP' : 'en-US';
document.documentElement.lang = LANG;

export function setLang(lang) {
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage blocked */ }
}

const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;
const notes = n => plural(n, 'note');

// string with {name} slots, or a function of the values
const EN = {
  // ---------- page shell (index.html) ----------
  'ホーム画面': 'Home',
  '新規作成': 'New',
  'ショートカット': 'Shortcuts',
  'ショートカット#pin': 'Shortcut',
  '最近のノート': 'Recent notes',
  'ノート': 'Notes',
  'タスク': 'Tasks',
  'ファイル': 'Files',
  'テンプレート': 'Templates',
  'テンプレート#mark': 'Template',
  'ノートブック': 'Notebooks',
  'ノートブックを追加': 'Add notebook',
  'ゴミ箱': 'Trash',
  '書き出し': 'Export',
  '読み込み': 'Import',
  'techoのバックアップ(.json)とEvernoteの書き出し(.enex)。複数まとめて選べます': 'techo backups (.json) and Evernote exports (.enex). You can pick several at once',
  'メニュー': 'Menu',
  '連番': 'Numbered',
  'このノートブックの操作(右クリックでも開けます)': 'Notebook actions (also on right-click)',
  '検索': 'Search',
  '並べ替え': 'Sort',
  '更新日順': 'Updated',
  '作成日順': 'Created',
  '番号順': 'Number',
  'ノートブックへ移動': 'Move to notebook',
  '削除': 'Delete',
  '解除': 'Clear',
  'ライト/ダークを切り替え': 'Choose a theme',
  'すべてのノートを検索 (Ctrl+K)': 'Search all notes (Ctrl+K)',
  '今日までのタスク': 'Tasks due by today',
  '新規ノートブック': 'New notebook',
  '名前': 'Name',
  '更新': 'Updated',
  '未完了': 'Open',
  '完了': 'Done',
  'すべて': 'All',
  '画像#filter': 'Images',
  'PDF・その他': 'PDF & other',
  '「新規作成」から選べます。タイトルの〈日付〉は作った日の日付になり、チェックリストは未チェックで始まります。':
    'Pick one from "New". 〈date〉 in a title becomes the day you create the note, and checklists start unchecked.',
  'ゴミ箱を空にする': 'Empty trash',
  '削除したノートは30日たつと自動で完全に削除されます。': 'Deleted notes are removed for good after 30 days.',
  '新しいノートをタブで開く': 'New note in a new tab',
  'メモを選ぶか、新規で作成': 'Pick a note or create a new one',
  '一覧': 'List',
  'ノートブックを移動': 'Change notebook',
  'プレビュー': 'Preview',
  'その他': 'More',
  '挿入': 'Insert',
  '元に戻す': 'Undo',
  'やり直し': 'Redo',
  '段落の種類': 'Paragraph style',
  '本文': 'Text',
  '本文#placeholder': 'Write here',
  '見出し1': 'Heading 1',
  '見出し2': 'Heading 2',
  '見出し3': 'Heading 3',
  '太字 (Ctrl+B)': 'Bold (Ctrl+B)',
  '斜体 (Ctrl+I)': 'Italic (Ctrl+I)',
  '下線 (Ctrl+U)': 'Underline (Ctrl+U)',
  '取り消し線': 'Strikethrough',
  '文字色': 'Text color',
  'ハイライト': 'Highlight',
  '箇条書き': 'Bulleted list',
  '• 箇条': '• List',
  '番号付き': 'Numbered list',
  '1. 番号': '1. List',
  'チェックリスト': 'Checklist',
  '☐ チェック': '☐ Check',
  'このタスクの期限': 'Due date for this task',
  '期限': 'Due',
  '行+': 'Row+',
  '列+': 'Col+',
  '行-': 'Row−',
  '列-': 'Col−',
  'タイトル': 'Title',
  '閉じる': 'Close',
  '戻る': 'Back',
  '言語': 'Language',
  'このアプリについて': 'About techo',

  // ---------- notes, lists, pages ----------
  '無題': 'Untitled',
  'マイノート': 'My Notes',
  'ピン留め': 'Pin to top',
  'ピン留め済み': 'Pinned',
  '「{title}」': '"{title}"',
  '{n}件': v => notes(v.n),
  '{shown} / {n}件': v => `${v.shown} / ${notes(v.n)}`,
  '{n}冊': v => plural(v.n, 'notebook'),
  '未完了 {n}件': '{n} open',
  '{label}をゴミ箱に移動しました': 'Moved {label} to the trash',
  '{n}件を復元しました': v => `Restored ${notes(v.n)}`,
  'ゴミ箱は空です': 'The trash is empty',
  '復元': 'Restore',
  '完全に削除': 'Delete forever',
  '(削除したノートブック)': '(deleted notebook)',
  '{date}に削除 · あと{left}日': v => `Deleted ${v.date} · ${plural(v.left, 'day')} left`,
  '元に戻しました': 'Undone',
  '{n}件を「{nb}」へ移動しました': v => `Moved ${notes(v.n)} to "${v.nb}"`,
  '{n}件をピン留めしました': v => `Pinned ${notes(v.n)}`,
  '{n}件をピン留めから外しました': v => `Unpinned ${notes(v.n)}`,
  '{n}件をショートカットに追加しました': v => `Added ${notes(v.n)} to shortcuts`,
  '{n}件をショートカットから外しました': v => `Removed ${notes(v.n)} from shortcuts`,
  '保存しました': 'Saved',
  'ノートやノートブックの「ショートカット」で追加': 'Add notes or notebooks with "Add to shortcuts"',
  '見つかりませんでした': 'No matches',
  '一覧で{n}件すべてを見る': 'See all {n} in the list',
  'まだノートがありません': 'No notes yet',
  'ノートにチェックリストを書くと、ここにまとめて出ます': 'Checklists in your notes show up here',
  '完了したタスクはまだありません': 'No completed tasks yet',
  '期限切れ': 'Overdue',
  '今日': 'Today',
  '明日': 'Tomorrow',
  '今後': 'Upcoming',
  '期限なし': 'No due date',
  '画像': 'Image',
  'ファイル#one': 'File',
  'ノートに画像やファイルを入れると、ここに並びます': 'Images and files in your notes show up here',
  '{n}件を選択中': '{n} selected',
  'ほかのノートにも{n}件 — すべてのノートで検索': v => `${v.n} more in other notes — search all notes`,
  '昇順(古い・小さい順)': 'Ascending (oldest / smallest first)',
  '降順(新しい・大きい順)': 'Descending (newest / largest first)',
  'すべてのノート': 'All notes',
  'テンプレート: {title}': 'Template: {title}',
  '新しいウィンドウを開けませんでした。ブラウザのポップアップの設定を確認してください。': "Couldn't open a new window. Check your browser's pop-up settings.",

  // ---------- templates, copies ----------
  '〈日付〉': '〈date〉',
  '{title} のコピー': '{title} copy',
  '「{title}」を作成しました': 'Created "{title}"',
  '{n}件のコピーを作成しました': v => `Created ${plural(v.n, 'copy', 'copies')}`,
  'テンプレート「{name}」を保存しました': 'Saved template "{name}"',
  'テンプレート「{name}」を削除しますか': 'Delete template "{name}"?',
  '空のノート': 'Blank note',
  'テンプレートから': 'From a template',
  '元にしたいノートを右クリック →「テンプレートとして保存」で作れます': 'Right-click a note → "Save as template" to make one',
  '使う': 'Use',
  '編集': 'Edit',
  '作成先: {nb} · 今日なら「{title}」': 'Goes to: {nb} · today: "{title}"',
  '(現在のノートブック)': '(current notebook)',

  // ---------- notebooks ----------
  '新しいノートブックの名前': 'Name of the new notebook',
  '「{name}」の連番をオンにしました': 'Numbering on for "{name}"',
  '「{name}」の連番をオフにしました': 'Numbering off for "{name}"',
  '「{name}」をショートカットに追加しました': 'Added "{name}" to shortcuts',
  '「{name}」をショートカットから外しました': 'Removed "{name}" from shortcuts',
  'ノートブックの名前': 'Notebook name',
  'ノートブック名を「{name}」に変更しました': 'Renamed the notebook to "{name}"',
  '最後のノートブックは削除できません': "You can't delete the last notebook",
  '「{name}」を削除します。中のノート{n}件は「{to}」へ移動します。': v => `Delete "${v.name}"? Its ${notes(v.n)} will move to "${v.to}".`,
  '「{name}」を削除しますか': 'Delete "{name}"?',

  // ---------- menus ----------
  'ノートの名前': 'Note name',
  '名前を「{name}」に変更しました': 'Renamed to "{name}"',
  'techo-{n}件': 'techo-{n}-notes',
  '開く': 'Open',
  '新しいタブで開く': 'Open in new tab',
  '新しいウィンドウで開く': 'Open in new window',
  '名前を変更': 'Rename',
  'コピーを作成': 'Make a copy',
  'テンプレートとして保存': 'Save as template',
  '{n}件のコピーを作成': v => `Copy ${notes(v.n)}`,
  'ピン留めを外す': 'Unpin',
  'ショートカットに追加': 'Add to shortcuts',
  'ショートカットから外す': 'Remove from shortcuts',
  'ノートブックへ移動…': 'Move to notebook…',
  '移動先': 'Move to',
  '書き出し(HTML)': 'Export (HTML)',
  '書き出し(techo形式 .json)': 'Export (techo .json)',
  '印刷': 'Print',
  '{n}件を印刷': v => `Print ${notes(v.n)}`,
  '{n}件を削除': v => `Delete ${notes(v.n)}`,
  '連番をオンにする': 'Turn numbering on',
  '連番をオフにする': 'Turn numbering off',
  'タブを閉じる': 'Close tab',
  '「{title}」を完全に削除します。元に戻せません。': 'Delete "{title}" forever? This can\'t be undone.',
  'ゴミ箱の{n}件を完全に削除します。元に戻せません。': v => `Delete ${notes(v.n)} in the trash forever? This can't be undone.`,
  'ゴミ箱を空にしました': 'Emptied the trash',

  // ---------- editor ----------
  'YouTubeのURL': 'YouTube URL',
  'YouTubeのURLとして読めませんでした': "That doesn't look like a YouTube URL",
  'リンク先のURL(空にすると解除)': 'Link URL (leave empty to remove the link)',
  '添付: {name}': 'Attachment: {name}',
  'ファイル(PDFなど)': 'File (PDF etc.)',
  '表': 'Table',
  'YouTube動画': 'YouTube video',
  'リンク': 'Link',
  '引用': 'Quote',
  '区切り線': 'Divider',
  '目次': 'Contents',
  '見出しがありません。見出し1〜3を付けると、ここに並びます。': 'No headings yet. Headings 1–3 will be listed here.',
  '(無題の見出し)': '(untitled heading)',
  '来週': 'Next week',
  '期限を外す': 'Remove due date',
  '期限 {due}': 'Due {due}',
  'なし': 'None',
  'グレー': 'Gray',
  '赤': 'Red',
  'オレンジ': 'Orange',
  '黄': 'Yellow',
  '緑': 'Green',
  '青': 'Blue',
  '紫': 'Purple',

  // ---------- import / export ----------
  '{i}/{total}ファイル目 ': 'file {i}/{total} ',
  '取り込み中… {of}{done}件 ({pct}%)': 'Importing… {of}{done} notes ({pct}%)',
  '{nb}: {n}件を追加': v => `${v.nb}: added ${notes(v.n)}`,
  '{n}件を取り込み直し': 're-imported {n}',
  '{n}件のタスクを修復': 'repaired tasks in {n}',
  'techoで編集済み・ゴミ箱の{n}件はそのまま': 'kept {n} edited in techo or in the trash',
  '読めなかった{n}件: {list}': "couldn't read {n}: {list}",
  '、': ', ',
  '読み込み中… {of}{pct}%': 'Importing… {of}{pct}%',
  '{file}: {n}件を読み込みました': v => `${v.file}: imported ${notes(v.n)}`,
  '{file}: 読み込めませんでした({msg})': "{file}: couldn't import ({msg})",
  'techoのバックアップ': 'techo backup',
  'techoのバックアップではありません': 'This is not a techo backup',
  '[暗号化された内容]': '[encrypted content]',
  '{name} はEvernoteの書き出しファイルとして読めませんでした': "{name} couldn't be read as an Evernote export",
  '(タイトル不明)': '(unknown title)',
  '書き出し中… {pct}%  終わるまでこのタブを閉じないでください。': 'Exporting… {pct}%  Keep this tab open until it finishes.',
  '「{name}」に書き出しました': 'Exported to "{name}"',
  '書き出しに失敗しました({name}: {msg})': 'Export failed ({name}: {msg})',
  'もう一度': 'Try again',
  '{n}件のノートにEvernoteのタスクが未変換です。その.enexを「読み込み」し直すと直ります':
    v => `${notes(v.n)} still have unconverted Evernote tasks. Import that .enex again to fix them.`,

  // ---------- notices ----------
  '保存できませんでした': "Couldn't save",
  'エラー': 'error',
  '端末の空き容量が足りず、保存できませんでした。ゴミ箱を空にするか不要な画像を消してから「もう一度保存」を押してください。':
    'Not enough free space on this device to save. Empty the trash or delete images you don\'t need, then press "Save again".',
  '保存できませんでした({name})。「もう一度保存」を試し、だめなら書き出しでバックアップを取ってください。':
    'Couldn\'t save ({name}). Try "Save again"; if that fails, export a backup.',
  'もう一度保存': 'Save again',
  'データが新しい版のtechoで更新されています。再読み込みすると新しい版に切り替わります。':
    'Your data was updated by a newer version of techo. Reload to switch to it.',
  'データを開けませんでした({name})。再読み込みしてください。': "Couldn't open your data ({name}). Please reload.",
  '再読み込み': 'Reload',
  '古い版のtechoが別のタブで開いています。そのタブを閉じると、こちらが続きを始めます。':
    'An older version of techo is open in another tab. Close that tab and this one will continue.',
  '新しい版のtechoで書き出されたファイルです。techoを最新にしてから読み込んでください':
    'This file was exported by a newer version of techo. Update techo, then import it.',
  '端末の保存容量が残りわずかです({pct}%使用)。このままだと保存に失敗することがあります。':
    'This device is almost out of storage ({pct}% used). Saving may start to fail.',
  'ゴミ箱を開く': 'Open trash',
  'まだ一度も書き出し(バックアップ)をしていません。': "You haven't exported a backup yet.",
  '最後の書き出しから{days}日たちました。': v => `It's been ${plural(v.days, 'day')} since your last export.`,
  'メモはこの端末のブラウザの中にしかありません。': ' Your notes live only in this browser on this device.',
  'iPhoneでは、ホーム画面に追加しないまま7日間開かないとデータが消えることがあります。':
    ' On iPhone, data can be erased if techo isn\'t added to the Home Screen and goes unopened for 7 days.',
  'あとで': 'Later',
  '別のタブでこのノートが変更されています。このまま保存すると向こうの変更が消えるので、保存を止めました。':
    'This note was changed in another tab. Saving now would erase those changes, so saving is paused.',
  '最新を読み込む': 'Load latest',
  'こちらで上書き': 'Overwrite with this',
  'このノートは別のタブで削除(ゴミ箱へ移動)されました。': 'This note was deleted (moved to the trash) in another tab.',
  '一覧へ': 'Back to list',
  '別のタブでこのノートが変更されました。': 'This note was changed in another tab.',
  'このノートは別のタブでも開いています。両方で書くと、片方の変更が消えることがあります(上書きしそうなときは保存を止めて知らせます)。':
    "This note is also open in another tab. Writing in both can lose changes (techo pauses saving and tells you if it's about to overwrite).",

  // ---------- themes ----------
  'テーマ: {label}': 'Theme: {label}',
  'グラファイト': 'Graphite',
  'ペーパー': 'Paper',
  'ボルドー': 'Bordeaux',
  'フォレスト': 'Forest',
  'インディゴ': 'Indigo',
};

// The note made on the very first start (main.js welcome()).
const WELCOME = {
  ja: {
    title: 'techoへようこそ',
    html: '<p>techo はブラウザの中で動くメモ帳です。メモはこのブラウザの中にだけ保存され、どこにも送られません。</p>'
      + '<h2>はじめに</h2><ul>'
      + '<li><p>「新規作成」でノートを作る</p></li>'
      + '<li><p>画像は貼り付けかドラッグ、YouTube は URL を貼るだけ</p></li>'
      + '<li><p>「プレビュー」で大きな文字の読み取り専用画面(画面が消えません)</p></li>'
      + '<li><p>サイドバーの下の「書き出し」でときどきバックアップ</p></li>'
      + '</ul><h2>ほかに</h2><ul>'
      + '<li><p>Evernote からは .enex を「読み込み」で</p></li>'
      + '<li><p>iPhone / iPad は Safari の共有 →「ホーム画面に追加」から使ってください</p></li>'
      + '<li><p>詳しくはホーム画面のいちばん下の「このアプリについて」へ</p></li>'
      + '</ul><p>このノートは消してかまいません。</p>',
  },
  en: {
    title: 'Welcome to techo',
    html: '<p>techo is a notebook that runs in your browser. Your notes are stored only in this browser and are never sent anywhere.</p>'
      + '<h2>Getting started</h2><ul>'
      + '<li><p>Make a note with "New"</p></li>'
      + '<li><p>Paste or drop images; paste a YouTube link to embed the video</p></li>'
      + '<li><p>"Preview" shows the note in big, read-only text and keeps the screen on</p></li>'
      + '<li><p>Now and then, back up with "Export" at the bottom of the sidebar</p></li>'
      + '</ul><h2>Also</h2><ul>'
      + '<li><p>Coming from Evernote? "Import" your .enex files</p></li>'
      + '<li><p>On iPhone / iPad, use techo from Safari’s Share → "Add to Home Screen"</p></li>'
      + '<li><p>More under "About techo" at the bottom of the home screen</p></li>'
      + '</ul><p>Feel free to delete this note.</p>',
  },
};
export const welcomeNote = () => WELCOME[LANG];

export function t(key, vars = {}) {
  let s = LANG === 'en' ? EN[key] : undefined;
  if (s === undefined) {
    if (LANG === 'en' && import.meta.env?.DEV) console.warn('i18n: no English for', key);
    s = key.replace(/#\w+$/, '');
  }
  if (typeof s === 'function') return s(vars);
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// The static page (index.html) is written in Japanese; in English, swap its texts once at
// startup. data-i18n on an element names the key to use instead of its own text.
export function translatePage(root = document.body) {
  if (LANG === 'ja') return;
  for (const el of root.querySelectorAll('[title], [placeholder], [aria-label]')) {
    for (const attr of ['title', 'placeholder', 'aria-label']) {
      const v = el.getAttribute(attr);
      if (v && EN[v] !== undefined) el.setAttribute(attr, t(v));
    }
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const node of texts) {
    const raw = node.nodeValue;
    const key = node.parentElement?.closest('[data-i18n]')?.dataset.i18n || raw.trim();
    if (!key || EN[key] === undefined) continue;
    node.nodeValue = raw.replace(raw.trim(), t(key));
  }
}

// The default notebook is "マイノート" or "My Notes" depending on the language it was made in;
// for merging and duplicate checks they are the same notebook.
const DEFAULT_NOTEBOOK = new Set(['マイノート', 'My Notes']);
export const notebookKey = name => (DEFAULT_NOTEBOOK.has(name) ? 'マイノート' : name);

export const EN_KEYS = Object.keys(EN); // for the coverage check
