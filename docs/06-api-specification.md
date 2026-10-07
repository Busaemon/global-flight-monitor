# API 仕様書

## 1. 共通仕様

同一オリジンの読み取り API。開発時は `http://localhost:3001/api`、画面は Vite の `/api` プロキシを使用する。本番は HTTPS の公開オリジンの `/api` を使用する。JSON 型の定義は [shared/types.ts](../shared/types.ts)、入力検証は [server/query.ts](../server/query.ts) を根拠とする。

| 項目 | 内容 |
| --- | --- |
| メソッド | `GET` / `HEAD`。更新メソッドは 405 |
| `mode` | 省略時 `live`、指定は `live` / `demo` のみ |
| 入力 | 許可したクエリだけ、同じ項目の重複は不可。クエリ全体が 2,048 文字超は 414 |
| 時刻 | UTC ISO 8601。観測 / 取得 / 通信を区別 |
| 欠損 | 測定値は `null`。識別に必要な一部文字列は空文字 / `Unknown` |
| 文字 | JSON UTF-8。検索は大文字小文字を区別しない部分一致 |
| キャッシュ | `private, no-cache, must-revalidate`。ETag で再検証、同一なら 304。Service Worker は API を保存しない |
| 転送 | gzip 対応。HEAD は本文なし |
| 制限 | 標準 180 回 / 分 / IP。health を除く。超過は 429 |
| 出典 | 実データは OpenSky、デモは合成データ。失敗時のデモ自動代用なし |

`PUBLIC_ORIGIN` 指定時、異なる `Origin` ヘッダーの API 要求を 403 にする。CORS を提供する公開クライアント API ではない。Origin ヘッダーのないサーバークライアントは利用可能で、認証によるアクセス制限とは異なる。

外部 API 失敗は基本的に観測 API の HTTP 200 内の `status` / `message` で表す。ローカルサーバー障害や入力エラーと区別する。`flights` / `map` の空配列だけを「実測 0 件」と判断せず、`summary` の状態を確認する。

## 2. エンドポイント

| パス | 許可クエリ | 内容 |
| --- | --- | --- |
| `/api/health` | なし | API / DB の健全性。外部取得を行わない |
| `/api/summary` | `mode` | 全観測の集計・履歴・鮮度、機体一覧は含まない |
| `/api/flights` | `mode,q,sort,page,limit` | 条件付きページ一覧 |
| `/api/map` | `mode,q,bounds,limit,selected` | 範囲内の軽量な位置情報 |
| `/api/flights/:icao24` | `mode` | 一機の詳細 |
| `/api/dashboard` | `mode` | 旧互換の全件 API。新画面は利用しない |

## 3. GET /api/summary

`DashboardSummaryResponse = Omit<DashboardResponse, 'flights'>`。検索や地図範囲を適用しない全観測の統計を返す。

| 項目 | 型 | 意味 |
| --- | --- | --- |
| `mode` | `live` / `demo` | 要求したモード |
| `status` | `live` / `stale` / `unavailable` / `demo` | 観測の状態 |
| `source` | string | 提供元 |
| `coverageNote` | string | 観測範囲と集計の説明 |
| `fetchedAt` | string / null | 正常に取得した時刻 |
| `observedAt` | string / null | 提供元の観測時刻 |
| `nextRefreshAt` | string / null | 外部取得を次に試せる予定時刻 |
| `pollIntervalSeconds` | number | 外部取得の設定間隔 |
| `stats` | FlightStats | 全観測の統計 |
| `history` | HistoryPoint[] | 直近最大 360 点、古い時刻から順 |
| `message` | string / null | 失敗、待機、古い観測などの説明 |

`unavailable` の内部統計は空の値でも、画面は未知の件数として表示する。正常な空の観測の 0 件とは状態で区別する。`stale` は保存済み実データで、現在の確実な位置とは扱わない。

| `stats` | 型 | 意味 |
| --- | --- | --- |
| `airborne` | number | 新しい通信がある飛行中機体の数 |
| `totalObserved` | number | 地上を含む新しい有効観測の数 |
| `withPosition` | number | 飛行中のうち有効な位置がある数 |
| `countries` | number | 登録国の種類数。Unknown を除く |
| `avgAltitudeMeters` | number / null | 測定できた飛行中機体だけの平均、高度 m |
| `avgVelocityMps` | number / null | 測定できた飛行中機体だけの平均、m/s |

`history` の一項目は `{observedAt: string, airborne: number}`。過去の位置や航跡は返さない。

## 4. GET /api/flights

| クエリ | 省略時 | 制約 |
| --- | --- | --- |
| `q` | 空文字 | 80 文字以内、制御文字不可。前後の空白を除去 |
| `sort` | `callsign` | `callsign` / `altitude` / `speed` |
| `page` | `1` | 1～1,000,000 の整数表記。先頭の 0、端数、負数不可 |
| `limit` | `8` | 1～50 の整数表記 |

