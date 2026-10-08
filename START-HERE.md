# 既存フォルダーに追加して起動する

VS Code で既存の `global-flight-monitor` フォルダーを開き、「ターミナル」→「新しいターミナル」で PowerShell を開きます。`Get-Location` で目的のフォルダーを確認してください。Node.js **24.5 以上**と Git が必要です。

## ファイルがすでにある場合

`Test-Path .\package.json` が `True` になるフォルダーで実行します。

```powershell
npm.cmd run setup
npm.cmd run dev
```

画面は自分の PC の `http://localhost:5173`。初期表示は実データです。取得できない場合は状態を表示し、明示的にデモを選ぶと合成データで操作確認できます。停止は `Ctrl+C`、次回の起動は `npm.cmd run dev` です。

## GitHub の main から既存フォルダーへ追加する場合

このアプリを停止してから、以下をまとめて貼り付けます。これは **GitHub の `main` に取り込み済みの版**を取得します。レビュー中の PR の版を適用する場合は、PR に記載されたブランチを確認して `--branch main` を置き換えます。

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

配置スクリプトは `.git`・`.env`・DB・独自の追加ファイルを保持し、変更する同名ファイルは OS の一時フォルダーへバックアップします。バックアップの場所は実行結果に表示されます。既存フォルダーの Git 履歴を GitHub と同期する処理は行いません。GitHub が非公開の場合は Git が表示する通常のサインインを使用します。

## スマートフォンとホーム画面

スマートフォンにも対応した画面です。PWA をホーム画面に追加するには、自分のサーバーへ HTTPS で公開してください。スマートフォンの `localhost` はスマートフォン自身を指すため、PC の `http://localhost:5173` をそのまま入力しても接続できません。

公開先と OpenSky の OAuth クライアントはまだ未確定です。コード内のデモを実データに見せかける設定はありません。OAuth 未設定でも匿名取得は利用できますが、標準の外部更新間隔は 15 分です。公開手順・必要な設定・未検証項目は [運用手順](docs/11-operations.md) と [公開前チェック](docs/deployment-checklist.md) に記載しています。

## 詳しい資料

[企画・要件・設計などの資料一覧](docs/README.md) · [Windows / VS Code 手順とトラブル対応](docs/09-windows-setup.md) · [GitHub への変更の送り方](docs/10-github-guide.md)
