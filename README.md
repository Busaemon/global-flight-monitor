# SKYTRACE — Global Flight Monitor

世界で観測されている飛行中の航空機を、機数・地図・一覧・機体詳細から確認する Web / PWA です。React・TypeScript・Vite の画面、Node.js / Express の API、SQLite の保存機能を同じプロジェクトで管理しています。

**初期表示は実データです。** OpenSky Network が観測できた範囲の機数を表示します。世界中のすべての航空機の正確な総数ではありません。取得できないときは取得不可または古い観測を明示し、デモへの自動切替は行いません。デモは操作確認用の合成データです。

[起動する](START-HERE.md) · [企画・要件・設計・運用の資料](docs/README.md) · [公開前チェック](docs/deployment-checklist.md) · [開発への参加](CONTRIBUTING.md) · [セキュリティ](SECURITY.md)

## 起動

Node.js **24.5 以上**、npm、Git が必要です。別の DB サーバーは不要です。

```powershell
# VS Code の PowerShell。macOS / Linux では npm.cmd を npm に読み替えます。
npm.cmd run setup
npm.cmd run dev
```

ご自身の PC のブラウザーで `http://localhost:5173` を開きます。`setup` は lockfile に従う依存導入、DB 初期化、型チェック、ビルドを行い、既存 DB を削除しません。既存フォルダーへの GitHub からの追加は [START-HERE](START-HERE.md) のコマンドを使えます。

任意の設定は `.env.example` を `.env` にコピーして編集します。OAuth の ID / secret はサーバー側で管理し、チャット・GitHub・ブラウザーへ貼り付けません。設定例の値を自分の環境に置き換えてください。

## Web とホーム画面アプリ

画面はスマートフォンと PC に対応し、HTTPS で公開すると対応ブラウザーからホーム画面へ追加できます。iPhone は Safari の共有メニュー、Android は対応ブラウザーのインストール機能を使います。これは Web / PWA で、ストア向けネイティブアプリではありません。

機体一覧はページ単位、地図は表示範囲内の軽量データを取得します。地図のコードは遅延読み込みし、Canvas で描画するため、全機体の HTML マーカーを作りません。表示する機体数はスマートフォン 200、PC 600 を標準とし、観測機数の集計は表示数に関係なく全観測を対象にします。

オフライン時にキャッシュするのは画面の基本ファイルです。API 応答と外部地図タイルを Service Worker に保存せず、オフラインの数値を現在の実測値として表示しません。HTTPS の正式公開先、実端末のインストール、公開先での動作は [公開前チェック](docs/deployment-checklist.md) に沿って確認します。

## データの意味と更新

| 接続 | 外部 API の標準間隔 | 公式仕様に記載された日次枠 | 全世界取得 |
| --- | --- | --- | --- |
| 匿名 | 900 秒（15 分） | 400 クレジット / IP | 4 クレジット / 回 |
| OAuth クライアント | 120 秒（2 分） | 標準 4,000 クレジット | 4 クレジット / 回 |
| 明示的なデモ | 10 秒 | 消費なし | 合成データ |

[OpenSky の仕様](https://openskynetwork.github.io/opensky-api/rest.html)・利用条件は提供元の変更や契約に従います。匿名での全世界取得は最大 100 回 / 日で、同じ IP の利用も枠を消費します。ブラウザーの更新操作は共有キャッシュと待機期限を守り、429 の待機期限を再起動後も保持します。本番設定では閲覧者の有無にかかわらずバックグラウンド更新します。

観測から 120 秒を超えると古いデータとして扱います。匿名の標準間隔では次回取得まで古い表示になる時間があります。より短い間隔が必要な場合は、公開先と OpenSky OAuth クライアント・利用枠を用意する必要があります。現在は公開先も実 OAuth クライアントも未確定です。

`originCountry` は登録国、`callsign` は送信されたコールサインです。出発・到着空港、機種、航空会社、旅客数は未取得のため作りません。高度は幾何高度優先・気圧高度で補完（m）、速度は対地速度（API は m/s、画面は km/h）、地上航跡は真北からの対地進行方向（°）です。位置欠損の機体は集計と一覧に含め、地図から除きます。

## API と保存

| エンドポイント | 用途 |
| --- | --- |
| `GET /api/health` | API / DB の動作確認。OpenSky の取得成功を保証しません |
| `GET /api/summary?mode=live` | 全観測の集計・履歴・鮮度。機体一覧は含みません |
| `GET /api/flights?mode=live&q=JAL&sort=callsign&page=1&limit=8` | 検索・並び替え・ページ単位の一覧 |
| `GET /api/map?mode=live&bounds=-180,-90,180,90&limit=200` | 表示範囲の軽量な位置情報 |
| `GET /api/flights/:icao24?mode=live` | 選択した一機の詳細 |
| `GET /api/dashboard?mode=live` | 旧クライアント互換 API。新画面は利用しません |

詳細な入力制限、レスポンス、エラーは [API 仕様](docs/06-api-specification.md) を参照してください。SQLite の標準保存先は `data/flights.sqlite`。実データとデモを分け、最新機体と機数履歴を保存します。履歴は 24 時間 / 最大 1,440 点、返却は直近 360 点です。DB と `.env` は Git に含めません。

## 公開と運用

本番向けに Docker / Compose・Caddy の HTTPS 設定例、永続 DB、セキュリティヘッダー、入力検証、API 制限、圧縮・再検証、更新期限の永続化を用意しています。実際の公開には、自分のドメイン・DNS・サーバー・秘密の設定と、バックアップ運用が必要です。[運用手順](docs/11-operations.md) と [公開前チェック](docs/deployment-checklist.md) に従ってください。

ローカルでビルド済み画面を確認するには開発サーバーを停止してから実行します。

```powershell
npm.cmd run build
npm.cmd start
```

`http://localhost:3001` を開きます。このローカル確認は HTTPS 公開や本番負荷試験の代わりにはなりません。SQLite の単一サーバー構成のため、複数の API インスタンスを無計画に起動すると外部 API 利用枠の重複消費が生じます。

## 開発と確認

```powershell
npm.cmd test
npm.cmd run build
npm.cmd audit --audit-level=high
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

GitHub Actions は lockfile で依存を導入し、テスト・型検査 / ビルド・依存監査・ブラウザーテストを実行します。依存の更新提案は Dependabot 設定に含めています。実行結果と未検証項目は [テスト仕様](docs/07-test-specification.md) で区別します。

| 場所 | 内容 |
| --- | --- |
| `src/` / `public/` | 画面・地図・PWA の基本ファイル |
| `server/` / `shared/` | API・データ取得・DB・共通型 |
| `tests/` | バックエンド・ブラウザー検証 |
| `scripts/` | 導入・セットアップ補助 |
| `docs/` | 11 種の企画 / 設計資料、公開前チェック、プライバシー説明 |
| `.github/` | CI・依存更新・Issue / PR テンプレート |

OpenStreetMap / CARTO の地図帰属表示を保持しています。詳細タイルを取得できない場合は同梱の [Natural Earth のパブリックドメイン陸地データ](https://www.naturalearthdata.com/about/terms-of-use/) を表示します。外部タイルへの通信とデータ利用条件は [プライバシーと外部サービス](docs/privacy.md) を参照してください。
