# 運用・保守手順書

現行構成は単一の Node.js サーバーと SQLite ファイルです。ローカル開発と、ビルド済み画面を同じ API サーバーから配信する運用に対応します。常時動作させる場合は、ホスト側で起動・再起動・永続ディスクを管理してください。

## 起動と停止

プロジェクトのルートで、Node.js 24.5.0 以上を使います。

```powershell
# Windows では npm / npx の代わりに npm.cmd / npx.cmd を使用できます。
# 初回、または依存関係を更新した後
npm ci
npm run db:init

# 開発: API 3001 + Vite 5173
npm run dev
```

開発画面は `http://localhost:5173`、API の健康確認は `http://localhost:3001/api/health` です。`db:init` は繰り返し実行でき、API 起動時にも DB を作成します。

ビルド済み画面を配信する場合は、開発サーバーを止めてから実行します。

```powershell
# Windows では npm / npx の代わりに npm.cmd / npx.cmd を使用できます。
npm run build
npm start
```

画面は `http://localhost:3001` です。`npm start` は DB・API と既存 `dist/` を起動し、ビルドを自動実行しません。現在は TypeScript を `tsx` で実行するため、`npm ci --omit=dev` では運用できません。コード更新時は依存インストール、テスト、ビルドを行ってから再起動します。

終了は起動したターミナルで `Ctrl+C` を押します。サーバーは HTTP 接続を閉じた後、DB 接続を閉じます。バックアップや復元前は、このアプリの関連プロセスが終了していることを確認してください。PC のほかの Node.js アプリをまとめて停止しないでください。

## 設定

`.env.example` を `.env` にコピーできます。既存の `.env` があれば内容を確認して保持します。`npm start` と API 開発起動は `.env` を読み込み、すでにプロセスに設定された環境変数を優先します。

| 環境変数 | 省略時 | 内容 |
| --- | --- | --- |
| `PORT` | `3001` | API ポート。整数 1～65535 |
| `HOST` | `0.0.0.0` | API の待受アドレス。配布する `.env.example` はローカル用の `127.0.0.1` |
| `DATABASE_PATH` | `./data/flights.sqlite` | SQLite ファイル。相対パスは起動時の作業フォルダー基準。空文字はエラー |
| `POLL_INTERVAL_SECONDS` | 匿名 `900`、OAuth の両設定がある場合 `120` | 外部取得の最小間隔。10～86400 秒の数値、端数切上げ |
| `OPENSKY_CLIENT_ID` | 未設定 | 任意の OAuth クライアント ID。secret と対で設定 |
| `OPENSKY_CLIENT_SECRET` | 未設定 | サーバー専用の OAuth secret。ブラウザー・ソース・GitHub に置かない |

匿名 15 分、OAuth 2 分が標準です。設定で短縮できる範囲と、OpenSky の利用枠で継続運用できる間隔は別です。実際のプランと同じ IP の利用状況を確認して設定してください。片方だけ OAuth 設定すると取得時に認証設定の不完全を表示します。

**開発時の注意:** Vite の `/api` プロキシは `vite.config.ts` で `http://127.0.0.1:3001` に固定されています。`.env` の `PORT` だけ変更すると開発画面の API に接続できません。開発は 3001 を空けるか、意図したコード変更として Vite プロキシも合わせます。ビルド後の `npm start` は画面と API が同じポートなので、`PORT` の変更だけで利用できます。Vite の 5173 は `strictPort` のため、競合時に別ポートへ自動変更されません。

## 外部通信と更新動作

| 接続先 | 用途 | 必要となる条件 |
| --- | --- | --- |
| `registry.npmjs.org` | npm 依存のインストール | 導入・依存更新 |
| `opensky-network.org` | 状態ベクトル取得 | ライブ |
| `auth.opensky-network.org` | OAuth トークン取得 | OAuth 設定時 |
| `basemaps.cartocdn.com` | 詳細地図タイル | 詳細地図表示。失敗時は同梱 Natural Earth の陸地表示を使用 |

Playwright の Chromium 初回インストールには Playwright が案内するブラウザー配布先への通信も必要です。環境の既存 allowlist は置換せず、必要な接続先を追加します。

ブラウザーはローカル API をライブでは最大 30 秒間隔、デモでは 10 秒間隔で確認します。外部 OpenSky 取得はバックエンドの期限管理を共用するため、更新ボタンを押しても期限前に追加取得しません。外部更新は **リクエストを受けた時点** で行います。閲覧者がいない間も定期収集するバックグラウンドジョブはありません。

429 では `Retry-After` などの待機時間と設定間隔を守ります。保存済み実データがあれば古い状態で表示し、未保存なら取得不可です。デモへの自動切替は行いません。観測から 120 秒を超えると、次回取得前でも古い状態に変わります。

## 日常確認

```powershell
# Windows では npm / npx の代わりに npm.cmd / npx.cmd を使用できます。
Invoke-RestMethod http://localhost:3001/api/health
```

