# OTHER-03 パスワード再設定・メールテンプレート

Issue #271。新規のDBテーブルやMigration、既存のAuth方式変更はない。メールテンプレート候補は `supabase/email-templates/confirm-signup.html` と `supabase/email-templates/reset-password.html` に保存している。原文はIssue #271のコメント7155832302。件名はそれぞれ「【PADEL MATCH】メールアドレス認証のお願い」「【PADEL MATCH】パスワード再設定のご案内」。

メールのTokenHashはfragmentからメモリに取り込み、URLを消去。明示操作までverifyOtpを実行しない。回復専用の非永続Supabaseクライアントが確認したユーザーIDだけを変更する。変更成功後、回復クライアントでglobal signOutし、通常クライアントも同じユーザーならlocal signOutする。通信結果不明時は再送を促さずログインでの確認を案内する。refresh tokenは失効しても既発行JWTは期限まで有効となり得る。送信間隔はブラウザ側60秒以上に加え、Auth側の既存レート制限を維持する。

## 本番反映時（別途承認が必要）

1. 最新の本番テンプレート・認証URL許可設定を控える。回復導線の停止またはメンテナンスを先に実施し、切替中は再設定メールを送れない状態にする。停止手段と既存メールの扱いを確定できなければ本番作業を開始しない。回復ページを配信可能な状態で検証する。
2. 正しい環境に `NEXT_PUBLIC_APP_ORIGIN` を完全なorigin（末尾スラッシュなし）として設定する。省略時は既存本番 `https://padel-match.ranbo-ga.workers.dev`。プレビュー等では当該環境のHTTPS originを明示し、同じorigin以外で送信しない。任意のredirectパラメータは受け付けない。
3. Supabase Auth URL設定で当該環境の `/auth/reset-password` を許可し、Confirm signup／Reset passwordテンプレートと件名を対象環境に設定する。メールの許可URL・fragment・二重のhash、メールクライアントの先読みや別端末を確認する。既存ConfirmationURL契約、SMTP、他テンプレート、有効期限は変更しない。
4. 導線停止を維持したまま、安全なテストアカウントで対象環境の回復、same_password、旧・新パスワード、他セッション失効、既存ログイン／登録を確認。成功後に導線を再開する。異常時は送信を停止したまま、事前に控えた設定へ戻し、配信中コードとの互換性を確認する。

本PRではSupabase Dashboard・Cloudflare設定・本番データの変更はしていない。対象環境のメール変数・許可リスト・配信前後の組み合わせを確認するまではリリースしない。

## 検証記録

- ローカル隔離GoTrue v2.197.0、PostgreSQL 17、Mailpit：架空2アカウントで日本語Reset HTMLの実展開（TokenHashは56桁）、verifyOtpの一回限り、same_password、同セッションでの再入力、global logoutによる既存2 refresh token拒否、旧PW拒否・新PW成功、別アカウント維持をHTTPで確認。テスト専用コンテナと一時DBは削除済み。
- `node --test --test-isolation=none tests/password-recovery.test.cjs`：4件PASS。
- `tests/browser/password-recovery.cjs`：架空HTTP、375pxライト／ダークで直接アクセス拒否、明示操作までverifyしないこと、same_password後再入力、signout、60秒待ちとリロード後の維持を確認。
- TypeScript／ローカルCloudflare OpenNext build PASS。
- 未検証：本番・Stageの実Auth/SMTP設定と実データ、期限切れの実Auth操作、実際の別端末・メールクライアント先読み、確認メールHTMLの実送信・実表示、実機iPhone、実グループ／戦績データ維持、パスワード更新後の既発行JWTの有効期間、更新直後の通信断・全端末ログアウト失敗の実Auth再現。本番のAuthのsame_passwordポリシーとトークン形式も適用前に要確認。
- テストfixtureのAuth自動確認設定とモックUIは本番環境と同一ではない。GoTrue隔離HTTP結果、ブラウザモック結果、実環境の確認を混同しない。
