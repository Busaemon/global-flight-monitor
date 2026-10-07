# API 仕様書

この文書は [server/app.ts](../server/app.ts) の HTTP API と [shared/types.ts](../shared/types.ts) の共通型に対応します。API は読むための GET エンドポイントのみです。画面からの登録・更新・削除 API、ユーザー認証 API はありません。

## 1. 基本契約

| 項目 | 仕様 |
| --- | --- |
| 開発時の接続 | 画面は `http://localhost:5173/api/...`。Vite が API へ転送 |
| API 直接接続 | 標準 `http://localhost:3001/api/...` |
| ビルド後の単一ポート | `npm start` により画面と API を標準ポート 3001 で配信 |
| 応答形式 | JSON、`Content-Type: application/json; charset=utf-8` |
| API の HTTP キャッシュ | `Cache-Control: no-store` |
| 時刻 | UTC の ISO 8601 文字列 |
| 数値の欠損 | `null`。0 と区別する |
| ブラウザーへの秘密の返却 | OAuth ID・シークレット・トークンを返さない |

HTTP の `no-store` は、ブラウザーや中間キャッシュに API 応答を保持させない指定です。サーバー内部の共有キャッシュと DB の保存は別に存在します。

### mode クエリ

`/api/dashboard` と `/api/flights/:icao24` は次の値を受け付けます。

| 指定 | 解釈 |
| --- | --- |
| 未指定 | `live` |
| `mode=live` | OpenSky の実データ |
| `mode=demo` | 架空のシミュレーション |
| その他、空文字、大文字、複数指定 | HTTP 400 |

`LIVE` や `Demo` は受け付けません。未知のクエリを機体検索・ページ指定として扱う機能はありません。現在の検索やページ分割は画面側で行います。

## 2. エンドポイント一覧

| メソッド | パス | 用途 | 主な HTTP 状態 |
| --- | --- | --- | --- |
| GET | `/api/health` | API / DB の動作状態 | 200、503 |
| GET | `/api/dashboard` | 機体、統計、履歴、取得状態 | 200、400、500 |
| GET | `/api/flights/:icao24` | 現在の機体詳細 | 200、400、404、500 |

外部 OpenSky の障害は、通常ダッシュボードの HTTP 200 と `status: stale` / `unavailable` で表現します。ダッシュボードのすべての応答を、HTTP 200 だけで「ライブ成功」と判定しないでください。

## 3. GET /api/health

SQLite に `SELECT 1` を実行し、現在のライブサービス状態も返します。この呼び出し自体は OpenSky の新規取得を行いません。`live.status` が `unavailable` でも、API と DB が動作していればヘルスは HTTP 200 です。

正常応答の例:

```json
{
  "status": "ok",
  "database": "ready",
  "live": {
    "status": "unavailable",
    "fetchedAt": null,
    "pollIntervalSeconds": 900,
    "authenticationConfigured": false
  }
}
```

| フィールド | 型 | 意味 |
| --- | --- | --- |
| `status` | string | 通常 `ok`。DB 確認結果が偽なら `error` |
| `database` | string | 通常 `ready` |
| `live.status` | string | `live` / `stale` / `unavailable` |
| `live.fetchedAt` | string / null | 最後に正常保存したライブ取得時刻 |
| `live.pollIntervalSeconds` | number | サーバーのライブ取得間隔、秒 |
| `live.authenticationConfigured` | boolean | OAuth の ID とシークレットが両方設定されているか |

`authenticationConfigured: true` は、認証情報が正しいことやトークン取得が成功したことを保証しません。DB 操作で例外が発生すると HTTP 503 で次を返します。

```json
{"status":"error","database":"unavailable"}
```

## 4. GET /api/dashboard

要求例:

```http
GET /api/dashboard?mode=live
GET /api/dashboard?mode=demo
```

ライブの取得期限に達していれば OpenSky から取得し、正常保存後のデータを返します。期限前は保存済みデータを返し、同時要求は同じ取得を共用します。実測の機体配列は飛行中の機体だけです。デモは外部 API を使用せず生成します。

### DashboardResponse

