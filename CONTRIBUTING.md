# 開発と変更の送り方

要件・API・実装・検証結果を同じ PR で更新します。[要件定義](docs/02-requirements.md) と [システム設計](docs/04-architecture.md) を先に確認してください。

## 準備

Node.js 24.5 以上を使用します。リポジトリを clone した作業フォルダーで、最新の `origin/main` を元に作業ブランチを作ります。既存の未保存の変更がある場合は先に保存してください。独自の `.git` がある配布先へ、GitHub の履歴を無理に上書きしません。

```powershell
git fetch origin
git switch -c work/your-change origin/main
npm.cmd run setup
npm.cmd run dev
```

`npm.cmd` は Windows の例です。macOS / Linux は `npm` を使います。導入と GitHub の詳しい手順は [Windows ガイド](docs/09-windows-setup.md) と [GitHub ガイド](docs/10-github-guide.md) にあります。

## 実装時の方針

- 実データ・デモ・取得不可・古いデータを区別し、欠損値を 0 や架空の値で補いません。
- 集計は全観測、一覧はページ、地図は範囲内のサンプルとして区別します。新画面から `/dashboard` の全件を取得しません。
- キーボード操作、見えるフォーカス、ラベル、通信状態の案内、320 px 以上の表示と文字拡大を維持します。新しい操作は一覧からも到達できるようにします。
- PWA のキャッシュに API・外部タイルを含めず、オフラインの誤認を防ぎます。
- 変更に必要なプロジェクトのファイルだけを扱い、ユーザーの `.env`・DB・Git 履歴・独自ファイルを削除しません。
- 新しい依存が必要な理由を説明し、`package-lock.json` も更新します。秘密の例は実際の資格情報にしません。

## 検証

```powershell
npm.cmd test
npm.cmd run build
npm.cmd audit --audit-level=high
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

外部 API は固定したモックで決定的に検証します。テストのために OpenSky の全世界取得を連打しません。画面変更ではスマートフォン幅、検索・詳細、キーボード、オフライン、モード切替を確認します。試した OS・Node.js・ブラウザーと未検証項目を PR に記録します。

## コミットと PR

メッセージは変更後の動作が伝わるものにします。例: `一覧をページ取得に変更してスマートフォンの通信量を削減`。`git diff --cached` で `.env`・DB・認証情報・ビルド生成物がないことを確認してから送信します。

作業ブランチを push し、取り込み先 `main` の PR を作ります。Issue / 要件、変更内容、テスト結果、関連資料、未検証項目、移行がある場合の復元手順を記入します。履歴の不一致を force push や既存 `.git` の削除で解決しません。

CI の成功だけで公開設定まで完了したとは判断しません。外部に公開する前に [公開前チェック](docs/deployment-checklist.md) を行います。脆弱性の詳細は [SECURITY.md](SECURITY.md) の経路を使用してください。
