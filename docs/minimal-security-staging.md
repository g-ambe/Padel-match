# 最小セキュリティ対策の検証手順

## 実施状況

ローカルの実DDL・RLS・架空Auth状態・本人承認・復旧の結果と最終件数はPR本文に記載します。専用Supabase `padel-hub-staging`（`zzjwpresqkefnyjyisgd`）は作成・SQL適用済みで、実DBの定義・権限・Security Advisorを読み取り確認しました。既存SQLは再適用しません。ユーザーが作成した既存Worker `padel-match-staging`（https://padel-match-staging.ranbo-ga.workers.dev）はHello Worldを配信中との報告です。GitHub自動ビルドは停止中で、今後は既存WorkerへのWrangler CLIデプロイを優先します。アプリのデプロイ・接続先確認が完了するまで、Authユーザー作成・実メール認証・実JWT・PostgREST・ブラウザ・並行操作の書き込み試験は**未実施**です。PITR復元も未実施です。

CodexからCloudflare APIへの通信は環境側のプロキシが拒否し、認証情報もありません。[Windows PCでの既存WorkerへのCLIデプロイ手順](staging-windows-cli.md)にOAuthログイン、ビルド、既存Workerの確認、dry-run、変数を保持したアップロード、GET検証、Workへの引継ぎをまとめました。新しいWorker・プロジェクト・APIトークンは作成しません。

## 検証専用Workerの準備

既存の `padel-match` は本番Supabaseを使用します。PR #160の既存Version URL・ブランチプレビューでも、今後書き込み試験を行いません。別Worker `padel-match-staging` だけを検証に使います。ルートの `wrangler.jsonc`・本番Workerの変数・Builds設定・デプロイには触れません。

`wrangler.staging.jsonc` のWorker名は `padel-match-staging`、実行時URLは検証用Supabaseに固定しています。独自ドメイン・本番リソースのバインディングは追加しません。キーはソースへ保存せず、検証Workerのダッシュボード設定で管理します。`keep_vars` はこの検証Workerの実行時変数を保持するための指定で、本番Workerからの継承ではありません。

本番Workerの非本番ブランチ自動プレビュー生成を停止する変更だけが例外として承認され、ユーザーがブラウザで変更しました。共有された設定画面で「Builds for Preview branches」がOFFであることを確認し、構成変更のpush保留を解除しました。mainの自動デプロイ・本番環境変数・本番Supabaseは変更しません。Workers Buildsでの効果を確認できないコミットメッセージのスキップ指定には依存しません。

既存の検証Workerを使います。新規作成・GitHub自動ビルドの有効化は行いません。CLIを実行するプロセスの**ビルド用変数**と、設定済みの**実行時変数**を下表の検証用の値に揃えます。キーは検証用SupabaseのProject Settings → API Keysから非表示入力へコピーします。secret／service_roleは使いません。チャット・ログ・リポジトリへ貼りません。

| 変数 | 設定先・値 |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | ビルド時／実行時とも `https://zzjwpresqkefnyjyisgd.supabase.co` |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | ビルド時／実行時とも検証用Supabaseのanon key（公開用publishable keyも可） |

1. 検証Workerが存在するアカウントで公式Wrangler OAuthにログインし、既存Workerのデプロイ一覧を取得できることを確認します。失敗したら新規作成へ進まず停止します。
2. `npm run cf:build:staging` でビルドします。`NEXT_PUBLIC_*` はブラウザ向け成果物に埋め込まれるため、実行時変数だけを変えたり、以前の `.open-next` 成果物を流用したりしません。ビルド前チェックはURL・Worker名・公開キーの形式を確認し、値を出力せずに本番URL／別refのanon JWT／service_roleを拒否します。publishable keyの所属はダッシュボードで確認します。
3. `wrangler.staging.jsonc`、`--name padel-match-staging`、`--keep-vars` を明示したWranglerの `--dry-run` を行います。成功後、同じ指定で既存Workerだけへアップロードします。標準の `npm run deploy` や `wrangler versions upload` は使いません。
4. `node scripts/verify-staging-deployment.cjs` でアプリHTML・配信JSと手元の検証ビルドの一致・検証用Supabase公開Auth設定のGETを確認します。Workではさらに実ブラウザ通信先を確認します。キーは画面収録・HAR等へ残しません。この確認が完了するまでは登録・ログイン・保存・本人統合を試しません。
5. 検証用SupabaseだけでAuthentication → URL Configurationを開き、Site URLを上記URL、Redirect URLsを `上記URL/login?confirmed=true` に設定します。既存SQLの再適用・メール確認の無効化・本番Auth設定の変更はしません。

