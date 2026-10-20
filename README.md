# techo

アカウント不要のブラウザ版メモ帳です。オフライン動作可能。
端末にメモは保存され他ユーザとの干渉はありません。
現在、複数端末連携には未対応です。

**→ https://techo.t-bfny.workers.dev**

[English](README.en.md)

## できること

- 画像の貼り付け・ドラッグ、YouTube 埋込み、表、チェックリスト、文字色・ハイライト、目次、インデント
- ノートブック、ショートカット、ピン留め、タブ、別ウィンドウ、ノートブックごとの連番
- タスク：チェックリストに期限を付けると、全ノートのタスクが「期限切れ / 今日 / 明日 / 今後」にまとまる
- 高速ノート全検索(Ctrl+K)。ひらがな・カタカナ、全角・半角を区別しない
- プレビュー：大きな文字の読み取り専用画面。表示中は画面が消えない。楽譜PDF閲覧も可能
- テンプレート、ゴミ箱(30日)、印刷、5 つのテーマ、日本語 / English
- Evernote の .enex をそのまま読み込める(画像・添付・チェックリスト・表など)
- PC・スマホ・タブレット対応。ホーム画面にアイコン追加も可。

## データとプライバシー

- メモ・画像・添付は、使っているブラウザの中(IndexedDB)にだけ保存されます。techo にはデータを受け取るサーバーがなく、開発者も含めて誰にも送られません。
- アクセス解析・広告・追跡用の Cookie はありません。
- 外とつながるのは、YouTube の埋め込みを表示するとき(youtube-nocookie.com)と、ネット上の画像を URL で貼ったときだけです。
- 端末どうしの同期はまだありません。サイドバーの「書き出し」で 1 つのファイルにバックアップし、別の端末では「読み込み」で戻せます。
- ブラウザのデータを消すとメモも消えます。ときどき書き出してください(7 日たつと techo がお知らせします)。iPhone / iPad では、Safari の「ホーム画面に追加」から使ってください。

## 不具合・要望

[Issues](https://github.com/t-bfny/techo/issues) へどうぞ。

## 開発

```
npm install
npm run dev        # 開発サーバー
npm test           # ビルドして全テスト(Playwright、1 分ほど)
npm run test:quick # 時間のかかる 450MB 書き出しテストを除く
npm run deploy     # Cloudflare Workers へ公開(公開する人だけ)
```

- 構成:Vite、[Tiptap](https://tiptap.dev/)(エディタ)、IndexedDB、vite-plugin-pwa(オフライン)、DOMPurify。サーバー側のコードはなく、`dist/` を静的に配信するだけ
- テストは手元にインストール済みの Chrome で動きます。Chrome がなければ `npx playwright install chromium` のあと `PW_BUNDLED=1 npm test`。push すると GitHub Actions でも全テストが走ります
- `npm run preview` とテストは、`public/_headers` と同じセキュリティヘッダー(CSP)の下で動きます。公開版に対して流すときは `BASE_URL=https://… npx playwright test`
- 画面の文言は日本語の文がそのまま翻訳キーです(`src/i18n.js`)。英語を足し忘れた文言は日本語のまま表示されます

### ファイル

| | |
|---|---|
| `src/main.js` | 画面・ルーティング・ノートの操作 |
| `src/db.js` | IndexedDB(保存の形と移行の手順) |
| `src/backup.js` | 書き出し・読み込み |
| `src/enex.js` | Evernote の取り込み |
| `src/sanitize.js` | 取り込んだ HTML の無害化 |
| `src/i18n.js` | 日本語 / 英語 |
| `tests/` | Playwright のテスト。試験用ファイルは `tests/fixtures/` |

### データの形式を変えるとき

1. `src/db.js` の `UPGRADES` に次の番号の手順を 1 つ足す(出荷済みの手順は書き換えない)。ブラウザに残っている版から順に全部の手順が 1 回のトランザクションで走り、途中で失敗すると元のまま残る
2. `tests/migration.spec.js` に「1 つ前の版で作ったデータを開くテスト」を足す
3. バックアップファイルの形式を変えるなら `src/backup.js` の `BACKUP_VERSION` を上げ、古い形式も読めるようにしておく

古い techo が新しい版のデータを開いたとき(キャッシュに残った古い版など)は、何も書き込まずに再読み込みを案内します。新しい版で書き出したバックアップを古い版で読もうとしたときも、書き込む前に断ります。

変更の履歴は [CHANGELOG.md](CHANGELOG.md) にあります。

## ライセンス

[MIT](LICENSE)。使っているライブラリとフォントのライセンスは、ビルド時に `public/third-party-licenses.txt` にまとめられ、アプリの「このアプリについて」から見られます。
