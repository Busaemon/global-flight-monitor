# Windows・VS Code 導入ガイド

## 1. 必要な環境

Node.js **24.5.0 以上**、npm、Git、VS Code、PowerShell。追加の DB サーバーや `sqlite3` CLI は不要。通常のローカル開発に Docker は不要で、HTTPS 公開例を使用する場合に Docker / Compose を用意する。

```powershell
node --version
npm.cmd --version
git --version
Get-Location
```

`npm.cmd` は Windows の npm 実行ファイルで、PowerShell の `npm.ps1` の実行ポリシーに依存しない。この手順は Linux での Node.js 導入 / ファイル配置を検証した構成に基づく。Windows ネイティブでの実行記録は [テスト仕様](07-test-specification.md) を確認する。

## 2. 既存フォルダーへ配置する

VS Code で既存の `global-flight-monitor` を開く。このアプリを起動していたら `Ctrl+C` で停止してから実行する。[START-HERE](../START-HERE.md) の PowerShell 一括コマンドで GitHub の `main` を取得し、必要なソースと資料を既存フォルダーへ追加する。ZIP は必要ない。

レビュー中の PR の変更は `main` に含まれるとは限らない。PR のブランチを確認し、取得コマンドの `--branch main` を対応するブランチへ置き換える。

配置処理は `.git`・`.env`・`data/`・独自ファイルを保持する。同名の変更前ファイルを一時フォルダーへ保存し、その場所を表示する。シンボリックリンクや通常と異なる対象は配置前に検証する。ファイル配置はローカル Git 履歴の同期ではない。今後の開発は [GitHub ガイド](10-github-guide.md) に従う。

## 3. 初回の準備

`package.json` のあるフォルダーで実行する。

```powershell
Test-Path .\package.json
npm.cmd run setup
```

`setup` は Node / SQLite の確認、`npm ci`、DB 初期化、型検査、画面 / サーバー / PWA のビルド、サイズ予算の確認を順に行う。既存 DB を削除しない。DB v1 はデータを保持して v2 へ移行する。既存 DB に重要な履歴がある場合は、アプリ停止後のバックアップを先に取る。

任意のローカル設定は、既存 `.env` を保持したまま作る。

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

`.env` の OAuth ID / secret はサーバー専用。未用意なら空のままで匿名利用する。匿名の全世界更新は標準 15 分。OAuth は正式クライアントを発行して両値を設定し、再起動して確認する。チャットや GitHub へ値を送らない。

## 4. 開発起動

```powershell
npm.cmd run dev
```

画面はご自身の PC の `http://localhost:5173`、API は 3001。ライブが初期表示で、出典・観測時刻・取得時刻・次回予定を確認する。実データが使えない場合も自動で合成データにならない。明示的にデモを選ぶと操作確認できる。

停止は起動したターミナルの `Ctrl+C`。次回は `npm.cmd run dev`。開発は `.env.example` の `HOST=127.0.0.1` を基本とする。LAN への公開が必要なら自分のネットワークとファイアウォールを確認して待受を設定する。

## 5. ビルド済み画面の確認

開発を停止してから実行する。

```powershell
npm.cmd run build
npm.cmd start
```

`http://localhost:3001` を開く。`npm start` はコンパイル済みの `dist-server/server/index.js` を実行するので、先にビルドが必要。通常の再起動で DB を作り直さない。ビルド済み配置では実行依存のみで動作し、ビルド / テストは開発依存が必要。

## 6. スマートフォン・PWA

スマートフォンにも対応した画面を使える。スマートフォンの `localhost` は PC ではない。正式なホーム画面アプリの確認は HTTPS 公開 URL で行う。iPhone は Safari の共有→ホーム画面に追加、Android は対応ブラウザーのインストール機能を使用する。OS / ブラウザーにより表示は異なる。

PWA は画面の基本ファイルだけを保存する。オフラインでは現在の観測 API を取得できず、その旨を表示する。公開先と OAuth は未確定で、スマートフォンのインストールと公開後の受入は [公開前チェック](deployment-checklist.md) に沿って行う。

## 7. 検証

```powershell
npm.cmd test
npm.cmd run build
npm.cmd audit --audit-level=high
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

テストは主に固定した API 応答を使用する。外部 API の実取得や実スマートフォンを検証したことと区別する。

## 8. 困った場合

| 状況 | 対応 |
| --- | --- |
| `package.json` がない | `Get-Location` / `Test-Path` と二重フォルダーを確認 |
| Node バージョンのエラー | 24.5 以上へ更新してターミナルを開き直す |
| `npm.ps1` が拒否される | `npm.cmd` を使用 |
| ポート使用中 | このアプリの前の起動を停止。PC の他の Node プロセスを一括終了しない |
| `.env` の PORT だけ変更した | 開発の Vite プロキシは 3001 固定。設定の整合を確認 |
| 実データが不明 / 古い | 回線、観測時刻、OpenSky 状態、匿名 15 分の間隔、429 の待機を確認 |
| 地図タイルが出ない / API KEY REQUIRED が出る | 最新版へ更新。背景はキー不要の OpenStreetMap に変更済み。`tile.openstreetmap.org` への通信と CSP を確認し、簡易陸地と観測 API の状態を別に調べる |
| `npm start` がファイルを見つけない | `npm.cmd run build` が成功したか確認 |
| 設定変更後に 403 / 制限がある | PUBLIC_ORIGIN と実 URL、信頼するプロキシ数を確認。安全性の設定を無条件に解除しない |
| PWA を追加できない | HTTPS の正式 URL、対応ブラウザー、manifest / Service Worker の配信を確認 |

[運用手順](11-operations.md) · [資料一覧](README.md)