安全な環境変数とCloudflare認証が用意された作業環境から実行する場合は `npm run deploy:staging` が同じ設定で再ビルドしてから検証Workerだけへデプロイします。この操作も無料枠と接続先を確認後に限ります。ブラウザ操作の接続が利用でき、上記の完了が確認できてから、下記の架空ユーザー・試合の試験に進みます。

ローカルでは事前チェック8ケース、専用設定のOpenNextビルド、Wranglerのアップロードしない `--dry-run`、TypeScriptがPASSしました。ブラウザ用JSには検証用URLが含まれ、本番Supabase URLが含まれないことも確認しました。このビルドは架空の形式確認用キーを使っており、実anon keyでの再ビルド・実行時バインディング・ログイン・デプロイの成功を示すものではありません。取得した実キーは出力・ファイル保存していません。

## ローカル検証と実環境試験

| ローカル検証 | 結果 |
| --- | --- |
| 実DDL・RLS・本人承認・途中失敗・保存・適用／再適用／切り戻し | PASS、60ケース。PR #159から32ケースを選択し、28ケースを追加 |
| npm test | PASS、7テストファイル（各ファイル内の試験を実行） |
| 本人プロフィール・既存SDK操作の単体試験 | PASS、43ケース |
| ゲストのsessionStorage | PASS、1ケース |
| Cloudflareビルド | PASS、OpenNext Worker生成。デプロイは未実施 |
| TypeScript | PASS、npx tsc --noEmit --incremental false |

`node scripts/security-staging-check.cjs` は設定不足なら「未実施」で終了します。専用URL・公開キー・JWT等は安全なシークレット管理から環境変数として参照し、ソース・PR・HAR・画面収録・ログに記録しません。

| 変数 | 内容 |
| --- | --- |
| PADEL_STAGING_CONFIRM_NON_PRODUCTION | 専用の非本番であることを確認してtrueを指定 |
| PADEL_STAGING_URL／PADEL_STAGING_ANON_KEY | 本番と別のSupabase接続先・公開キー |
| PADEL_STAGING_MEMBER_JWT／PADEL_STAGING_OTHER_JWT | Aグループ一般・Bグループ管理者の実JWT |
| PADEL_STAGING_EVENT_ID | Aの開催中・非共有の専用fixtureイベント |
| PADEL_STAGING_STAT_ID | 任意。直接更新拒否を試す架空の旧累計行 |
| PADEL_STAGING_EMAIL／PADEL_STAGING_PASSWORD | 任意。専用ログイン試験のシークレット |

スクリプトは本番refを拒否し、JWT確認、公開名・私的列、所属読取、匿名・他グループ拒否、不正Roundの全体取り消し、旧累計への直接更新拒否を確認します。拒否に不具合があればfixtureが変更され得るため、非本番の架空fixtureをバックアップし、他試験と同時に編集しません。

## 一連の実認証・ブラウザ試験

同じSQLを適用した専用Supabaseと、同じコミットのCloudflareプレビューを使います。実選手や本番の個人情報はコピーしません。Aのメイン・サブ・一般、B管理者、無所属、新規本人を専用アカウントで用意し、役割別のブラウザプロフィールを使います。

本番Workerの自動Version URL・ブランチプレビューでは書き込み試験を行いません。上記の検証専用Workerで接続先を確認してから実施します。

