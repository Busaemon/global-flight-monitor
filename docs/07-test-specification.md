# テスト仕様書

対象は現行の SKYTRACE 初版です。ソースを根拠に、観測値の集計、DB 保存、API、画面の表示を検証します。受入判断では実データの件数を固定しません。世界の全機体数や、通信失敗時の 0 件を正しい実測値として扱わないことを重視します。

## 実行方法と検証済み範囲

プロジェクトのルートで実行します。

```powershell
# Windows では npm / npx の代わりに npm.cmd / npx.cmd を使用できます。
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run build` はフロントとサーバーの TypeScript 型チェックも実施します。Playwright は未起動なら `npm run dev` を起動します。すでに開発サーバーを使っている場合は、同じコードと DB 設定か確認してください。

| 検証項目 | 記録済みの結果 | 条件と限界 |
| --- | --- | --- |
| バックエンド自動テスト | 20 件成功 | Linux、Node.js 24.19.0。15 個のトップレベルテストと 5 個のサブテスト |
| ブラウザー自動テスト | 9 件成功 | Linux、システム Chromium。主に固定 API 応答を使用 |
| 型チェック・本番ビルド | 成功 | `npm run build` |
| 匿名 OpenSky 取得 | 成功 | 約 1.1 万機の観測を取得した時点の確認。将来の件数・接続成功を保証しない |
| API 手動確認・DB 再起動 | 確認済み | ローカル HTTP と保存済み実データの再読込 |
| Windows / PowerShell | 未実行 | 現クラウドに PowerShell がない。以下の手動受入項目を利用者の PC で確認する |
| 実 OAuth 資格情報 | 未検証 | トークン取得・更新はモックで検証。利用者のクライアントによる接続確認は別途必要 |

これは今回の実行記録です。コード変更後は再実行し、結果と実行環境を更新してください。

## バックエンドの自動テスト

ソース: [`tests/backend.test.ts`](../tests/backend.test.ts)。B01～B15 はソース内のトップレベル `test()` と対応します。

| ID | ソース内のテスト名 | 主な確認内容 |
| --- | --- | --- |
| B01 | `state vectors retain airborne aircraft with missing or old positions while excluding old contacts and ground aircraft` | 通信が新しい飛行中機体を集計。位置欠損・古い位置は地図から除外。地上・古い通信は集計対象外 |
| B02 | `parser validates measurements, normalizes identifiers, and keeps the latest contact per aircraft` | ICAO24 正規化、便名の空白除去、測定値の検証、機体重複時の最新値採用 |
| B03 | `empty OpenSky state sets represent a legitimate zero, while malformed payloads fail explicitly` | 正常な空の観測は 0。不正応答は明示的なエラー |
| B04 | `SQLite survives reopen and isolates live and demo snapshots, aircraft, and count history` | ファイル DB の再オープン、ライブ・デモの機体と履歴の分離 |
| B05 | `SQLite rolls back an invalid replacement instead of losing the saved snapshot` | 重複キーによる保存失敗で、以前のデータと履歴を保護 |
| B06 | `concurrent dashboard and detail requests share one fetch and honor the polling cache` | 同時リクエストの取得共用、更新期限、履歴保存 |
| B07 | `a provider failure returns the last persisted live snapshot as stale and observes retry backoff` | 外部取得失敗時に保存済み実データを古いデータとして返し、再試行まで待機 |
| B08 | `a missing live snapshot is unavailable on failure and never substitutes demo aircraft` | 実データ未保存の取得失敗は取得不可。デモを実データとして返さない |
| B09 | `restarting the service reuses the persisted polling deadline instead of fetching immediately` | 再起動でも前回取得時刻に基づく待機を継続 |
| B10 | `a successful observation becomes stale after 120 seconds while still respecting a longer API polling interval` | 観測が 120 秒を超えると古い状態になり、長い取得間隔は維持 |
| B11 | `outdated upstream observation timestamps cannot overwrite a good stored snapshot` | 古い観測応答で正常な保存値を上書きしない |
| B12 | `API health, demo dashboard and details work locally with validation and without live requests` | health、デモ一覧・詳細、大小文字 ICAO24、400 / 404、デモで外部取得なし |
| B13 | `OpenSky rate-limit response headers impose a cooldown before another upstream request` | 429 ヘッダーによる待機と、期限後の取得再開 |
| B14 | `OAuth credentials use the token endpoint and cache an expiring token without exposing it in responses` | 模擬資格情報で client_credentials、期限付きトークン再利用、応答へのトークン混入防止 |
| B15 | `an OAuth 401 refreshes the rejected token once, with bounded retries for permanent rejection` | 拒否されたトークンを一度更新し、無制限に再試行しない |

