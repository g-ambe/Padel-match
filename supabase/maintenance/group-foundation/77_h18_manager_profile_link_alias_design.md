# TASK-08-03 / H18：管理者発信プロフィール連携における別名・本人同意のDB調査

2026-11-20、既存Draft PR #265／`codex/task-08-group-foundation`。**調査・設計のみ**。本番DB変更、Stage新Migration適用、アプリ改修はこの工程で行わない。

## 現物確認（Stageの関数・列）

- 管理者が送る `public.request_player_profile_link(club_id,member_id,target_auth_user_id)` は、対象グループの管理権限と役職、仮プロフィールの未連携状態、受信先本人の登録状態、競合中申請を確認した後、`player_profile_link_requests`へpendingを登録して通知する。
- 受信者は `public.get_player_profile_link_request(request_id)` で自分だけの `profile_link_private.scoped_preview`（履歴・同意確認用`review_token`）を取得する。管理者側には当該クラブに限定した`source_display_name`と役職等のみを返し、他グループの履歴は返さない。
- 受信者の `public.review_player_profile_link(request_id,decision,review_token)` は本人のみのapproved/rejected、管理者によるcancelledを区別。期限、依頼元管理者の現役権限、別グループ影響、対象行、canonical profile、preview hash/tokenの不一致を検査し、approvedなら`profile_link_private.merge_profiles`で所属・各戦績の正規プロフィールIDを統合し、`merge_changes`にbefore/afterを保存する。通知を同トランザクションで作成。
- 現行`player_profile_link_requests`には、**受信者が選んだグループ内表示名と、公開への本人確認の保存先がない**。現在の`get_player_profile_link_request`のsourceの表示名はグローバル`player_profiles.display_name`を起点にしており、**既存の`club_members.club_display_name`が存在する場合の初期表示を保証していない**。
- 現在の旧`review_player_profile_link`経由で連携が成立しても、H16`get_public_club_directory`はlinkedかつ明示public確認のない行を返さないため、旧ルートが**未確認名を勝手に公開するわけではない**。ただし新しい本人確認フローは別途必要。
- 検証でH17検索加入が採用した`join_requests`の承認トリガーを、この`player_profile_link_requests`に直接流用しない。**承認者が管理者ではなく受信者本人で、review_tokenと当該グループの情報開示範囲が異なる**ため。

## 次のGPT DB実装案（未適用）

1. `player_profile_link_requests` に**nullable**な`club_display_name_selected`と`club_display_name_public_confirmed_at`を追加。旧pending/approvedを無断バックフィル・公開しない。申請者が管理者であっても本人の選択名・確認時刻を代行記録しない。
2. 既存 `get_player_profile_link_request`の**受信者だけ**のDTOに`group_display_name_suggestion`を追加。初期値：対象グループの`club_members.club_display_name`、NULLなら当該仮登録選手の元の`player_profiles.display_name`。manager側DTOは拡張せず、認証ID・他グループの履歴・非公開データを増やさない。
3. 別名を伴う本人承認用の**新RPC**（例 `review_player_profile_link_named(request_id,'approved',review_token,display_name,public_confirmation)`）を作る。期限・受信者の実`auth.uid()`・public名の明示確認・CAS/旧token・対象所属と依頼元の権限を確認。**従来の`review_player_profile_link`が保有する同意snapshot/merge保護は維持し、承認・所属別名反映・リンク申請への本人選択名保存・`merge_changes.after_row`更新を1トランザクションで確定**。途中エラーでは全体ROLLBACK。
4. `rejected`／管理者`cancelled`は既存RPC維持。旧pendingを旧承認経路で処理した場合は**public未確認なら名簿に出さず**、本人がH16で改めて公開同意できるようにする。連携先の既存プロフィール名、他グループ、スコア/ランキングは不変更。
5. privateグループで別名を保存してもpublic同意にならない。公開へ変更されても勝手に確認済み扱いをしない。既存未連携選手が後でlinkedになった場合の公開境界もSQL/実HTTPの負例で確認。

## 受入ゲート

- Stage限定 `BEGIN/ROLLBACK`：publicの本人同意なし/他人承認/期限切れ/旧token/元メンバー更新/申請元権限喪失を拒否。受信者の同意した別名のみ適用し、元の仮登録別名をH16と整合する初期提案に使える。
- グループ外の履歴が含まれる場合は旧RPCどおり保護し、本人プレビューと統合変更スナップショットが正確に一致する。
- `player_profile_merges`の1対1履歴、`profile_link_private.merge_changes.before_row/after_row`、拒否時の完全ロールバック、通知、他グループの不変を確認。
- 実Stage Auth HTTP正負例、Codexの受信者専用POP、本人確認のチェック/テキスト、ヘルプ同期、モバイル/明暗テストを別工程で実施。
- 既存PR #265にGPTが正式Migrationを追加/Stage適用→合格後Codexへアプリ実装指示→GPTの統合レビュー。**Prod ACL/RLS・Cloudflare本番・マージは無断実施しない**。

## H17までの足場

- `0058_public_join_alias_consent.sql`／`0059_public_claim_named_alias_gateway.sql`／`0060_named_join_merge_snapshot.sql`は**検索からの加入**専用。これらを変更して管理者依頼を無理に統合しない。
- H17 Codex `95834b8919aba20fb8e50e6518590398812d7f30` のアプリ差分は6ファイルのみと確認。新規加入/仮選手本人申請の新named公開RPC使用・2つの同意確認をコードレビューで確認。実Stage JWT/HTTP **13/13 PASS**（Actions #44645381119）、実HTTP申請2件を使った**承認/merge監査SQL ROLLBACK全項目PASS**、専用テストfixture/通知・申請は完全削除。通常read-only CI復帰 **#44645615173 SUCCESS**。
