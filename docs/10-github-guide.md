# ソースと資料の変更を GitHub に送信する

対象リポジトリは `Busaemon/global-flight-monitor` です。`main` は取り込み済みの版、Pull Request はレビュー中の変更です。このガイドは、ソース・PWA・公開設定・資料を作業ブランチから Pull Request へまとめる手順です。

アプリを既存フォルダーへ配置して起動する手順は [Windows 導入ガイド](09-windows-setup.md) にあります。配置スクリプトと ZIP のコピーはファイルを追加するだけで、ローカルの Git 履歴を GitHub と同期しません。既存の `.git` があることだけでは、GitHub の `main` と同じ履歴であるとは限りません。

## 1. GitHub の履歴に基づく作業フォルダーを用意する

既存フォルダーが GitHub から clone したものではない場合は、そのフォルダーと独自ファイルを残したまま、別の作業フォルダーを作ります。PowerShell で作業フォルダーを置きたい親フォルダーへ移動し、次を実行します。`global-flight-monitor-git` は未使用のフォルダー名を指定してください。

```powershell
git clone --branch main https://github.com/Busaemon/global-flight-monitor.git global-flight-monitor-git
if ($LASTEXITCODE -ne 0) { throw "GitHub からの取得に失敗しました。" }
Set-Location .\global-flight-monitor-git
git switch -c work/flight-monitor-update
if ($LASTEXITCODE -ne 0) { throw "作業ブランチの作成に失敗しました。" }
```

この作業フォルダーを VS Code で開いて変更します。元の既存フォルダーですでに修正したファイルがある場合は、必要な変更だけ作業フォルダーへ反映し、差分を確認してください。元の `.git`、`.env`、DB、`node_modules`、`dist` はコピーせず、そのまま保持します。

すでにこのリポジトリを clone した作業フォルダーがある場合は、それを使えます。`git status` と `git remote -v` で変更内容と接続先を確認し、未コミットの変更がない状態で、最新の `main` から新しいブランチを作ります。

```powershell
git fetch origin
if ($LASTEXITCODE -ne 0) { throw "GitHub の履歴取得に失敗しました。" }
git switch -c work/flight-monitor-update origin/main
if ($LASTEXITCODE -ne 0) { throw "作業ブランチの作成に失敗しました。" }
```

ブランチ名は変更の内容に合わせて変え、すでに使っている名前は避けます。未コミットの変更がある場合は、その変更を現在のブランチで保存してから切り替えてください。既存フォルダーの履歴が別系統の場合も、この新しい clone へ必要な変更を反映する方法を使えます。

Git が認証の画面を出した場合は通常の GitHub サインインを使います。送信にはリポジトリへの書き込み権限が必要です。認証情報をコードやコマンド例に保存する必要はありません。

## 2. 変更と検証結果を確認する

アプリ・資料の関連する変更を同じブランチで管理します。まず差分を確認します。

```powershell
git status
git diff
```

アプリのコードを変更した場合は、依存関係を導入済みの作業フォルダーで、変更に応じたテストとビルドを実行します。

```powershell
npm.cmd test
npm.cmd run build
npm.cmd audit --audit-level=high
# 画面を変更した場合は、Chromium を導入済みの環境で実行
npm.cmd run test:e2e
```

初回の依存導入は [Windows 導入ガイド](09-windows-setup.md)、テストの範囲とブラウザーの導入は [テスト仕様](07-test-specification.md) を参照します。

## 3. ソースと資料をまとめてコミットする

```powershell
git add .
git diff --cached --stat
git diff --cached --name-only
git diff --cached
```

追加対象には、変更した次のファイルが含まれます。

| 対象 | 内容 |
| --- | --- |
| `src/`、`server/`、`shared/` | 画面・API・DB の実装 |
| `docs/` | 企画書・要件定義・画面仕様・設計・API・テスト・運用 |
| `scripts/`、`.vscode/` | セットアップと VS Code のタスク |
| `tests/`、`playwright.config.ts` | 自動テスト |
| `.github/` | CI、Dependabot、バグ報告・機能提案・PR のテンプレート |
| `public/` | PWA の manifest・アイコン・Service Worker テンプレート |
| `Dockerfile`、`compose.yml`、`Caddyfile` | 公開構成例。実ドメイン / 秘密は例に入れない |
| `SECURITY.md`、`CONTRIBUTING.md` | 脆弱性の報告経路・開発方針 |
| `package.json`、`package-lock.json`、各設定 | 依存関係・設定 |
| `README.md`、`START-HERE.md` | リポジトリの入口と初回導入 |
| `.gitignore`、`.gitattributes`、`.env.example`、`.nvmrc` | Git の除外・改行・任意設定見本・Node バージョン |

