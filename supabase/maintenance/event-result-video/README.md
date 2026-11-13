# 結果UIと終了後の動画登録

## DB追加が必要な理由

- `0036_event_team_matches.sql` の `event_team_matches_manage` は終了済みの手動カードの更新をRLSで拒否する。
- `0045_friendly_team_random_rounds.sql` の自動カードは直接更新できず、更新RPCも `lock_event` によって開催中だけ許可される。
- したがって、UIの表示条件だけを外しても、終了後の動画登録・変更は保存できない。

`0047_event_result_video.sql` は動画URLだけを更新するRPCを追加する。既存RLS、テーブルのGRANT、既存スコア・カード保存RPCは変更しない。

- 認証済み、閲覧可能、従来のチーム戦管理者、未削除のチーム戦という条件を検証する。
- イベント→試合の順で行ロックする。イベントID・試合IDは変更できない。
- YouTube URLだけを受け取り、保存済みURLの期待値を照合する。応答喪失後の同値リトライは成功する。
- 更新列は `youtube_url` と `updated_at` のみ。選手、スコア、編成、戦績は更新しない。
- anon/PUBLICは実行不可。共有画面はログイン状態と独立した既存の匿名クライアントを維持する。

## 現在の状態

Migrationは隔離したPGlite（PostgreSQL互換）で検証済み。
最新の本番適用状況はPR202の適用ワークフロー結果・リリース報告を参照する。
UIのブラウザ試験は合成API応答を利用しており、本番へのRPC導入を確認する試験ではない。
実バックアップの隔離復元・本番DBの適用と事後確認が成功するまではPRをDraft・未マージとする。

## 適用前の確認と順序

1. 本番適用の承認後、既存のDB外暗号化バックアップ・隔離復元手順を利用する。
2. 本番カタログが0044・0045および既存RLS/GRANTと整合すること、同名RPCが未導入であることを確認する。差異があれば停止する。
3. 最新バックアップの隔離復元DBへ0047を適用し、動画のみの更新、管理者A/B、一般メンバー・共有閲覧者の拒否、既存データ・権限不変を再確認する。
4. 固定した0047だけを本番へ適用する。テーブルのポリシー・GRANTが不変であること、新RPCがanonでは実行できずauthenticatedのみ実行できることを検証する。
5. 専用の試験開催で手動・自動カードの終了後の動画登録/変更/削除と、スコア・編成不変を確認する。既存の本番試合には試験書込みしない。
6. DB検証成功後にUIをマージし、既存の自動デプロイに任せる。手動の二重デプロイはしない。

カタログ確認例（読み取り専用、個人データなし）:

```sql
select to_regprocedure('public.save_friendly_team_match_video(uuid,uuid,text,text)');
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename in ('events', 'event_team_matches')
order by tablename, policyname;
-- 以下は0047導入後のみ。
select has_function_privilege('anon',
 'public.save_friendly_team_match_video(uuid,uuid,text,text)', 'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',
 'public.save_friendly_team_match_video(uuid,uuid,text,text)', 'EXECUTE') as authenticated_execute;
-- 期待値: false / true
```

### PR202用の既存Actions経路

`cloud-db-backup.yml` をmainから手動起動して最新の暗号化ファイルを非公開Draft Releaseへ保管する。
同ワークフローの別runnerで実ファイルの復元に成功した後に限り、`event-result-video-release.yml` をPR202のラベルで起動する。
古いPRの承認ガードは変更しない。秘密情報、復号ファイル、実データ、行ハッシュ一覧はコミット・公開しない。

- `202隔離検証`: 読み取り専用の本番事前確認、固定バックアップ照合、隔離復元、0047適用・動画操作・権限・既存データ不変・切り戻しと再適用のみ。
- `202本番0047適用`: 上記を同じrunner内で再確認し、成功時に限り、承認済み0047を単一トランザクションで本番適用する。
- main SHA、最新PR head、0047のSHA-256、バックアップrun/attempt/非公開asset/SHA-256を固定照合する。バックアップは取得から4時間以内。差異・失敗時は停止する。
- 最新本番と実復元DBの全対象カタログ、RLS、GRANT、ロール、既存行を比較する。適用は短いロック中に再照合し、新RPC以外のオブジェクト変更を拒否する。
- 既存の `supabase_migrations.schema_migrations` がある場合は、形式・未記録を検証し、0047のバージョン・名称・SQLを同じトランザクションで記録する。テーブルがない既存運用では新設せず、従来同様Actionsの適用記録を残す。
- 事後確認ではauthenticated実行可、anon/PUBLIC実行不可、既存RLS/GRANTと行データ不変を再検証する。専用の一時開催で開催中・終了後、手動・自動カードの動画CRUD、同値リトライ・古い期待値の拒否、無権限・共有閲覧者の拒否を確認する。試験書込みは成功時も全て取り消す。
- 応答喪失・事後確認失敗では自動再適用や本番データ復元を行わず、状態を保全し、読み取り専用で状態確認して停止する。PRマージは別途GitHubの通常の必須チェック・保護ルールを通す。

`01_preflight.sql` / `02_verify.sql` は適用前後の確認、`03_smoke.sql` は上記の可逆な専用開催試験である。
追加RPCの削除・履歴の取り消しと再適用は隔離DBでのみリハーサルする。本番の巻き戻しは以下の方針を優先する。

## 切り戻し

先にアプリを直前版へ戻す。0047は追加RPCだけなので、既存UIとの互換性を保ったまま残せる。
必要な場合のみ、利用クライアントがないことを確認して新RPCを削除する。既存の動画URL・スコア等のデータは削除しない。
データ復元や既存Migrationの巻き戻しは自動実行しない。

## 表示上の順位

集計値と同値内の既存順を維持し、選択した指標が同じ選手を同順位の一行にまとめる。
順位は競技順位（1位が2人なら次は3位）。要約は先頭2グループと最下位を重複なく表示する。
MVP・個別の勝敗・試合数・得失点等と、チーム/ペア戦績はランキング詳細POPへ移設する。