| フィールド | 型 | NULL | 意味 |
| --- | --- | --- | --- |
| `mode` | `live` / `demo` | 不可 | 要求したモード |
| `status` | `live` / `stale` / `unavailable` / `demo` | 不可 | 取得状態。次の表を参照 |
| `source` | string | 不可 | ライブは `OpenSky Network`、デモは `シミュレーションデータ` |
| `coverageNote` | string | 不可 | 観測・集計の範囲、デモの説明 |
| `fetchedAt` | string | 可 | 最後の正常取得・保存時刻 |
| `observedAt` | string | 可 | 取得元の観測時刻 |
| `nextRefreshAt` | string | 可※ | 次に新規取得・生成を試せる期限 |
| `pollIntervalSeconds` | number | 不可 | 取得間隔。ライブは設定値、デモは 10 |
| `stats` | FlightStats | 不可 | 統計 |
| `flights` | Flight[] | 不可 | 現在の対象機体。未取得時は空配列 |
| `history` | HistoryPoint[] | 不可 | 対象モードの直近最大 360 点。古い順 |
| `message` | string | 可 | 古いデータ・取得不可・デモの説明。通常ライブ成功時は `null` |

※ 共通型では `nextRefreshAt` に `null` を許容しますが、現在のサービス実装は正常なダッシュボード応答で期限文字列を設定します。この期限は予定時刻にバックグラウンドジョブが必ず動くという意味ではありません。期限後にダッシュボードまたは詳細の要求が来たときに取得を試みます。

### status の意味

| mode | status | 意味と表示上の扱い |
| --- | --- | --- |
| live | live | 正常に取得・保存し、観測時刻からの経過が 120 秒以内 |
| live | stale | 保存済み実データを表示。取得失敗、再起動直後、観測から 120 秒超のいずれか |
| live | unavailable | 利用できる保存済み実データがない。機数 0 を実測 0 機として表示しない |
| demo | demo | すべての機体・機数・履歴が架空のデータ |

観測の空配列が正常取得された場合は、実測 0 機として `status: live` になります。未取得の `status: unavailable` と、正当な観測 0 件は別です。ライブ障害時にデモへ自動切り替えはしません。

### FlightStats

| フィールド | 型 | NULL | 単位・集計 |
| --- | --- | --- | --- |
| `airborne` | number | 不可 | `flights.length` と一致する飛行中の機数 |
| `totalObserved` | number | 不可 | 新しい通信がある有効機体数。地上を含む |
| `withPosition` | number | 不可 | 飛行中のうち緯度・経度が有効な機数 |
| `countries` | number | 不可 | 飛行中機体の登録国の種類数。`Unknown` を除く |
| `avgAltitudeMeters` | number | 可 | 取得できた高度の平均、m |
| `avgVelocityMps` | number | 可 | 取得できた対地速度の平均、m/s |

平均値は NULL を除いた値から計算し、有効な値が 1 つもなければ `null` です。実測機数には OpenSky の受信範囲による偏りがあります。

### Flight

| フィールド | 型 | NULL | 単位・意味 |
| --- | --- | --- | --- |
| `icao24` | string | 不可 | 小文字 6 桁 16 進識別子 |
| `callsign` | string | 不可 | 前後の空白を取り除いたコールサイン。欠損は空文字 |
| `originCountry` | string | 不可 | 登録国。欠損は `Unknown`。現在位置の国ではない |
| `longitude` | number | 可 | 経度、度、-180〜180 |
| `latitude` | number | 可 | 緯度、度、-90〜90 |
| `altitudeMeters` | number | 可 | 高度、m。幾何高度優先、欠損時は気圧高度 |
| `velocityMps` | number | 可 | 対地速度、m/s。画面は km/h へ変換 |
| `headingDegrees` | number | 可 | 真北からの対地進行方向、0 以上 360 未満の度 |
| `verticalRateMps` | number | 可 | 垂直速度、m/s。正: 上昇、負: 下降 |
| `onGround` | boolean | 不可 | 地上判定。現在の機体配列は飛行中だけなので通常 `false` |
| `lastContact` | string | 不可 | 最終通信時刻、UTC |
| `positionUpdatedAt` | string | 可 | 採用した位置の時刻、UTC |
| `positionSource` | string | 不可 | `ADS-B` / `ASTERIX` / `MLAT` / `FLARM` / `Unknown`。デモは `Simulation` |

実測の高度は -500〜30,000 m、速度は 0〜1,500 m/s の範囲を採用し、それ以外を `null` にします。方位の取得値 360 度は 0 度へ変換します。垂直速度は有限の数値か確認します。幾何高度が存在して範囲外の場合、現行処理は気圧高度へ再フォールバックせず `null` にします。

位置時刻が観測時刻に対して過去 120 秒 / 未来 30 秒の範囲を超えた場合、または座標が不正な場合は、`longitude`・`latitude`・`positionUpdatedAt` をまとめて `null` にします。機体の最終通信が新しければ、位置欠損でも飛行中の機数に含めます。

### HistoryPoint

| フィールド | 型 | 意味 |
| --- | --- | --- |
| `observedAt` | string | UTC の観測時刻 |
| `airborne` | number | その時点の飛行中の機数 |