B13 のサブテストは `x-rate-limit-retry-after-seconds: 120`、`retry-after: 180`、HTTP 日付の `retry-after` の 3 件です。B15 は `success after token refresh` と `permanently rejected` の 2 件です。

## ブラウザーの自動テスト

ソース: [`tests/e2e/dashboard.spec.ts`](../tests/e2e/dashboard.spec.ts)。各テストの終了時にブラウザーの未処理エラーがないことも確認します。

| ID | ソース内のテスト名 | 主な確認内容 |
| --- | --- | --- |
| E01 | `real demo API renders the same aircraft count and supports detail selection` | 実際のローカルデモ API の件数と UI が一致し、詳細を開ける |
| E02 | `map and list selection show aircraft details; search covers callsign, ICAO and country` | 地図・一覧から選択、詳細の高度・速度、3 種類の検索、検索クリア、該当なし |
| E03 | `390px mobile layout stays within the page width and supports search and details` | 390 px 幅で横はみ出しがなく、検索・詳細表示・閉じる操作が可能 |
| E04 | `unavailable live data shows an unknown count and requires explicit demo selection` | 未取得は `—機`。利用者が選択したときだけデモ表示 |
| E05 | `rapid mode switching cannot display delayed responses under the wrong mode` | 遅延応答がライブ・デモの高速切替後に混入しない |
| E06 | `stale live observations retain their observation time separately from fetch time` | 古い状態と観測時刻・取得時刻を区別して表示 |
| E07 | `a live observation expires locally while the next API request is still pending` | 次の応答待ちでも時間経過でライブ表示が古い状態に変わる |
| E08 | `live mode retains its own last observation when the API disconnects` | 通信切断後もライブの最後の観測を古い状態で保持 |
| E09 | `demo mode retains its own last observation when the API disconnects` | 通信切断後もデモの最後の観測とデモ表示を保持 |

E02～E09 のダッシュボード応答はモックです。地図タイルも固定画像に置き換えるため、外部地図サービスの稼働は検証しません。E01 はライブ応答を取得不可に差し替え、デモ API を実際に呼び出します。

## Windows の手動受入

[Windows 導入手順](09-windows-setup.md)で導入し、VS Code の PowerShell から確認します。期待値を満たさない場合はエラー全文と Node.js のバージョンを記録し、秘密の値を伏せてください。

| ID | 操作 | 合格条件 |
| --- | --- | --- |
| M01 | `node --version`、初期化、`npm run dev`、`http://localhost:5173` を開く | Node.js 24.5.0 以上。DB を作成し、API と画面が起動する |
| M02 | 「デモ」を選び、一覧の件数・地図・履歴を見る | デモの表示があり、架空の機体が表示される。件数をライブとして扱わない |
| M03 | 便名、ICAO24、登録国で検索し、地図と一覧から詳細を開く | 検索結果が一致。高度 m、速度 km/h、位置、識別子を表示。高度・速度の欠損は `—`、位置の欠損は「未取得」 |
| M04 | 「ライブ」を選ぶ。匿名 API が使える状態で待つ | OpenSky の出典と観測時刻が表示される。件数は変動してよく、世界の正確な全機体数とは表示しない |
| M05 | 観測から 120 秒超、次回外部更新まで待つ | 保存済みの機体数を保ち、「最終取得データ」と古い観測時刻を表示する |
| M06 | 起動ターミナルでこのアプリを停止し、画面の更新を押す | 既存観測は古いデータとして残る。未取得状態は `—機`。自動でデモへ切り替わらない |
| M07 | DB の保存後にこのアプリを再起動し、同じモードで開く | 保存済み機体と履歴を読める。前回の取得期限を無視して外部取得を繰り返さない |
| M08 | 開発者ツールで幅を 390 px にし、検索・詳細を操作 | 横幅に収まり、主要操作ができる |
| M09 | 開発者ツールで CARTO タイルの通信だけを遮断し、地図を再表示 | 同梱 Natural Earth の簡易陸地と機体を表示。地図通信失敗の案内が出る |
| M10 | `npm run build` 後に開発サーバーを停止し、`npm start`、`http://localhost:3001` を開く | 単一 API サーバーから画面と API を配信する |
| M11 | 8 件を超えるデモ一覧で次・前ページを操作し、高度順・速度順を選ぶ。その後検索・モードを変更する | 1 ページ最大 8 件、各並び順に従う。検索やモードの変更で先頭ページに戻る |

