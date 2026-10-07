# SKYTRACE — Global Flight Monitor

世界で観測されている航空機を一覧・地図で確認するアプリです。React / TypeScript / Vite のフロントエンド、Node.js / Express の API、SQLite のデータベースを一緒に起動できます。

OpenSky Network の受信局が観測した機体を集計します。**世界中のすべての航空機の正確な総数ではありません**。受信範囲外の機体や情報を送信していない機体は含まれません。`origin_country` は機体の登録国で、現在飛んでいる国ではありません。取得できない出発・到着空港、便名と空港の対応、旅客数は表示しません。

## 既存フォルダーへの追加と資料

VS Code で開いている既存の `global-flight-monitor` フォルダーに、そのまま追加できます。[START-HERE](START-HERE.md) の PowerShell コマンドで GitHub から取得・配置・セットアップ・起動します。ZIP のダウンロードは不要です。配置時は既存の `.git`・`.env`・DB・追加ファイルを保持し、同名の変更前のファイルをバックアップします。

[まず読む：START-HERE](START-HERE.md) · [企画・要件・設計などの資料一覧](docs/README.md) · [Windows 導入](docs/09-windows-setup.md) · [GitHub にまとめて追加](docs/10-github-guide.md)

`docs/` の Markdown と画面例は、アプリ本体と同じコミットで GitHub に追加できます。

## 必要なもの

- Node.js 24.5 以上、npm、Git
- VS Code / PowerShell でも利用できます。
- インターネット接続。必要な接続先は `registry.npmjs.org`、`opensky-network.org`、`auth.opensky-network.org`（OAuth を使う場合）、`basemaps.cartocdn.com`（地図）。
- PostgreSQL などの別サーバーは不要です。Node.js 標準の SQLite を使います。

## 起動

Windows の PowerShell で、`package.json` があるリポジトリのルートから実行します。macOS / Linux は `npm.cmd` を `npm` に読み替えてください。

```powershell
npm.cmd run setup
npm.cmd run dev
```

ブラウザーで `http://localhost:5173` を開きます。API はポート 3001、Vite は 5173 を使います。これはご自身の開発環境でのアクセス先です。

`npm run setup` は Node.js と SQLite を確認し、lockfile に従った依存導入、DB 初期化、型検査、画面のビルドを順に行います。通常の起動だけでも初回の DB は自動作成されるので `db:init` は単独で DB を準備したい場合にも利用できます。機体の選択、検索、地図、観測数の履歴を試してください。インターネットや OpenSky が使えない場合は、画面の「デモ」に切り替えると合成データで機能を確認できます。デモを実測値として表示することはありません。

設定は必要に応じて `.env.example` を `.env` にコピーします。

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

`.env` は Git の対象外です。API クライアントの秘密の値をコードやブラウザーへ書かないでください。API は同一のバックエンドが集中的にキャッシュし、閲覧者が増えても取得を共用します。起動コマンドは Node.js の `--use-env-proxy` を有効にし、クラウドの HTTPS プロキシ経由でも証明書の検証を維持して接続します。

## データと更新間隔

[OpenSky の公式 API 仕様](https://openskynetwork.github.io/opensky-api/rest.html) に基づきます。

| 接続方法 | 標準更新間隔 | 日次クレジット | 全世界取得の消費 |
| --- | --- | --- | --- |
| 匿名 | 15分（900秒） | 400 / IP | 4 / 回 |
| OAuth クライアント | 2分（120秒） | 標準 4,000 | 4 / 回 |
| デモ | 10秒 | 消費なし | 合成データ |

匿名アクセスは全世界取得が最大100回/日です。画面は30秒ごと（デモは10秒ごと）にローカル API の状態を確認しますが、画面の更新ボタンもサーバーのキャッシュ期限を守ります。短い `POLL_INTERVAL_SECONDS` を指定すると、継続利用時に上限に達します。同一 IP のほかの利用やプロバイダーのポリシー変更にも影響されます。429 応答時には取得を待機します。匿名の状態ベクトルは10秒単位の観測精度で、継続的な1秒単位の更新を提供するものではありません。

OAuth を使う場合は OpenSky のアカウント設定で API クライアントを発行し、サーバー側の `OPENSKY_CLIENT_ID` と `OPENSKY_CLIENT_SECRET` を設定します。ブラウザーから OpenSky に直接認証情報を送信しません。古い Basic 認証は使用しません。

取得に失敗したときは、最後に保存した実データを「古いデータ」として表示し、成功した取得がないときは取得不可を表示します。観測時刻・取得時刻・次回更新予定を確認できます。実データとデモデータ、両方の履歴を区別して保存します。通信エラー時のデモへの自動切り替えはしません。

## データベース

標準保存先は `data/flights.sqlite` です。変更する場合は `DATABASE_PATH` を指定します。起動・初期化は繰り返し実行できます。SQLite のファイルは Git に含めません。

- 最新の航空機状態を保存して、詳細と再起動後の表示に使用します。保存済み取得時刻から次回の取得期限を引き継ぎます。
- 観測数のスナップショットを保存して、履歴グラフに使用します（保存は24時間／最大1,440点、API では直近360点を返します）。
- 実データとデモのレコードを分けて保存します。

アプリのコードは `src/`、バックエンドは `server/`、共通の API 型は `shared/types.ts`、テストは `tests/` です。

## API

| エンドポイント | 内容 |
| --- | --- |
| `GET /api/health` | サーバー・DB の動作状態 |
| `GET /api/dashboard?mode=live` | 実データの機体一覧、集計、履歴、更新時刻 |
| `GET /api/dashboard?mode=demo` | 明示的なデモデータ |
| `GET /api/flights/:icao24?mode=live` | ICAO24 で指定する機体の詳細 |

`mode` は `live` / `demo` のみ指定できます。集計は OpenSky の `on_ground=false` と新しい観測値に基づき、地図表示はさらに有効な位置がある機体に限定します。画面の検索は便名（callsign）・ICAO24・登録国が対象です。高度は幾何高度を優先し、欠損時は気圧高度を利用します（m）。速度は対地速度（km/h 表示）、地上航跡は真北からの対地進行方向（°）です。大量の機体がある場合、地図は最大1,200機を間引いて描画します。集計と検索対象は全観測機体です。

## 検証・本番ビルド

```powershell
npm.cmd test
npm.cmd run build
# ブラウザーテストを初めて実行する場合:
npx.cmd playwright install chromium
npm.cmd run test:e2e
# 開発モードを停止してから、ビルド済みの画面と API を起動:
npm.cmd start
```

`npm start` では `http://localhost:3001` を開きます。先に `npm run build` が必要です。Node.js のバージョンによって SQLite の実験的 API の警告が出る場合があります。

この構成はローカル開発と単一サーバーでの実行に対応しています。マップは OpenStreetMap / CARTO の帰属表示を残しています。詳細地図の取得に失敗した場合は、同梱した [Natural Earth のパブリックドメインの陸地データ](https://www.naturalearthdata.com/about/terms-of-use/) を簡易背景として表示します。元データ: `src/components/world-land.ts` のコメント参照。
