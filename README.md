# MudrikNow

操作中のアプリと版を読み取り、画面とマニュアルを参考に操作方法を答えるデスクトップアシスタント。[元のMudrikNow](https://github.com/abdallahmagdy15/mudriknow)を拡張したMITライセンスの派生版

## インストール

[Releases](https://github.com/snchngny/mudriknow/releases)からWindows用Setup.exe、Mac用DMGを取得。OpenCodeと実行環境は同梱し、Node.js・Docker・別途のOpenCode導入は不要

未署名のためOSの確認画面が出る場合がある。Mac版はApple SiliconとIntelを別々に提供。Macでは画面収録の許可が必要

## 使い方

1. 起動後、接続設定からChatGPTへログインし、表示された利用可能モデルを選ぶ
2. 説明してほしいアプリを前面にしてAlt+X。MacではOption+X
3. チャットで質問。画面・アプリの版・保存資料を合わせて回答

Jev判別器は任意。無効時は画面を取得して回答する。有効時は対応APIへの接続が必要。ChatGPTの契約・利用上限に従い、無制限に使える保証はない

ウィンドウの位置・サイズ、調査結果、取得した資料は端末のアプリ保存領域に保持。資料の版が不明・アプリと異なる場合は回答に明示する。重要な操作は出典も確認する

## マニュアル共有

[manual/](manual/)の公開台帳をGitHubアカウントなしで取得できる。「共有資料を取得」で対象アプリ・OSに合う資料を保存し、以降はローカル検索で再利用する

匿名投稿は公開資料のURL・アプリ名・資料の版・言語・ライセンス情報のみ。会話・画面・資料原文・氏名・メールアドレスを投稿しない。公開受付が設定されている場合、検証を通った情報を自動で台帳へ保存する。[受付の運営設定](worker/README.md)を参照

資料本文の著作権は提供元に帰属する。共有台帳は資料への案内であり、原文の転載先ではない。版不明の情報を特定版の保証として扱わない

## 開発

Node.js 22.13以降とnpmを使用

```sh
npm ci --ignore-scripts
node node_modules/electron/install.js
npm install --prefix .local/opencode --ignore-scripts opencode-ai@1.19.3
npm run bundle:opencode
npm test -- --maxWorkers=2
npm start
```

インストーラーはGitHub Actionsのreleaseを手動実行、またはvから始まるタグで作成。無料の標準ランナーを使用。署名・公証は未設定

## 保存と通信

認証は同梱OpenCodeが端末のアプリ保存領域で管理する。画面・質問は選択したAIサービスへ送信される。資料調査にはアプリ名・版・提供元を使う。投稿したメタデータは公開される。受付事業者による通常のネットワーク処理まで完全匿名を保証するものではない

認証情報・会話・画面キャプチャ・取得資料・開発者のローカル設定はGit管理と配布から除外する

## ライセンス

上流の取得元と基準commitは[upstream-source.json](upstream-source.json)。[LICENSE](LICENSE)、[同梱ソフトの表記](THIRD_PARTY_NOTICES.txt)を参照