`status: ok`、`database: ready` は API と DB の確認で、ライブ取得成功の保証ではありません。`live.status`、`fetchedAt`、画面の観測時刻と出典も確認します。`authenticationConfigured` は両方の変数が存在する意味で、認証成功の判定ではありません。

履歴は保存時に、その観測時刻を基準として古い点を削除します。モード別に 24 時間／最大 1,440 点を保存し、API は直近 360 点を返します。タイマーによる定期削除はなく、更新が止まると削除も止まります。DB は機体の現在値と件数履歴を保存し、全機体の過去航跡を蓄積する構成ではありません。

## DB バックアップ

SQLite は WAL モードです。**稼働中に `flights.sqlite` だけをコピーしないでください。** 未チェックポイントの最新値が `-wal` にあり、整合性を失う可能性があります。初版では、停止してからファイル一式を保存する方法を使います。

1. DB の実際の保存先を確認します。`DATABASE_PATH` を変更している場合は以下の `$database` も合わせます。
2. このアプリのサーバーを正常終了し、その DB を開くほかのプロセスも終了します。
3. 次のコマンドで、リポジトリの外のバックアップフォルダーへ保存します。

```powershell
# Windows では npm / npx の代わりに npm.cmd / npx.cmd を使用できます。
# 必ずこの DB の利用プロセスを終了してから実行
$database = Join-Path (Get-Location) 'data/flights.sqlite'
if (-not (Test-Path -LiteralPath $database)) { throw 'DB が見つかりません。保存先を確認してください。' }
$backupRoot = Join-Path (Split-Path (Get-Location) -Parent) 'global-flight-monitor-backups'
$backupFolder = Join-Path $backupRoot (Get-Date -Format 'yyyyMMdd-HHmmss')
New-Item -ItemType Directory -Path $backupFolder -ErrorAction Stop | Out-Null
foreach ($path in @($database, "$database-wal", "$database-shm")) {
    if (Test-Path -LiteralPath $path) {
        Copy-Item -LiteralPath $path -Destination $backupFolder -ErrorAction Stop
    }
}
Write-Output $backupFolder
```

正常終了では WAL / SHM がなくなる場合があります。残っていれば一緒に保管します。バックアップ取得時のアプリのコミット、Node.js のバージョン、DB 保存先も記録してください。停止せずに取得したい場合は SQLite の対応するオンラインバックアップ機能を別途実装して検証します。

## DB 復元

1. 対象アプリと DB 利用プロセスを停止します。復元対象バックアップの取得条件とファイルの存在を確認します。
2. 現在の DB と存在する `-wal` / `-shm` を別フォルダーに退避します。既存データを削除して開始しないでください。
3. 復元先には現在の WAL / SHM を残さず、バックアップの DB と付属ファイル一式を元のファイル名で戻します。保存先・ファイル権限も確認します。
4. バックアップを作成した版、または対応する新しい版のアプリで起動し、health、機体、履歴、ライブ・デモの区別を確認します。

現行スキーマの `PRAGMA user_version` は 1 です。それより新しいスキーマの DB は現行アプリが拒否します。エラーを回避するためにバージョン値を手で下げないでください。`db:init` は初期化・対応マイグレーションであり、破損修復や将来版のダウングレードは行いません。

## よくある問題

| 症状 | 確認と対応 |
| --- | --- |
| `node:sqlite` や `--use-env-proxy` で起動失敗 | `node --version`、`Get-Command node` を確認。Node.js 24.5.0 以上を導入してターミナルを開き直す |
| `EADDRINUSE` / Vite ポート競合 | 3001 / 5173 の使用プロセスを確認。このアプリの以前の起動だけを終了。PORT 変更時は上記プロキシ注意を確認 |
| API は動くが 3001 に画面がない | プロジェクトルートで `npm run build`。生成後に API を再起動する |
| DB のアクセス拒否・ロック | DATABASE_PATH と権限、同じ DB の二重起動を確認。ファイルを消して直そうとしない |
| ライブが `—機` / 保存済みデータ | 回線、OpenSky 稼働、次回更新予定を確認。必要なら明示的にデモを選ぶ |
| HTTP 429 | 待機して次回更新を確認。更新の連打や再起動による利用枠回避をしない |
| OAuth 401 / 設定不完全 | ID と secret の両方をサーバー側で確認し、変更後に再起動。値をログやチャットに貼らない |
| 証明書検証エラー | OS / Node の信頼ストアと環境の HTTPS プロキシを確認。提供元が案内する CA 設定を使い、TLS 検証を無効にしない |
| 詳細地図が表示されない | CARTO への通信を確認。同梱陸地は表示できるため、ライブ API の失敗と分けて調べる |
| npm / Playwright 導入失敗 | エラーの対象接続先と Node.js バージョンを確認。署名・チェックサム・TLS 検証を保持して再試行 |

不具合報告は [GitHub 手順](10-github-guide.md)を参照し、操作、期待値、実際の結果、OS、Node.js、秘密を除いたエラーを記録します。`.env`、SQLite、バックアップ、OAuth トークン、資格情報は GitHub に追加しません。
