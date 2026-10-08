# 運用・保守手順書

## 1. 前提

単一の Node.js サーバーと SQLite を使用する。公開ドメインと OpenSky OAuth クライアントは未確定 / 未用意。ここにある Docker / HTTPS は具体的な設定例で、公開済みの環境や実 OAuth の成功を示さない。

Node.js 24.5 以上。開発では API 3001 と Vite 5173、本番ビルドではコンパイル済みサーバーが画面・API・PWA を同じポートで配信する。

```powershell
# Windows の例。macOS / Linux は npm を使用
npm.cmd run setup
npm.cmd run dev
# 開発を停止した後、ビルド済み画面を確認
npm.cmd start
```

`npm start` は `dist-server/` と `dist/` が必要。ビルドは開発依存を含む `npm ci` で行い、実行環境は `npm ci --omit=dev` を使用可能。Dockerfile はビルドと実行を分け、実行時に TypeScript / tsx を使用しない。

## 2. 設定

ローカルは `.env.example`、公開は `.env.production.example` を見本にする。既存 `.env` を上書きせず、差分を確認する。API 起動時に `.env` を読み込み、プロセス環境を優先する。

| 変数 | 標準 | 意味 / 制約 |
| --- | --- | --- |
| `PORT` | 3001 | 1～65535 の整数 |
| `HOST` | 127.0.0.1 | 待受。Compose は内部 0.0.0.0 |
| `DATABASE_PATH` | ./data/flights.sqlite | 空不可。相対パスは作業フォルダー基準。Compose は /app/data/flights.sqlite |
| `NODE_ENV` | 未設定 | 本番は production。背景更新と HTTPS の安全なヘッダーの判断に使用 |
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | 空 | 正式な OAuth クライアント。対で設定。実行サーバー専用 |
| `POLL_INTERVAL_SECONDS` | 匿名 900 / OAuth 120 | 10～86400 秒の数値、端数切上げ。短縮時は利用枠を確認 |
| `BACKGROUND_REFRESH` | 本番 true / 開発 false | true / false。閲覧者がいなくても期限内でライブを更新 |
| `PUBLIC_ORIGIN` | 未設定 | パス / 末尾 slash なしの正確な origin。公開では実際の HTTPS URL |
| `TRUST_PROXY_HOPS` | 0 | 0～3 の整数。直接は 0、用意した Compose / Caddy は 1 |
| `API_RATE_LIMIT_PER_MINUTE` | 180 | 10～10000 の整数、IP 単位。health は除外 |
| `DOMAIN` | 未設定 | Compose / Caddy の公開ドメイン。https:// やパスを付けない |
| `ACME_EMAIL` | 未設定 | Compose / Caddy の証明書通知メール。自分の有効な連絡先 |

開発の Vite プロキシは `http://127.0.0.1:3001` 固定。PORT だけ変えると接続できないため、3001 を空けるか意図した設定変更としてプロキシも合わせる。ビルド済みサーバーは画面と API が同一ポート。

## 3. HTTPS 公開の設定例

Docker Engine と Compose、ドメイン、サーバーの永続領域を用意する。DNS の A / AAAA を実サーバーへ向け、到達可能な 80 / 443 を開く。example.com を自分のドメインへ置き換え、メールも自分の値にする。不要な AAAA が別のサーバーへ向いていると証明書検証に失敗する。

```powershell
# 公開用のサーバーで。既存 .env があればコピーせず必要な項目を追加
if (-not (Test-Path .env)) { Copy-Item .env.production.example .env }
# エディターで DOMAIN / ACME_EMAIL / PUBLIC_ORIGIN を実値に変更
# 正式 OAuth がある場合は ID / secret もサーバー側へ設定
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

`.env` の内容を表示する `docker compose config` をそのままログやチャットへ貼らない。`--quiet` は構成の妥当性確認用。アプリは非 root、読み取り専用のルート、書き込みはデータ volume と一時領域。Caddy だけが 80 / 443 を公開し、API 3001 は内部経路で利用する。

永続 volume は `flight-data`（SQLite）、`caddy-data`（証明書）、`caddy-config`。通常の停止や更新で `docker compose down -v` を使わない。volume を消すと DB と証明書の状態を失う。

```powershell
# 実際のドメインへ置き換える
Invoke-RestMethod https://flights.example.com/api/health
```

画面、summary、地図 / 一覧 / 詳細、manifest / Service Worker を HTTPS で確認する。コンテナーの健康判定は API / DB の確認で、外部データ取得成功とは別。公開前の詳細は [公開前チェック](deployment-checklist.md) に従う。

## 4. 外部通信とデータ更新

| 接続先 | 用途 |
| --- | --- |
| registry.npmjs.org | 依存導入 / 更新 |
| opensky-network.org | 状態ベクトル |
| auth.opensky-network.org | OAuth 設定時のトークン |
| tile.openstreetmap.org | ブラウザーの詳細タイル（地図画像だけオリジンの Referer を送信） |
| 公開先の ACME / DNS | Caddy の証明書発行 / 更新 |
| Playwright のブラウザー配布先 | テスト初回の Chromium 導入 |

Node は `--use-env-proxy` を使用し、環境の HTTPS プロキシに対応する。TLS の検証を無効にしない。クラウドや組織の検証用プロキシで Docker の依存導入に管理 CA が必要な場合、Dockerfile の任意の BuildKit `npm_ca` secret を使い、提供元の正しい CA をビルド時だけマウントする。CA をソース / イメージへコピーしたり検証を無効にしたりしない。通常の公開サーバーの直接接続に追加 CA は不要。ブラウザーが API を確認しても期限前の外部取得は増えない。本番の背景更新も同じ期限 / in-flight を共有し、標準匿名 900 秒 / OAuth 120 秒を守る。

取得開始、成功、失敗 / 429 の期限を DB v2 の `provider_state` に保存する。初回失敗で実観測がなくても待機期限は再起動後に残る。観測 120 秒超を古い状態で表示する。匿名の間隔を短縮して継続的なリアルタイムを保証しない。

## 5. 日常確認と停止

health の `status=ok,database=ready`、live の状態 / fetchedAt、画面の観測時刻と次回予定、コンテナーの再起動回数、CPU / メモリー / ディスク、外部枠を確認する。`authenticationConfigured` は両変数が存在する意味で、認証成功ではない。

公開先に合わせて HTTP / HTTPS とディスク容量の監視、ログ保持、通知先を設定する。アプリはログイン追跡やアクセス解析を実装しないが、ホスト / Caddy の設定によるログは管理者が確認する。IP は API 制限のためメモリー内で使用する。

ローカル停止は `Ctrl+C`。Docker は `docker compose stop app`、全体停止は `docker compose stop`。背景取得を停止し、実行中の取得と接続終了を待って DB を閉じる。他のプロジェクトの Node プロセスをまとめて停止しない。

履歴削除は観測保存時に同モードの 24 時間 / 最大 1,440 点を守る。API は直近 360 点。アプリ停止中に時計だけで DB の履歴を削除する処理ではない。機体の長期航跡は保存しない。

## 6. DB バックアップ

SQLite は WAL。**稼働中に DB 本体だけをコピーしない。** 残っている WAL / SHM を含め、停止後に保存する。バックアップのコミット、スキーマ版、Node 版、保存先を記録し、秘密の設定と分けて保管する。

ローカルの標準保存先を停止後に保存する例。DATABASE_PATH を変更している場合は実保存先に合わせる。

```powershell
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