同じモード・観測時刻は 1 点です。正常な新規観測がない時間帯を架空のライブ履歴で補う処理はありません。

### 正常ライブ応答の説明用例

次は契約を説明するために作った **架空の 1 機の例** です。実際の現在の観測、機体、世界の機数を示すものではありません。日時も説明用に固定しています。統計と配列は一致させています。

```json
{
  "mode": "live",
  "status": "live",
  "source": "OpenSky Network",
  "coverageNote": "OpenSky が受信した、直近 120 秒以内に通信がある飛行中の機体数です。世界の全機体を網羅する正確な総数ではありません。地図には直近 120 秒以内の有効な位置情報がある機体だけを表示します。登録国は飛行場所を示しません。",
  "fetchedAt": "2026-10-08T00:00:02.000Z",
  "observedAt": "2026-10-08T00:00:00.000Z",
  "nextRefreshAt": "2026-10-08T00:15:02.000Z",
  "pollIntervalSeconds": 900,
  "stats": {
    "airborne": 1,
    "totalObserved": 1,
    "withPosition": 1,
    "countries": 1,
    "avgAltitudeMeters": 9100,
    "avgVelocityMps": 230
  },
  "flights": [
    {
      "icao24": "abc123",
      "callsign": "EXAMPLE1",
      "originCountry": "Japan",
      "longitude": 139.7,
      "latitude": 35.6,
      "altitudeMeters": 9100,
      "velocityMps": 230,
      "headingDegrees": 90,
      "verticalRateMps": 0.5,
      "onGround": false,
      "lastContact": "2026-10-07T23:59:59.000Z",
      "positionUpdatedAt": "2026-10-07T23:59:57.000Z",
      "positionSource": "ADS-B"
    }
  ],
  "history": [
    {"observedAt":"2026-10-08T00:00:00.000Z","airborne":1}
  ],
  "message": null
}
```

### 未取得・接続失敗時の応答例

これはまだ実測データを保存できていない場合の説明用応答です。HTTP 200 で状態を返します。失敗時刻を `00:00:00Z`、匿名 900 秒設定とした例です。

```json
{
  "mode": "live",
  "status": "unavailable",
  "source": "OpenSky Network",
  "coverageNote": "OpenSky が受信した、直近 120 秒以内に通信がある飛行中の機体数です。世界の全機体を網羅する正確な総数ではありません。地図には直近 120 秒以内の有効な位置情報がある機体だけを表示します。登録国は飛行場所を示しません。",
  "fetchedAt": null,
  "observedAt": null,
  "nextRefreshAt": "2026-10-08T00:15:00.000Z",
  "pollIntervalSeconds": 900,
  "stats": {
    "airborne": 0,
    "totalObserved": 0,
    "withPosition": 0,
    "countries": 0,
    "avgAltitudeMeters": null,
    "avgVelocityMps": null
  },
  "flights": [],
  "history": [],
  "message": "OpenSky に接続できませんでした。ネットワーク接続と API の稼働状況を確認してください。"
}
```

保存済み実データがあれば、失敗時も前回の `stats`・`flights`・`fetchedAt`・`observedAt` を維持し、`status: stale` と今回の失敗理由を返します。

## 5. GET /api/flights/:icao24

要求例:

```http
GET /api/flights/abc123?mode=live
GET /api/flights/d00000?mode=demo
```

`icao24` は 6 桁の 16 進数です。パス内は大文字も受け付け、小文字へ変換して検索します。取得期限・キャッシュはダッシュボードと共有します。現在の対象機体に存在しなければ HTTP 404 です。過去に存在した機体を履歴から検索するエンドポイントではありません。

### FlightDetailResponse

| フィールド | 型 | NULL | 意味 |
| --- | --- | --- | --- |
| `flight` | Flight | 不可 | 指定機体 |
| `mode` | `live` / `demo` | 不可 | データモード |
| `source` | string | 不可 | データ提供元 |
| `fetchedAt` | string | 型では可 | スナップショット取得時刻 |
| `observedAt` | string | 型では可 | スナップショット観測時刻 |

現在の正常な詳細応答は機体が保存されているスナップショットから作るため、時刻は実際には文字列です。詳細応答には `status`・`message`・`nextRefreshAt` はありません。ライブの鮮度や接続障害を判断するクライアントは、ダッシュボードの取得状態も確認してください。保存済みの古い機体が見つかれば、詳細は HTTP 200 でその機体を返します。

### デモ詳細応答の例

次はデモ生成関数へ固定の説明日時 `2026-10-08T00:00:00.000Z` を与えて生成した `d00000` の例です。実在の運航情報ではありません。実際に要求した際は生成時刻と数値が変わります。

