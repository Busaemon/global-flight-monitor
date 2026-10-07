# ソースと資料をまとめて GitHub に追加する

対象リポジトリは `Busaemon/global-flight-monitor` です。`docs/` の Markdown は GitHub 上でそのまま読み、リンクから企画・要件・設計・テスト・運用の資料へ移動できます。図は Mermaid、画面例は `docs/images/` にまとめています。

このガイドはお使いの PC から送信する手順です。配布 ZIP に Git 履歴や認証情報は入れていません。

完成版を GitHub から取得する場合は [Windows 導入ガイド](09-windows-setup.md) を使います。既存フォルダーへの配置スクリプトはローカルの Git 履歴を変更しません。GitHub 側にすでに `main` の履歴があるため、独立した初期コミットを作って同じ `main` に送信すると衝突します。今後の変更を送信する際は、GitHub の履歴から作業ブランチを作るか、既存履歴との関係を確認してから取り込んでください。下記の「GitHub 側が空」の手順は、空のリポジトリへ初めて配置する場合に限ります。

## 1. まずフォルダーを確認する

VS Code で既存の `global-flight-monitor` を開き、PowerShell ターミナルで確認します。

```powershell
Test-Path .\package.json
Test-Path .\docs\README.md
Test-Path .\.gitignore
```

3つとも `True` になれば、アプリ本体・資料・除外設定が同じフォルダーにあります。

## 2. Git の状態を確認する

`.git` がある場合は既存の設定を使います。

```powershell
if (-not (Test-Path .git)) {
    git init -b main
}
git status
git branch --show-current
git remote -v
```

まだコミットが一度もない初期リポジトリで、ブランチ名が `main` でない場合だけ、次で初期ブランチ名を `main` にします。既存の履歴があるブランチはそのまま使います。

```powershell
git branch -M main
```

`origin` が登録されていない場合に限り、次を実行します。すでにある場合は追加し直さず、接続先が目的のリポジトリか確認します。

```powershell
git remote add origin https://github.com/Busaemon/global-flight-monitor.git
```

VS Code のソース管理機能から GitHub にサインインすることもできます。Git が認証の画面を出した場合は通常の GitHub 認証を使用します。トークンの値を README やコマンド例へ保存する必要はありません。

## 3. 送信する内容を確認して、まとめてコミットする

```powershell
git add .
git diff --cached --stat
git diff --cached --name-only
```

追加対象には、次が含まれます。

| 対象 | 内容 |
| --- | --- |
| `src/`、`server/`、`shared/` | 画面・API・DB の実装 |
| `docs/` | 企画書・要件定義・画面仕様・設計・API・テスト・運用 |
| `scripts/`、`.vscode/` | セットアップと VS Code のタスク |
| `tests/`、`playwright.config.ts` | 自動テスト |
| `.github/` | バグ報告・機能提案・PR のテンプレート |
| `package.json`、`package-lock.json`、各設定 | 再現するための依存関係・設定 |
| `README.md`、`START-HERE.md` | リポジトリの入口と初回導入 |
| `.gitignore`、`.gitattributes`、`.env.example`、`.nvmrc` | Git の除外・改行・任意設定見本・Node バージョン |

`.env`、`node_modules/`、`data/`、`dist/`、テスト生成物は `.gitignore` により追加されません。DB やビルド済みファイルは各 PC で作成します。もし以前から追跡されている `.env` や DB がある場合は、除外設定だけでは追跡が解除されないため、その履歴を確認してから送信します。

内容を確認後、1つのコミットにまとめられます。

```powershell
git commit -m "Add flight monitor app and project documentation"
```

Git に名前・メールが未設定というエラーが出たときだけ、自分の情報をリポジトリ単位で設定し、コミットを再実行します。GitHub の非公開メール設定を利用することもできます。

```powershell
git config user.name "自分の Git 表示名"
git config user.email "自分が使用する Git メールアドレス"
```

## 4. GitHub に送信する

GitHub 側が空で、現在のブランチが `main` の初回追加は次を実行します。

```powershell
git push -u origin main
```

既存の別ブランチで作業している場合は、そのブランチを送信します。

```powershell
git push -u origin HEAD
```

GitHub で Pull Request を作成し、実装と資料を確認して `main` へ取り込めます。直接 `main` に送れない設定の場合も、この方法を使います。

`non-fast-forward` など既存履歴との衝突が出た場合は、強制 push せず、`git fetch origin` と `git log --oneline --all --max-count=15` でローカル／リモートの履歴を確認します。既存の変更を保持した上で取り込み方法を決めます。送信先に予想しないコードがあれば、その変更を先に確認してください。

## 5. GitHub 上で確認する

- トップページに README が表示される。
- `docs/README.md` から各資料が開く。
- 図と画面例が表示される。
- `src`・`server`・`shared`・`tests` がある。
- `.env`・実 DB・`node_modules` が含まれていない。

## GitHub のブラウザー画面から追加する場合

「Add file」→「Upload files」からソースと資料を追加する方法もあります。GitHub は ZIP をソースに展開しないので、ZIP 自体ではなく展開後のファイルを選びます。`node_modules`、`data`、`dist`、`.env` は選択しないでください。Web アップロードは `.gitignore` による選別を行わないため、上の Git コマンドの方法を推奨します。

## 今後の資料更新

企画・要件・実装・テストに変更があるときは、関連文書を同じ変更に含めます。「実装済み」と「計画」を明示し、未検証の性能や外部 API の認証を検証済みとして記載しません。画面・API・DB の変更がどの要件に対応するかを PR テンプレートに記入すると、GitHub 上で変更の理由を追えます。