検索対象はコールサイン / ICAO24 / 登録国。callsign は昇順、高度 / 速度は降順、NULL は最後。同値は ICAO24 で安定させる。存在するページを超える要求は最終ページに補正する。0 件時は `page=1,pageCount=0,flights=[]`。

返却: `{mode,source,observedAt,fetchedAt,flights,total,page,pageSize,pageCount}`。`total` は検索後の全件数、`flights` はそのページだけ。全観測数ではない。

```http
GET /api/flights?mode=live&q=JAL&sort=altitude&page=1&limit=8
```

## 5. GET /api/map

| クエリ | 省略時 | 制約 |
| --- | --- | --- |
| `q` | 空文字 | 一覧と同じ検索 |
| `bounds` | `-180,-90,180,90` | `west,south,east,north`、経度 ±180、緯度 ±90、south ≤ north |
| `limit` | `500` | 1～1,000 の整数表記。画面標準はモバイル 200 / PC 600 |
| `selected` | なし | 6 桁 16 進 ICAO24。対象の検索 / 範囲内にある場合サンプルに残す |

west > east は日付変更線をまたぐ範囲。緯度 / 経度が欠損した機体は対象外。返却前の対象を ICAO24 順にし、件数超過時は均等な位置を deterministic に抽出する。`selected` は範囲外の機体を追加する指定ではない。

返却: `{mode,observedAt,fetchedAt,flights,total,sampled}`。`total` は検索 / 範囲条件に一致する位置ありの全数、`sampled` は上限による抽出があったか。`flights` は軽量な `MapFlight[]` で、高度や速度を含まない。

| `MapFlight` | 型 |
| --- | --- |
| `icao24,callsign,originCountry` | string |
| `latitude,longitude` | number。地図用は null ではない |
| `headingDegrees` | number / null |

```http
GET /api/map?mode=live&bounds=170,-20,-170,50&limit=200
```

地図の件数を世界の飛行中機数として利用しない。

## 6. GET /api/flights/:icao24

識別子は大文字 / 小文字の 6 桁 16 進数。内部では小文字に正規化する。返却は `{flight,mode,source,fetchedAt,observedAt}`。現在の保存済み観測にない機体は 404。利用者が選んだ機体が次の観測から消えることもある。

## 7. Flight の項目と単位

一覧、詳細、旧互換 API の `Flight` は以下の共通型。

| 項目 | 型 | 意味 / 単位 |
| --- | --- | --- |
| `icao24` | string | 小文字の 6 桁 16 進識別子 |
| `callsign` | string | コールサイン。欠損は空文字 |
| `originCountry` | string | 登録国。欠損は Unknown |
| `longitude,latitude` | number / null | 度。位置が古い / 不正な場合 null |
| `altitudeMeters` | number / null | m。幾何高度優先、気圧高度で補完 |
| `velocityMps` | number / null | 対地速度 m/s。画面は ×3.6 で km/h |
| `headingDegrees` | number / null | 0～360 未満、真北からの対地進行方向 |
| `verticalRateMps` | number / null | 正が上昇、負が下降、m/s |
| `onGround` | boolean | 現在保存する飛行中機体では false |
| `lastContact` | string | 最終通信時刻 |
| `positionUpdatedAt` | string / null | 有効な位置の更新時刻 |
| `positionSource` | string | ADS-B / ASTERIX / MLAT / FLARM / Unknown / Simulation |

出発 / 到着、機種、航空会社、旅客数はこの契約に含まない。

## 8. GET /api/health

返却例は説明用で、現在の稼働状態ではない。

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

`authenticationConfigured=true` は ID と secret が設定されている意味で、実 OAuth の成功を証明しない。DB の確認で例外が発生すると 503 `{status:"error",database:"unavailable"}`。health の要求自体は外部 API を取得せず、API の通常リクエスト枠から除外する。

## 9. GET /api/dashboard（旧互換）

`summary` のすべての項目に `flights: Flight[]` を加えた従来の契約。旧クライアントと移行確認用に維持する。新画面はこの全件レスポンスを使用しない。外部取得の期限やモードの分離は新 API と共有する。

## 10. HTTP 状態とエラー

| HTTP | 内容 |
| --- | --- |
| 200 | 有効な要求。外部取得不可は summary の状態で確認 |
| 304 | ETag が一致し本文なし。サーバーの鮮度確認は実行される |
| 400 | 未対応 / 重複クエリ、不正 mode、識別子、範囲、数値、検索文字 |
| 403 | PUBLIC_ORIGIN と異なる Origin ヘッダー |
| 404 | 未対応 API / 現在の観測にない機体 |
| 405 | GET / HEAD 以外。Allow ヘッダーを返す |
| 414 | クエリ文字列が長すぎる |
| 429 | ローカル API 制限。OpenSky の 429 は外部待機として別に扱う |
| 500 | サーバーの処理エラー。内部スタック / 秘密を返さない |
| 503 | health の DB 利用不可 |

通常のエラーは `{ "error": "日本語の説明" }`。OpenSky のエラー本文やトークンをそのまま転送しない。

[システム設計](04-architecture.md) · [テスト仕様](07-test-specification.md) · [資料一覧](README.md)