通信障害の再現はまず M06 のローカル API 停止で行えます。外部取得失敗の保存値保持は B07・B08 で決定的に検証します。実データの件数は固定値比較より、`stats.airborne === flights.length`、`withPosition <= airborne`、出典・時刻・状態の対応を確認してください。

## 受入対象と未検証の項目

以下は[要件定義](02-requirements.md)との対応です。証跡があることは、各 FR のすべての条件を自動テストで網羅している意味ではありません。

| 要件 ID・受入対象 | 実装の根拠 | 証跡 |
| --- | --- | --- |
| FR-01 観測数と統計 | `parseOpenSky()`、`summarize()` | B01～B03、E01・E04、M04 |
| FR-02 世界地図 | `App` の位置フィルターとマーカー | B01、E02、M09 |
| FR-03 検索・並び替え・ページ切替 | `App` の検索・並び順・ページ状態 | E02、M03・M11 |
| FR-04 機体詳細 | `FlightService.detail()`、`DetailCard` | B12、E01～E03、M03 |
| FR-05 単位と情報の意味 | `parseOpenSky()`、画面の `meters()`・`speed()` | B01・B02、E02、M03 |
| FR-06 状態と鮮度 | `FlightService.dashboard()`、`useDashboard()` | B07・B08・B10・B11、E04・E06～E09、M05・M06 |
| FR-07 取得間隔と制限 | `FlightService.dashboard()`、`OpenSkyProvider.fetchObservation()` | B06・B09・B13～B15 |
| FR-08 明示的なデモ | DB のモード分離と `App` のモード状態 | B04・B08・B12、E01・E04・E05・E09、M02 |
| FR-09 保存と履歴 | `FlightDatabase.save()`、`read()`、`history()` | B04・B05・B09、M07 |
| FR-10 API と開発環境 | `createApp()` と npm スクリプト | B12、型チェック・ビルド、M01・M10 |

負荷試験、実 OAuth 接続、Windows ネイティブ動作、ブラウザー全種、長期連続稼働、DB バックアップからの復旧は未検証です。地図タイル障害と Windows 受入は上記の手動手順で確認してください。現行自動テストは並び順・ページ切替、地図上限 1,200 機、保存履歴の 24 時間／最大 1,440 点の削除境界、DB の将来スキーマ拒否を網羅していません。

変更後の GitHub の記録には、実行 OS、Node.js バージョン、実行コマンド、結果、未検証項目を残します。スクリーンショットだけで API・DB の検証完了とは判定しません。

## 配布 ZIP の追加検証

配布物を Linux / Node.js 24.19.0 の別の既存フォルダー（パスにスペースを含む）へ展開して確認しました。

- `npm run setup` による依存導入・DB 初期化・型検査・ビルドが成功。
- `npm start` から画面・全ビルド資産・health・デモ一覧・機体詳細を HTTP 200 で取得。
- 展開先でバックエンドの20テストが成功。
- 保存後に再度セットアップを実行し、DB の機数・取得時刻・履歴、既存の設定とメモが保持されることを確認。
- ZIP の CRC、親フォルダーが付いていないこと、`.git`・`.env`・実 DB・依存関係が入っていないことを確認。

この追加確認は Windows ネイティブや PowerShell 実行の検証ではありません。Windows の `npm.cmd` 手順と補助スクリプトは利用者の端末で上記の手動受入項目を確認します。
