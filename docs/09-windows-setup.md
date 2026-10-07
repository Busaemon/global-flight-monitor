# Windows・VS Code 導入ガイド

対象は、VS Code で既に開いている `global-flight-monitor` フォルダーです。新しい Vite プロジェクトを作成する必要はありません。配布ファイルには、画面・API・DB 初期化・設定・資料を含めています。

## 1. 既存フォルダーに追加する

ZIP のリンクが開けない場合は、VS Code の既存フォルダーの PowerShell ターミナルで次をまとめて実行します。Git と Node.js 24.5 以上が必要です。

```powershell
& {
    $incoming = Join-Path ([IO.Path]::GetTempPath()) ("skytrace-" + [guid]::NewGuid().ToString("N"))
    git clone --depth 1 --branch main https://github.com/Busaemon/global-flight-monitor.git $incoming
    if ($LASTEXITCODE -ne 0) { throw "GitHub からの取得に失敗しました。" }
    node (Join-Path $incoming "scripts/install-existing-folder.mjs") .
    if ($LASTEXITCODE -ne 0) { throw "ファイルの配置に失敗しました。" }
    npm.cmd run setup
    if ($LASTEXITCODE -ne 0) { throw "セットアップに失敗しました。" }
    npm.cmd run dev
}
```

一時フォルダーに取得したファイルから、必要なソース・設定・資料だけを追加します。既存の `.git`・`.env`・`data`・独自ファイルは保持します。同名のファイルを変更する場合は先にバックアップを作り、その場所を表示します。後続のコマンドは取得・配置・セットアップの成功後に実行されます。GitHub の認証画面が出た場合は、通常のサインインを使います。既存のアプリが起動している場合は停止してから実行してください。

成功後は手順4の画面確認へ進めます。次回の起動は `npm.cmd run dev` だけです。

**ZIP を利用できる場合の配置方法：**

1. 配布 ZIP をダウンロードします。
2. ZIP を開き、中にあるファイルとフォルダーをすべて、既存の `global-flight-monitor` に展開します。
3. 既存の `.git` は維持します。ZIP には `.git` を含めていません。
4. すでに同名のソースや設定がある場合は、既存フォルダーをバックアップして置き換える内容を確認します。独自の `.env` や DB はそのまま使います。
5. VS Code のエクスプローラーで、直下に `package.json`・`src`・`server`・`docs` が見えることを確認します。

ZIP は親フォルダーを付けない形式です。`global-flight-monitor/global-flight-monitor/package.json` という二重の構成にしないでください。

完成後の主な構成は次のとおりです。

```text
global-flight-monitor/
├── .github/                 # GitHub の Issue / PR テンプレート
├── .vscode/tasks.json       # VS Code の実行タスク
├── docs/                   # 企画・要件・設計・テスト・運用資料
├── scripts/                # 初回セットアップ・PowerShell 補助
├── server/                 # Node.js / Express / SQLite
├── shared/types.ts         # 画面と API の共通型
├── src/                    # React / TypeScript の画面
├── tests/                  # バックエンド・ブラウザーテスト
├── .env.example            # 任意の設定の見本
├── .gitignore
├── index.html
├── package.json
├── package-lock.json
├── README.md
├── START-HERE.md
├── tsconfig.json
├── tsconfig.server.json
├── playwright.config.ts
└── vite.config.ts
```

`node_modules`、`data`、`dist` は実行時に作成します。これらを別の PC からコピーする必要はありません。

## 2. 必要なバージョンを確認する

VS Code の「ターミナル」→「新しいターミナル」で PowerShell を開きます。

```powershell
Get-Location
Test-Path .\package.json
node --version
npm.cmd --version
git --version
```

`Test-Path` は `True`、Node.js は **24.5 以上**が必要です。Node.js 24 の配布版には SQLite が含まれているため、DB サーバーや DB 管理ソフトのインストールは不要です。Node.js を更新した場合は VS Code とターミナルを開き直します。

`False` の場合は、VS Code の「ファイル」→「フォルダーを開く」で既存の `global-flight-monitor` を選び直し、新しいターミナルを開きます。

## 3. 初回セットアップを実行する

```powershell
npm.cmd run setup
```

この1コマンドで、順番に次を実行します。エラーが出た場合は後続処理を止めます。

