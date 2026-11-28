# Make It a Quote Webメーカー

アバター画像とテキストから引用画像（1200×630 PNG）を生成する Web ツール。

| 項目 | 内容 |
|---|---|
| バージョン | 1.0.0 |
| 状態 | 公開中 |
| 公開先 | [miaq.vercel.app](https://miaq.vercel.app) |
| 実装 | HTML / CSS / JavaScript（静的サイト）＋ Windows版（.NET 8 / WinForms） |
| 更新履歴 | [CHANGELOG.md](CHANGELOG.md) |

## 📖 概要

Discord Bot「Make It a Quote」の描画処理をブラウザ Canvas に移植したもの。
レイアウト定数・グレースケール式・禁則折り返し・フォントサイズ候補は Bot版と同一。

## ✨ 機能

- アバター画像はファイル選択またはドラッグ＆ドロップで読み込み、すべてブラウザ内で処理する（サーバーに送信しない）
- アバター未指定の場合は、表示名の頭文字から代替画像を自動生成する
- 引用文は最大300文字。フォントは Bot版と同じ Zen Old Mincho / Noto Sans JP を同梱
- 引用文は自動縮小（62px→27px）＋禁則折り返しで 1200×630 に収める
- ダーク / ライトテーマ切り替え（localStorage に保存）
- PWA 対応（Service Worker でフォント含めキャッシュし、オフラインでも動く）
- サンプル入力でそのまま試せる

## 📝 使い方

1. アバター画像を選ぶ（任意）
2. 表示名とユーザー名を入れる
3. 引用文を入れて「画像を生成」を押す
4. プレビューを確認して「PNGをダウンロード」で保存する（ファイル名は `quote-<ユーザー名>.png`）

## 🪟 Windows 版

`windows/` フォルダに、同じ仕様の Windows アプリ（.NET 8 / WinForms）があります。Web 版と同じレイアウト（1200×630、グレースケール化したアバター＋右フェード、禁則折り返しと自動縮小）で引用画像を生成し、PNG で保存できます。アバター画像はファイル選択またはドラッグ＆ドロップで読み込めます。

- ビルド: `windows/build.bat`（Windows）または `windows/build.sh` で `windows/dist/Miaq.exe` を生成
- Web 版との違い: 引用文フォントは Zen Old Mincho の代わりに Yu Gothic UI を使用。隠し機能（Discordアイコン取得）は未収録

## 📋 技術メモ

ビルド不要の静的サイト。そのまま Vercel にデプロイできる。
描画の純粋ロジックは `js/quote.js` に分離してあり、`npm test`（Node 標準のテストランナー、依存なし）で折り返し・自動縮小・グレースケール式などを検証する。

### 隠し機能: Discordアイコン取得

通常の画面には表示されないパネルから、Discord のユーザーIDを指定してアイコン画像を取得し、そのままアバターに設定できる（表示名・ユーザー名も自動入力）。

- パネルの出し方: キーボードで「discord」と打つ／フッターのクレジットを2秒以内に5回タップ／URL パラメータ `?uid=<ユーザーID>`（自動取得まで実行）
- ユーザー情報の照会には外部API（japi.rest）を使い、画像は Discord CDN から直接読み込む。照会に送られるのは入力したユーザーIDだけ
- アイコン未設定のユーザーは、ID から決まるデフォルトアイコンを返す

## 📁 ファイル構成

| パス | 役割 |
|---|---|
| `index.html` | ページ本体 |
| `style.css` | スタイル（ダーク/ライトテーマ） |
| `js/quote.js` | 描画コア（折り返し・自動縮小・グレースケール・描画本体） |
| `js/app.js` | 画面の配線（入力・生成・ダウンロード・隠し機能・テーマ） |
| `tests/` | 純粋ロジックの単体テスト（`npm test`） |
| `fonts/` | 同梱フォント（Zen Old Mincho / Noto Sans JP） |
| `sw.js` | Service Worker |
| `manifest.webmanifest` | PWA マニフェスト |
| `icons/` | アイコン |
| `windows/` | Windows 版（.NET 8 / WinForms） |
| `vercel.json` | Vercel の設定（セキュリティヘッダ・フォントの長期キャッシュ） |