Compose では API を止め、停止済みのコンテナーのデータをコピーする。バックアップ先はソースとは別の保管領域とする。

```powershell
docker compose stop app
if ($LASTEXITCODE -ne 0) { throw '停止に失敗しました。バックアップを中止してください。' }
$backupFolder = Join-Path (Split-Path (Get-Location) -Parent) ('global-flight-monitor-backups/' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupFolder -ErrorAction Stop | Out-Null
docker compose cp app:/app/data/. $backupFolder
if ($LASTEXITCODE -ne 0) { throw 'コピーに失敗しました。保存結果を確認してください。' }
docker compose start app
```

公開環境でこの手順を実行し、停止 / コピー / 再開 / 保存内容を確認する。オンラインバックアップが必要なら SQLite の正式なバックアップ機能を別途実装 / 検証する。

## 7. 復元とコード更新

復元はまず別のテスト環境で確認する。対象アプリと DB の利用プロセスを停止し、現在の DB / WAL / SHM を退避する。バックアップの DB と付属ファイルを元の名前で戻し、復元前の WAL / SHM を残さない。Compose では同じ永続 volume を復元先とし、アプリの UID / 書込権限を維持する。

v1 は起動時に v2 に移行する。v2 を旧 v1 アプリへ直接戻さない。旧版へ戻す場合は、その版に対応する停止後バックアップをテスト環境で確認する。`user_version` を手で下げてエラーを回避しない。v2 より新しい DB は現行コードが拒否する。

更新は関連 PR / CI / 資料を確認し、停止後バックアップ、依存 / ビルド、再起動、health とデータの確認を行う。Docker は `docker compose up -d --build` で更新し、DB volume を保持する。データ移行を伴う版は事前に復旧条件を決める。

## 8. 障害対応

| 症状 | 確認 / 対応 |
| --- | --- |
| Node / SQLite 起動失敗 | Node 24.5+、正しい実行ファイル、ビルド結果 |
| port 競合 | このアプリの二重起動。開発プロキシと PORT の整合 |
| 画面が 404 | dist と dist-server のビルド、作業フォルダー |
| DB 拒否 / ロック | 永続領域、権限、二重起動、スキーマ。削除で解決しない |
| ライブ不明 / 古い | 回線、提供元、観測時刻、次回予定、保存状態 |
| OpenSky 429 | 保存された期限まで待つ。再起動で枠を回避しない |
| ローカル API 429 | IP の共有 / リクエスト数、信頼プロキシ設定、適切な公開規模 |
| OAuth 401 / 不完全 | 両変数、正式クライアント、期限。秘密をログ / チャットへ貼らない |
| API 403 | PUBLIC_ORIGIN と Origin。公開 URL と末尾 slash を確認 |
| 証明書発行失敗 | DOMAIN / DNS / AAAA / 80 / 443 / ACME_EMAIL、Caddy のエラー |
| 地図だけ失敗 | OpenStreetMap 通信 / 地図画像の Referer / CSP、簡易陸地。HTTP 200 でもエラー画像の可能性があるため、画像の内容も確認。観測 API と別に調べる |
| オフライン | 画面だけ使える。現在の観測の取得ができない状態を確認 |
| TLS / proxy | 正式な CA 設定と環境プロキシを確認。検証を無効にしない |

不具合は OS / Node / コミット / 操作 / 秘密を除いたエラーを [GitHub](10-github-guide.md) に記録する。脆弱性の詳細は [SECURITY.md](../SECURITY.md) の経路を使用する。

[公開前チェック](deployment-checklist.md) · [DB 設計](05-database-design.md) · [資料一覧](README.md)