| 順番 | 処理 | 作られるもの |
| --- | --- | --- |
| 1 | Node.js のバージョンと SQLite を確認 | DB を変更しない確認 |
| 2 | `npm ci` で lockfile の依存関係をインストール | `node_modules/` |
| 3 | `npm run db:init` | `data/flights.sqlite`・初期テーブル |
| 4 | `npm run build` | TypeScript の型検査と `dist/` |

設定ファイルの `.env` は必須ではありません。DB はすでに存在すればその内容を保持します。npm キャッシュは通常は OS の一時ディレクトリ内に置き、`NPM_CONFIG_CACHE` が明示されていればその設定を使います。

## 4. 開発画面を起動する

```powershell
npm.cmd run dev
```

ブラウザーで、自分の PC の `http://localhost:5173` を開きます。API はポート 3001 で同時に起動します。ターミナルは開いたままにしてください。

1. 観測数と観測時刻が表示されることを確認します。
2. 外部データが取得できない場合は「デモ」を選び、表示と操作を確認します。
3. フライト一覧で便名・ICAO24・登録国を検索します。
4. 地図の機体、または一覧から機体を選び、高度・速度・位置などの詳細を確認します。
5. 停止する場合は起動したターミナルで `Ctrl+C` を押します。

次回は `npm.cmd run dev` だけで起動できます。依存関係が変更された場合は、アプリを停止して `npm.cmd run setup` を再実行します。

## 5. VS Code のタスクから実行する

「ターミナル」→「タスクの実行」から、次のタスクを選べます。

- `SKYTRACE: 初回セットアップ`
- `SKYTRACE: 開発起動`
- `SKYTRACE: ビルド`
- `SKYTRACE: バックエンドテスト`

Windows 用タスクは `npm.cmd` を使用します。PowerShell の実行ポリシーを変更しなくても、npm のコマンドで実行できます。

補助スクリプトも同梱しています。

```powershell
.\scripts\setup.ps1
.\scripts\start.ps1
# ビルド済み画面を起動する場合
.\scripts\start.ps1 -Production
```

端末のポリシーで `.ps1` が許可されていない場合は、上の補助スクリプトを使わず `npm.cmd` のコマンドを使ってください。PowerShell 補助はプロジェクトの場所へ移動して実行し、終了後に元の場所へ戻ります。

## 6. 任意の API 設定

匿名アクセスでも利用できます。匿名は15分間隔、OAuth クライアントを設定した場合は標準2分間隔です。画面はサーバーのキャッシュを確認するため、更新ボタンを押しても API の取得上限を回避しません。

設定したい場合だけ次を実行します。すでに `.env` がある場合は作り直さず、既存のファイルを編集します。

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

OAuth の `OPENSKY_CLIENT_ID` と `OPENSKY_CLIENT_SECRET` は `.env` またはサーバーの環境設定へ入れます。値は GitHub に含めません。画面はこれらの秘密の値を受け取りません。

## 7. テスト・ビルド済み起動

```powershell
npm.cmd test
npm.cmd run build
# 初めてブラウザーテストを実行するときだけ
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

開発モードを停止した後、ビルド済みの画面と API を単一ポートで実行できます。

```powershell
npm.cmd start
```

この場合は、自分の PC の `http://localhost:3001` を開きます。開発 API と同じポートなので同時起動は避けます。

## 8. 困った場合

| 状況 | 確認・対応 |
| --- | --- |
| `package.json` が見つからない | `Test-Path .\package.json` とフォルダーの二重配置を確認 |
| Node.js のバージョンエラー | Node.js 24.5 以上に更新してターミナルを開き直す |
| `npm.ps1` の実行が拒否される | `npm` ではなく `npm.cmd` を使う |
| ポートが使用中 | 以前このアプリを起動したターミナルで停止する。ほかのアプリのプロセスを一括停止しない |
| ライブデータが取得できない | 表示されたエラーと通信先を確認。デモの操作は独立して確認可能 |
| 地図の詳細が取得できない | 同梱の簡易世界地図に機体を表示。CARTO の通信先を確認 |
| 再取得しても数字が変わらない | 観測時刻・次回更新時刻・匿名15分間隔を確認 |
| セットアップが途中で止まる | 表示された最初のエラーを解決後、同じコマンドを再実行。DB の削除は不要 |

Windows での受入チェックは [テスト仕様](07-test-specification.md)、設定と DB の管理は [運用手順](11-operations.md)、GitHub への追加は [GitHub ガイド](10-github-guide.md) にあります。