1. メール・パスワードで登録し、確認メールを受信して初回ログインします。確認前の連携候補・申請拒否、確認後の本人プロフィール1件、再ログイン・再送時の重複なしを確認します。Googleは使いません。
2. グループ作成でグループと初回管理者が同時に作成されることを確認します。途中失敗時は両方残らず、同じUUIDの再送で増殖しないこと、公開グループの検索、非公開概要の第三者拒否も確認します。
3. 管理者が仮選手を追加し、一般メンバーが参加・自動／手動Round・スコアを保存します。仮選手にも正本の戦績が表示され、旧累計行を作るための架空アカウントが不要であることを確認します。
4. 本人が公開グループから仮選手を選び、加入申請・管理者承認を行います。候補・プレビュー・申請のREST取得から別の非公開グループや内部スナップショットを取得できないことを確認します。
5. 管理者が本人から受け取ったメールを完全一致で検索し、連携申請を送ります。画面に認証UIDが出ないこと、対象本人だけ承認できること、一般・第三者・管理者の代行承認を拒否することを確認します。
6. 2経路とも、所属・参加・通常試合・チーム戦・公式戦の参照、結果ID、過去戦績を確認します。本人設定を上書きせず、二重所属・重複出場・古い確認トークンを拒否します。旧累計・NULL所属はそのままであることも照合します。
7. スコア再送・勝敗の反転・引き分け・単一試合削除を試し、結果が一行で集計が正しいことを確認します。完了状態の更新を失敗させて結果も戻ること、旧累計不一致のfixtureでも通常保存が続くことを確認します。
8. 自動・手動・特別モード・休憩順を既存算法と比較します。2試合目の不正な参加IDでRound全体が残らないこと、2接続の同時生成・同じ要求の再送・本人統合との並行操作で重複や途中保存が起きないことを確認します。
9. 一般で終了・再開、管理者で共有・再発行・停止・論理削除を試します。構造の直接DELETEやグループ・イベントの物理削除を拒否する一方、正規の単一試合削除は維持することを確認します。
10. チーム作成・自由入力の相手・双方の管理者編集・ゲスト・結果・公式戦を試します。管理していない第三者グループのサイドINSERT／変更を拒否し、相手の必要な選手名だけを表示できることを確認します。
11. 通常・チーム・公式・グループなし公式の共有を、匿名と別グループのログインで開きます。正常なグループ名・同名の別選手・結果を表示し、認証UIDやトークンを返さないこと、無効・停止・再開・削除後の拒否を確認します。公開名・画像は取得でき、私的プロフィール詳細は本人だけ取得・編集できることも確認します。
12. ゲストのsessionStorage操作、動画リンク・クリック、退会後の本人の終了試合を確認します。0039専用復旧を既定ROLLBACKで予行し、対象を承認してfixtureで復旧します。適用直後のメタデータ切り戻し・行ハッシュ不変、稼働後の変更があれば停止すること、実DBバックアップの復元も確認します。
13. 同じグループの一般・管理者それぞれのJWTで、既存参加者の `player_profile_id`・旧 `profile_id` の別人指定／NULL解除、`participant_type` の単独変更／人物IDとの同時変更をPATCHし、拒否と人物・試合・戦績の不変を確認します。状態・ゲスト名のPATCHと既存RPCによる未採点の組合せ変更は成功し、0039の両承認経路では本人統合・履歴引継ぎが成功することを確認します。

ケースID、役割、期待結果、実件数、PASS／FAIL／未実施、実施者、コミット、非本番refを記録します。トークン・メール・パスワード・生のレスポンスを結果報告へ出力しません。SQLのロール再現を実JWTやブラウザのPASSとして扱いません。

## テーブル・画面の対応

| テーブル・境界 | 画面・確認する機能 |
| --- | --- |
| auth.users／profiles | 登録・メール確認・ログイン。Auth設定の変更なし、メール列の直接SELECT拒否 |
| player_profiles／public_player_profiles | 本人プロフィール取得・更新、名前・画像の公開、同名の別人、私的詳細の拒否 |
| clubs／club_members | グループ検索・詳細・作成・仮登録・改名・役職・退会・復帰・論理削除 |
| join_requests／player_profile_link_requests | 本人加入、完全一致メール検索、管理者申請、本人承認、申請の私的JSON保護 |
| player_profile_merges／profile_link_private.merge_changes | 0039の監査・確認後変更の拒否・専用復旧 |
| events／event_participants | home・イベント詳細・参加者自動反映・終了・再開・共有・論理削除 |
| rounds／matches／match_players／match_results | 自動・手動Round、組合せ、スコア再送・再編集・単一試合削除・途中失敗 |
| player_stats | 旧累計を保持、API書込拒否。現在の画面は正本結果から集計 |
| event_team_sides／event_team_matches／event_team_guests | チーム作成・所属変更制御・双方の操作・名前・ゲスト・結果 |
| official_events／official_opponents／official_matches | 公式戦作成・結果・本人統合後の参照・共有 |
| event_video_links／各video_clicks | 動画・既存クリック計測。一般レート制限は別課題 |
| get_shared_event | 通常・チーム・公式のトークン検証と固定表示項目 |
| sessionStorage | 未ログインの一時ゲスト保存・終了・再開・消去 |

全行で実ブラウザ試験は未実施です。PR #159とのコード・ローカル試験の最終比較は設計資料に記載しています。旧PRを置換として閉じても、本番適用前のステージング検証は必要です。追加機構を増やす作業より、上記の正常動作検証を優先します。
