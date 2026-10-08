# SKYTRACE プロジェクト資料

**Global Flight Monitor / Web・PWA v0.2.0**

企画・実装範囲・設計・テスト・導入・運用をソースと同じ履歴で管理します。現在の実装はスマートフォンにも対応する Web / PWA の公開基盤です。公開ドメイン、実 OAuth クライアント、公開先での負荷や実端末の受入は未確定 / 未検証です。

## 資料一覧

| 文書 | 内容 |
| --- | --- |
| [01 企画書](01-project-proposal.md) | 目的、利用場面、Web / PWA 方針、データの制約 |
| [02 要件定義書](02-requirements.md) | 機能・非機能要件、公開前の受入条件 |
| [03 画面仕様書](03-screen-specification.md) | 画面、状態、軽量な地図、操作と読み上げ |
| [04 システム設計書](04-architecture.md) | API 分割、キャッシュ、PWA、HTTPS、公開構成 |
| [05 データベース設計書](05-database-design.md) | SQLite v2、既存 DB 移行、取得期限の永続化 |
| [06 API 仕様書](06-api-specification.md) | 入力制限、ページ / 範囲取得、項目と単位 |
| [07 テスト仕様書](07-test-specification.md) | 自動検証、手動受入、実行結果と未検証項目 |
| [08 開発ロードマップ](08-roadmap.md) | 現在の成果、公開までの残作業、将来案 |
| [09 Windows・VS Code 導入ガイド](09-windows-setup.md) | 既存フォルダーへの追加、準備、起動、PWA |
| [10 GitHub ガイド](10-github-guide.md) | ブランチ / PR、CI、依存更新、公開設定 |
| [11 運用手順書](11-operations.md) | 設定、HTTPS 公開、DB 保護、障害対応 |
| [公開前チェック](deployment-checklist.md) | 公開先決定から受入・バックアップまで |
| [プライバシーと外部サービス](privacy.md) | 保存情報、通信先、地図、利用条件 |

[起動する](../START-HERE.md) · [開発への参加](../CONTRIBUTING.md) · [セキュリティ方針](../SECURITY.md)

## 読む順番

- 起動：START-HERE → Windows 導入。
- 企画：企画書 → 要件定義 → 画面仕様 → ロードマップ。
- 開発：要件定義 → システム設計 → DB 設計 → API → テスト。
- 公開：運用手順 → 公開前チェック → セキュリティ / プライバシー。

## 画面例

以下はビルド済みのローカル本番サーバーで**明示的にデモの合成データを表示した画面例**です。現在の実測値や本番公開の証跡ではありません。正確な現行挙動は画面仕様とソースを参照してください。

![SKYTRACE デスクトップ画面・デモモード](images/dashboard-demo.png)

<details>
<summary>スマートフォン表示の例（デモ）</summary>

![SKYTRACE スマートフォン画面・デモモード](images/dashboard-mobile-demo.png)

</details>

## 文書の基準

実装済みは `src/`、`public/`、`server/`、`shared/`、テストと対応させます。目標や公開先での未検証事項は区別します。コード・設定を変更した PR では関連資料も更新してください。秘密の値、実 DB、利用者の IP の記録は資料へ含めません。
