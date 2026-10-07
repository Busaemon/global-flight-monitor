# 既存フォルダーに追加して起動する

画像の VS Code にある `global-flight-monitor` フォルダーを、そのまま使えます。

VS Code の「ターミナル」→「新しいターミナル」で PowerShell を開き、`Get-Location` が既存の `global-flight-monitor` フォルダーを指していることを確認します。Node.js **24.5 以上**と Git が必要です。

GitHub にある完成版を一時フォルダーへ取得し、必要なファイルだけ既存フォルダーへ追加します。次をまとめて貼り付けてください。

```powershell
& {
    $incoming = Join-Path ([IO.Path]::GetTempPath()) ("skytrace-" + [guid]::NewGuid().ToString("N"))
    git clone --depth 1 --branch main https://github.com/Busaemon/global-flight-monitor.git $incoming
    if ($LASTEXITCODE -ne 0) { throw "GitHub からの取得に失敗しました。" }
    node (Join-Path $incoming "scripts/install-existing-folder.mjs") .
    if ($LASTEXITCODE -ne 0) { throw "ファイルの配置に失敗しました。" }
    npm.cmd run setup
    if ($LASTEXITCODE -ne 0) { throw "セットアップに失敗しました。" }
    npm.cmd run dev
}
```

配置スクリプトは、既存の `.git`・`.env`・DB・追加ファイルを保持します。同名のアプリファイルを変更する場合は、変更前のファイルを OS の一時フォルダーへバックアップし、その場所を表示します。アプリを停止してから実行してください。GitHub の認証画面が出た場合は、通常の GitHub サインインを行います。

すでにファイルを配置済みの場合は、`Test-Path .\package.json` が `True` になるフォルダーで次の2コマンドだけを実行できます。

```powershell
npm.cmd run setup
npm.cmd run dev
```

`setup` が依存関係をインストールし、SQLite データベースを作成し、型検査と画面のビルドを行います。既存の DB を削除しません。Node.js **24.5 以上**が必要です。`node --version` で確認できます。

開発画面は、ご自身の PC のブラウザーから `http://localhost:5173` で開きます。停止はターミナルで `Ctrl+C` を押します。次回は `npm.cmd run dev` だけで起動できます。

実データは OpenSky の観測範囲の値です。匿名アクセスの標準更新間隔は15分、OAuth 設定時は2分です。「デモ」では合成データで操作を確認できます。データソースの制限を含む仕様は [要件定義](docs/02-requirements.md) に記載しています。

## 資料も一緒に GitHub へ追加する

企画書・要件定義・画面仕様・技術設計・DB 設計・API 仕様・テスト仕様などを `docs/` に同梱しています。[資料一覧](docs/README.md) と [GitHub 追加手順](docs/10-github-guide.md) を参照してください。ソースと資料を1つのコミットで追加できます。

GitHub の「Code」→「Download ZIP」を使う場合は、展開後の `global-flight-monitor-main` フォルダーの**中身**を既存フォルダーへコピーします。ZIP には Git 履歴が含まれません。同名のファイルがある場合は、コピー前に既存フォルダーをバックアップしてください。

詳しいフォルダー構成・セットアップ・困った場合の対応は [Windows / VS Code 導入ガイド](docs/09-windows-setup.md) にあります。