`.env`、`node_modules/`、`data/`、`dist/`、`dist-server/`、テスト生成物は `.gitignore` により追加されません。DB やビルド済みファイルは各 PC で作成します。すでに追跡されているファイルは `.gitignore` だけでは除外されないため、コミットする差分にも秘密の値や DB がないことを確認します。

確認できたら、変更内容が伝わるメッセージでコミットします。

```powershell
git commit -m "一覧をページ取得に変更してスマートフォンの通信量を削減"
```

Git に名前・メールが未設定というエラーが出たときだけ、自分の情報をリポジトリ単位で設定し、コミットを再実行します。GitHub の非公開メール設定を利用することもできます。

```powershell
git config user.name "自分の Git 表示名"
git config user.email "自分が使用する Git メールアドレス"
```

## 4. 作業ブランチを送信し、Pull Request を作る

```powershell
git push -u origin HEAD
```

[GitHub のリポジトリ](https://github.com/Busaemon/global-flight-monitor)で「Compare & pull request」を選び、取り込み先を `main`、変更元を作業ブランチにします。変更内容、対応する要件、更新した資料、実行したテストの結果を PR テンプレートに記入します。

`non-fast-forward` など履歴の衝突が出た場合は、`git fetch origin` と `git log --oneline --all --max-count=15` で履歴を確認します。既存の変更を保存したうえで取り込み方法を決め、履歴の上書きで解決しないでください。

## 5. GitHub 上で確認する

- PR の「Files changed」が今回の変更に対応している。
- `docs/README.md` から関連する資料が開く。
- 変更した図と画面例が表示される。
- `.env`・実 DB・`node_modules` が含まれていない。

PR を確認して `main` へ取り込むと、ソースと関連資料が同じ履歴に記録されます。以後の変更も、最新の `origin/main` から別の作業ブランチを作って進めます。

## 6. CI と依存更新

[CI 定義](../.github/workflows/ci.yml) は main への push、main 向け PR、手動実行に対応します。Node.js 24、lockfile、バックエンドテスト、型検査 / ビルド（サイズ予算を含む）、開発依存を含む監査、Chromium の画面検証を実行します。失敗時のブラウザー診断は 7 日保存します。

Action は確認した commit SHA に固定し、権限は contents: read、checkout の資格情報を保持しません。PR のコードを秘密のトークンで実行する `pull_request_target` は使用しません。[Dependabot](../.github/dependabot.yml) は npm と Action の更新を週ごとに提案します。更新 PR もテストを確認してから取り込みます。

CI ファイルがあることと、GitHub 側で Actions が許可され実行成功していることは別です。Actions タブで権限 / 実行ログを確認してください。Fork / 初回 contributor には GitHub が実行承認を求める場合があります。

## 7. 管理者が GitHub 上で確認する項目

- main の保護設定または Ruleset で、レビューと CI の成功を取り込み条件にするか運用方針を決める。
- Security の private vulnerability reporting を有効にし、SECURITY.md の経路と一致させる。
- Dependabot alerts / security updates と Actions の許可を確認する。
- 公開資格情報や実 DB をリポジトリの内容 / Issue / Artifact に保存しない。
- プロジェクトの利用許諾を決める。現在の `private: true` は npm 公開を防ぐ設定で、ソースや OpenSky データの利用許諾を与えるものではない。
- リリース時はコミットと公開設定 / 移行 / 未検証項目を記録する。公開 URL が実在しない間は README の公開済みリンクを作らない。

これらの GitHub 設定は、ファイルを追加しただけで変更済みになるものではありません。管理者の実際の設定を確認します。

## 8. GitHub の About に入れる説明

2026-10-08（日本時間）の確認では description / homepage は未設定、topics は空です。利用可能な GitHub 連携から管理項目を更新する要求は HTTP 403 となり、更新できていません。これは GitHub 側の連携権限の制限で、自動承認レビューによる拒否ではありません。ソース / PR の更新と About の管理権限は別です。

管理者がリポジトリのトップページの「About」の編集から、次を設定できます。

**Description**

```text
OpenSkyの観測データで飛行中の機数・地図・機体詳細を確認するWeb/PWA。React・TypeScript・Node.js・SQLite。
```

**Topics**

```text
react typescript pwa opensky flight-tracking sqlite
```

**Website** は正式な HTTPS 公開先が決まって実際に動作してから入力します。架空の公開 URL や PC の localhost を登録しません。private vulnerability reporting も同じ連携からの有効化は 403 で未完了のため、管理者が Settings の Security 関連設定で有効化し、Security タブの報告入口を確認してください。

## 今後の資料更新

企画・要件・実装・テストに変更があるときは、関連文書を同じ変更に含めます。「実装済み」と「計画」を明示し、未検証の性能や外部 API の認証を検証済みとして記載しません。画面・API・DB の変更がどの要件に対応するかを PR テンプレートに記入すると、GitHub 上で変更の理由を追えます。