```json
{
  "flight": {
    "icao24": "d00000",
    "callsign": "ANA101",
    "originCountry": "Japan",
    "longitude": 140.5789210282477,
    "latitude": 37.52882032381686,
    "altitudeMeters": 8591.729219429011,
    "velocityMps": 210,
    "headingDegrees": 139.85454592108727,
    "verticalRateMps": 1.1466152428626468,
    "onGround": false,
    "lastContact": "2026-10-08T00:00:00.000Z",
    "positionUpdatedAt": "2026-10-08T00:00:00.000Z",
    "positionSource": "Simulation"
  },
  "mode": "demo",
  "source": "シミュレーションデータ",
  "fetchedAt": "2026-10-08T00:00:00.000Z",
  "observedAt": "2026-10-08T00:00:00.000Z"
}
```

## 6. エラー応答

ヘルス以外のエラー応答は `{ "error": "説明" }` です。

| HTTP | 条件 | 応答の説明 |
| --- | --- | --- |
| 400 | 不正な `mode` | `mode は live または demo を指定してください。` |
| 400 | ICAO24 が 6 桁 16 進数でない | `icao24 は 6 桁の 16 進数を指定してください。` |
| 404 | 指定機体が現在の対象にない | `現在の観測データに該当する機体が見つかりません。` |
| 404 | 未定義の `/api` エンドポイント | `API エンドポイントが見つかりません。` |
| 500 | 処理中の予期しない例外 | `サーバーでエラーが発生しました。` |
| 503 | ヘルスの DB 確認で例外 | `{"status":"error","database":"unavailable"}` |

両方が不正な機体詳細要求では、まず `mode` を検証します。外部 429 / 401 / 403 は原則としてローカル API の同じ HTTP コードへ転送せず、ダッシュボードの状態と説明に変換します。

## 7. OpenSky との外部連携

| 操作 | URL・仕様 |
| --- | --- |
| 状態取得 | `GET https://opensky-network.org/api/states/all` |
| OAuth トークン取得 | `POST https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token` |
| OAuth POST の形式 | `application/x-www-form-urlencoded` |
| OAuth POST の項目 | `grant_type=client_credentials`、サーバー環境の `client_id`、`client_secret` |
| 認証済み状態取得 | `Authorization: Bearer` にサーバーで取得したトークンを付ける |
| 匿名取得 | ID とシークレットがどちらも未設定なら Authorization なし |
| 不完全な設定 | 片方だけ設定されていれば設定不備として失敗。匿名へ自動変更しない |
| タイムアウト | 外部 HTTP 要求ごとに 8 秒 |

トークンはサーバーのメモリーに保持し、期限まで 30 秒未満になったら取得し直します。OAuth 利用中に状態取得が 401 になった場合は、トークンを破棄して一度取得し直し、状態要求を再送します。Basic 認証は使用しません。

429 は `x-rate-limit-retry-after-seconds`、なければ `retry-after` を解釈し、60〜86,400 秒へ調整します。値がなければ 900 秒を使います。サーバーの次回取得期限は設定取得間隔と失敗待機時間の長い方です。外部データの公式フィールド順序・利用枠・利用条件は [OpenSky REST API 公式仕様](https://openskynetwork.github.io/opensky-api/rest.html) を参照してください。

OAuth の秘密の値は `.env` または安全な環境変数に設定します。URL、GitHub、画面、文書、ログへ実値を書きません。

## 8. PowerShell での確認

アプリを起動してから別の PowerShell を開いて実行します。

```powershell
$baseUrl = 'http://localhost:3001'
Invoke-RestMethod "$baseUrl/api/health"

# デモは外部 API なしで確認できる
$dashboard = Invoke-RestMethod "$baseUrl/api/dashboard?mode=demo"
$dashboard | Select-Object mode, status, source, observedAt
$dashboard.stats
$dashboard.flights.Count

# 応答内の実際の識別子を使う
$icao24 = $dashboard.flights[0].icao24
Invoke-RestMethod "$baseUrl/api/flights/$($icao24)?mode=demo"

# ライブの状態は status と時刻で判断する
$live = Invoke-RestMethod "$baseUrl/api/dashboard?mode=live"
$live | Select-Object status, fetchedAt, observedAt, nextRefreshAt, message
```

デモダッシュボードの `stats.airborne` は `flights.Count` と一致し、`status` は `demo`、履歴はデモ専用です。上のコマンドでその時点の完全な応答を取得できます。ライブを繰り返し要求しても、画面の更新ボタンと同様にサーバーの取得期限を越えて外部 API を強制更新する機能はありません。

[ドキュメント一覧へ戻る](README.md)
