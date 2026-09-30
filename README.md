# techo

Evernote代替の自作メモPWA。PC・スマホ・(将来の)タブレットで同じものを使う。

## 起動

```
npm install
npm run dev      # 開発サーバー(LAN公開)
npm run build    # dist/ に本番ビルド
npm run preview  # ビルド結果の確認
```

## 今できること (v0.1)

- メモの作成・編集・自動保存(端末内のIndexedDB)
- 全文検索(スペース区切りでAND)
- 画像の貼り付け・ドロップ・ファイル選択(長辺2000pxに縮小して保存)
- リンク自動化(日本語の直後のURLも可)
- YouTube URLを貼ると埋め込み(youtu.be の共有リンクも可)
- 表(表の中にいる間だけ 行+/列+/行-/列- が出る)
- 本番モード: 読み取り専用、大きい文字(A-/A+)、画面が消えない
- 書き出し/読み込み(JSONバックアップ。新しい方が勝つ)
- オフライン動作(Service Worker)
- 幅760px以下は1画面、それ以上は一覧+本文の2画面

## データの形

- `notes`: `{id, title, html, text, createdAt, updatedAt}`
- `attachments`: `{id, blob, type, createdAt}`。本文HTMLでは `att:ID` として参照する

## この先

1. スマホからHTTPSで開けるように公開(PWAはHTTPS必須)
2. Evernoteの `.enex` 取り込み
3. Google Drive同期
4. タブレット: 楽譜PDFとメモの並べ表示
