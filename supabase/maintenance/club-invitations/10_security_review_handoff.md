# TASK-08-02 独立セキュリティレビューへの引継ぎ

2026-11-27。実装・試験対象: `ccc2b3b70200e56fa8e4c7ea81c00e8fafa43e3b`。この文書は実装者による整理であり、独立レビューの完了やリリース承認ではない。Issue #262、Draft PR #273。

## 対象と境界

PRの変更ファイル全体は `git diff --name-only origin/main...HEAD` を参照。主な対象は `app/api/club-invitations/send/route.ts`、`lib/club-invite-send-handler.ts`・`club-invite-delivery.ts`・`club-invite-smtp.ts`・`club-invite-link.ts`・`club-invitations.ts`、管理者/本人画面、関連テスト、`supabase/maintenance/club-invitations/` の既存SQL候補と検証資産。今回追加の製品SQL/RLS変更・本番DB適用はない。SQL候補は既存PRの一部であり、実DBへの適用・整合は別のゲートが必要。

製品の配送APIは `DELIVERY_ENABLED=false` の固定ガードで、認証、予約や配送より前に停止する。匿名bearer modeもhandlerが拒否し、IP正規化/HMAC部品は入口に接続していない。OFFのため招待メールの実運用は未完成。

## 認証・状態・秘密情報

認証済み要求はサーバーでユーザーを検証し、service RPCへ検証済みactorを渡す。宛先はclaimの結果のみを使用する。予約→claim→配送→finalizeの順序、同一操作IDの再実行、失敗・結果不明での自動再送禁止を維持する。申請・配送・本人同意は別の状態で、取消/期限・世代変更後の旧リンクを拒否する。メールのリンクはfragmentに保持し、画面で除去後、同じタブのsessionStorageに一時保存する。無効リンク・明示取消・確定時に消去する。RLS/ACL、RPC認可、ログ・Referer・キャッシュ・アカウント切替時の境界を独立に確認すること。

制限はDB候補側の管理者/宛先/グループ等の枠と、匿名IP 10回/10分・招待ID 3回/10分を想定する。匿名入口が閉じた現在、IP制限の実入口動作は未検証。上限や秘密鍵が本番で正しく設定済みとは判断しない。

## Cloudflare入口

読み取り時点のCloudflare APIでは本番 `padel-match` のworkers.devがenabled、preview URLsもenabled。アカウントのWorkers custom domains一覧は0件だったが、ゾーンのroute、WAF、別の入口や全設定を網羅的に取得できたことは意味しない。GitHub PRのstaging previewは成功したが、アクセス制御の証明ではない。ローカル `wrangler.jsonc` の内容だけで実環境の有効経路や信頼境界は確定できない。

ユーザー提供のCloudflare公式資料では同一ゾーンWorkerのsubrequestで `x-real-ip` の変更が `CF-Connecting-IP` に影響し得る。異なるゾーンのWorkerには固定IPが使われ、Worker識別のWAF属性は `cf.worker.upstream_zone`。現在の全経路について信頼できる直接入口・Worker subrequest遮断・偽装ヘッダー・Pseudo IPv4を証明できず、匿名再送はOFF。公式ページの本環境からの直接取得は403。

匿名OFFの段階的リリースは、管理者/認証済み本人側の代替導線と利用者案内が承認仕様を満たすこと、配送の有効化と必要なDB・鍵・安全性・独立レビュー・本番承認が完了することを条件に検討可能。現時点でGOではない。匿名対応を有効化する前に、すべての公開経路（workers.dev/preview/route/custom domainを含む）で信頼できる入口とWorker subrequest判別・遮断を実証し、無料プランで利用可能な構成とIP正規化/HMAC、10/3制限、偽装・代替経路の負例を検証する。設定変更は別途承認が必要。

## 検証と未確認

- `TASK0802_COMBINED=1 python3 supabase/maintenance/club-invitations/isolated-http/run.py`: ローカル実GoTrue/PostgREST＋handler・モック配送で2グループ招待、本人参加/別招待の拒否、部外者拒否、配送状態、スコア・別所属保全、取消/期限後再招待と旧リンク拒否PASS。クールダウン・期限は隔離DBで擬似経過。使い捨てコンテナ・network・データの削除確認。
- b73b302の実GoTrue/PostgREST/Mailpit: handler経由の確認メール再送、同一操作IDで二重送信なし、未登録/確認済/部外者拒否、確認・ログイン・参加、別メール付替と旧リンク拒否PASS。実SMTP・本番/StageのAuthではない。
- 375px/1280pxブラウザは架空Auth/モックで招待確認・入力保持・再試行・付替・無効fragment消去・reboundの再送拒否PASS。TypeScript、招待関連単体7ファイル、Cloudflare OpenNext buildは6b90d79でPASS。以後の変更は試験と本文書のみ。
- GitHubのb73b302のprivate-media checksとstaging previewはSUCCESS。実本番配信の証明ではない。
- 実Cloudflare入口の認証・WAF・代替経路、実SMTP配送、実環境の秘密/cron/DB適用、匿名経路のIP制限、全操作の実Worker上の結合、独立セキュリティレビューは未実施。候補SQLの性能/実環境カタログ・移行順序・復旧の最終照合と明示的な本番承認も別途必要。

## 独立レビューの重点

1. 固定OFFが予約・認証・送信より前に確実に働くことと、有効化後の本人認証・CSRF・service role境界。
2. claimで確定した宛先以外への送信防止、確認メールと招待メールの配送/結果不明/冪等性、並行・失敗時整合性。
3. 複数招待・付替・取消・再招待・公開設定・プロフィール/戦績引継ぎと旧リンクの失効。
4. 招待fragment、sessionStorage、ログ/エラー・レスポンス、キャッシュ・Referer・アカウント切替の秘密漏えい防止。
5. SQL候補のRLS・ACL・RPC、権限、quota、鍵・監査保持と本番適用/復旧方針。
6. Cloudflare全入口の信頼境界、匿名OFFを維持した段階的提供の仕様妥当性、独立した実環境検証・本番承認条件。
