# 無料枠の匿名資料受付

Cloudflare Workersで投稿を受け、公開GitHubのmanual/catalog.jsonへ自動保存する。利用者のGitHubアカウント・ローカルサーバー・Dockerは不要。公開受付は運営アカウントの設定後に有効になる

## 運営者の初期設定

1. Cloudflareの無料アカウントを用意し、Workers Paidは有効化しない
2. GitHubで対象repoだけにContents読み書きを許可したfine-grained tokenを作成。有効期限を設定する
3. worker/で`npx wrangler login`、`npx wrangler secret put GITHUB_TOKEN`を実行。トークンをファイルへ保存しない
4. `npx wrangler deploy`で公開。wrangler.jsoncにアカウントIDや秘密値を入れない
5. manual/service.jsonのsubmissionUrlへ公開URLを設定しGitHubへ反映。アプリが自動取得する。個別の受付URLはアプリの接続設定でも上書きできる。共有台帳は既定のGitHub Rawのまま使用できる

無料枠を超えた場合は受付が制限される。自動で有料プランへ変更しない。運営用tokenは利用者やアプリへ配布しない

## 自動検証

許可した公式サイトの公開HTTPS URLだけを受け付ける。URLのクエリ・認証情報、メールアドレス・ローカルパス、未知の項目、大きすぎる投稿を拒否。本文を取得・転載しない。版不明は空欄のまま保持

固定の台帳パスだけを更新し、内容ハッシュで重複排除。競合時は最新台帳を再取得して再試行する。投稿者名・IP・会話・画面はGitHubへ保存しない。Workerのアプリログは無効。CloudflareやGitHubの基盤側の記録まで匿名性を保証するものではない

投稿内容の正確性や個人情報の完全な自動判別は保証できない。許可ドメインは運営が追加し、不適切な登録は台帳から削除する

無料枠の仕様: https://developers.cloudflare.com/workers/platform/limits/
