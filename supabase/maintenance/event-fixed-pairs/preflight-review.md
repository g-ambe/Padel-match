# 本番メタデータの確認記録

利用者が `01_preflight.sql` をSQL Editorで手動実行し、2026年11月2日17:05:55（日本時間、captured_at `2026-11-02T08:05:55.787751+00:00`）のJSON結果を共有した。ここにはレビュー結果だけを記録し、個人データや接続情報は含めない。

- 対象11表すべてRLS有効。新スキーマ `fixed_pair_private` は未作成。
- eventsは `rls10_events_update_members` と既存管理者条件で更新。一般メンバーのname/status/closed_at/stats_mode/court_count/updated_at以外の変更をガードする現行トリガーを確認。
- event_participantsは `rls07` の所属・対象選手条件、rounds/matches/match_players/match_resultsは `rls09` の所属・親参照条件を確認。
- SELECTはeventsの所属・本人・super_user条件と共有トークン条件、子表の `rls11` 親スコープ条件。固定情報を共有閲覧へ拡張しない。
- 各表のID・所属・作成者・親参照の変更を防ぐ既存トリガーを確認。固定機能の追加で置き換えない。
- eventsのDELETE互換ポリシーは残っているが、authenticated/anonにDELETEの実効権限はない。ポリシー名・式だけで許可と判断しない。
- roundsには既存の `(event_id,round_number)` 一意インデックスがある。event_participantsにはidの主キーがあるが、複合外部キー用の `(event_id,id)` 一意インデックスはないため、追加する。
- 既存のstats_modeはofficial/record_only/undecided。列・既存の集計式は変更せず利用する。
- public.is_super_userは既存のapp_admins／認証メール条件を使うSECURITY DEFINER。新機能の許可判定でもauth.uidが存在することを確認し、既存関数自体は変更しない。
- 新しい設定・利用履歴はauthenticatedの同一グループ所属またはsuper_userにだけSELECTを許可。直接DMLを許可せず、認証・権限・開催状態・版数を確認するRPCに限定する。

現在の情報は利用者提供の確認結果であり、Codexが本番管理接続で直接取得したものではない。適用前には再度 `01_preflight.sql` とMigrationの前提確認を行う。本番SQLの承認・適用・PRマージは今回行わない。
