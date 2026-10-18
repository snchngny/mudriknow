# 無料枠の匿名資料受付

Cloudflare Workersで投稿を受け、GitHub Actionsが30分ごとにmanual/catalog.jsonへ自動取り込みする。予定実行には遅延があり得る。利用者のGitHubアカウント・ローカルサーバー・Dockerは不要。GitHubトークンをCloudflareへ預けない

公式受付はmanual/service.jsonに掲載し、アプリが自動取得する。公開URLにはアプリ名を使い、個人のメールアドレスや元アカウント名を含めない

## 運営者の初期設定

1. Cloudflareの無料アカウントを用意し、Workers Paidは有効化しない
2. worker/で`npx wrangler login --scopes account:read user:read workers:write workers_scripts:write workers_routes:write`を実行
3. `npx wrangler deploy`で公開。SQLite-backed Durable Objectを無料枠の受付保管に使う。wrangler.jsoncにアカウントIDや秘密値を入れない
4. GitHub Actionsのmanual-syncを有効にする。書き込みはActions組み込みのGITHUB_TOKENを使用し、利用者やCloudflareへ配布しない
5. manual/service.jsonのsubmissionUrlへ公開URLを設定しGitHubへ反映。アプリが自動取得する。個別の受付URLはアプリの接続設定でも上書きできる。共有台帳は既定のGitHub Rawのまま使用できる

無料枠を超えた場合は受付が制限される。自動で有料プランへ変更しない。受付は最大1000件。未取り込みの資料情報も公開用メタデータとしてpending.jsonで参照可能

## 自動検証

許可した公式サイトの公開HTTPS URLだけを受け付ける。URLのクエリ・認証情報、メールアドレス・ローカルパス、未知の項目、大きすぎる投稿を拒否。本文を取得・転載しない。版不明は空欄のまま保持

内容ハッシュで重複排除し、Actions側でも同じ条件を再検証。台帳だけを更新する。GitHub上の別変更と競合した場合は上書きせず失敗し、次の定期実行で再取得する。投稿者名・IP・会話・画面を台帳へ保存しない。Workerのアプリログは無効。CloudflareやGitHubの基盤側の記録まで匿名性を保証するものではない

投稿内容の正確性や個人情報の完全な自動判別は保証できない。許可ドメインは運営が追加する。不適切な登録は台帳から削除し、IDをmanual/blocked.jsonへ追加して再取り込みを防ぐ

無料枠の仕様: https://developers.cloudflare.com/workers/platform/limits/
