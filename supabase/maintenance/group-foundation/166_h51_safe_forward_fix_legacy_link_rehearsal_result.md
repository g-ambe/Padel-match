# TASK-08 / H51：Phase2 COMMIT後にデータを巻き戻さない安全制限付き旧RPC互換リハーサル

実施日：2026-11-24（JST）。対象：既存Draft [PR #265](https://github.com/g-ambe/Padel-match/pull/265)、子Issue [#264](https://github.com/g-ambe/Padel-match/issues/264)／親 [#215](https://github.com/g-ambe/Padel-match/issues/215)。

**採用テスト：[GitHub Actions #45300504350](https://github.com/g-ambe/Padel-match/actions/runs/45300504350) SUCCESS。** 本番・Stage DB変更なし、Cloudflare配信なし、`main`マージなし、有料Supabase環境作成なし。

## 1. 重要な結論

**H51の限定範囲はPASS。移行前DBの全量復元をせずに、Phase2 COMMIT後の旧方式の「無同意承認」を止め、既存行と新規COMMIT済み検証行を維持できた。**

ただし**本番リリースのGO判定は引き続きNO-GO**：
- 旧Workerの「プロフィール連携を承認」は**意図的に失敗する**。この旧UI経路まで完全に復旧できたわけではない。
- 新しい本人同意付きの**正常承認（実際のpending申請）**のE2Eは未実行。実本番の`player_profile_link_requests`は3件とも既にapprovedであり、今回のリアルデータだけでは正常なpending承認を試験できない。移動先内部関数の定義、権限、名前付き承認からの呼出しは照合済み。
- 旧Worker×新DBを用いたHTTP、実JWT／PostgREST／ブラウザでの全ページ回帰は未実施。旧管理者画面の一部表示（旧DTOにあったプレビューなど）は、新しい個人情報保護済みDTOでは復活しない。
- 本方式は**安全に制限した部分的なforward-fix候補**であり、本番環境に適用できること／無停止・無損失で全機能復旧できることをまだ証明しない。
- SQLは`164_h51_postcommit_safe_legacy_approval_guard_CANDIDATE.sql`の**隔離検証専用候補**。本番用Migrationや本番リリースRunbookに組み込んでいない。実際の本番適用には別途独立審査・承認が必要。

## 2. 旧アプリ契約の調査で判明したこと

旧`main`側：
- `app/profile/links/[id]/page.tsx`の承認ボタンは`reviewPlayerProfileLink(...,'approved',review_token)`を使用し、`lib/profile-links.ts`が`public.review_player_profile_link(uuid,text,text)`を呼ぶ。
- その旧承認は**選手引継ぎの同意・review_tokenは確認する**が、新しい「グループ内表示名と公開表示への本人同意」は入力・確認しない。
- Phase2で`public.review_player_profile_link_named(uuid,text,text,text,boolean)`が公開同意・別名・CAS/本人の一致を検証し、内部で旧`review_player_profile_link`を呼んで実際のマージを行う。
- Phase2では既存公開関数`review_player_profile_link`自体が残り、旧Webクライアントが直接呼ぶと**新しい同意確認を経由せず承認できる可能性**がある。**クライアント非表示だけで防げないため、DB関数の権限と経路で制限する必要がある。**
- 公開`get_player_profile_link_request(uuid)`のレスポンスは、Phase2で新しい受信者/管理者別の最小DTOに変更。旧Workerへ切り戻しても旧DTO全体が復元されるわけではない。
- 匿名`club_members`全表SELECTを再付与してはいけない（追加された公開別名・同意列の露出リスク）。今回一切再GRANTしない。

## 3. H51の隔離専用SQL候補の構成

[`164_h51_postcommit_safe_legacy_approval_guard_CANDIDATE.sql`](164_h51_postcommit_safe_legacy_approval_guard_CANDIDATE.sql)はPhase2 COMMIT後であることをチェックして**1トランザクション**で実行する。

1. 旧`public.review_player_profile_link`の**既存関数本体を変更せず**、非公開`profile_link_private.review_player_profile_link_original`に複製し、`PUBLIC/anon/authenticated`の直接EXECUTE権限を撤回。
2. 新`public.review_player_profile_link_named`は既存の本人同意・グループ表示名検証を維持し、最後の内部マージ実行だけ複製先の非公開関数へ接続。
3. `public.review_player_profile_link`の公開名は残し、旧クライアントの`approved`を**DBサーバーで42501拒否**。`rejected/cancelled`は本来の審査関数へ委譲し、元の認可を維持。
4. `anon`へのレガシー連携関数EXECUTEを拒否し、`authenticated`の旧関数と新同意関数のEXECUTEは保持。`club_members`匿名SELECTは引き続き拒否。
5. 旧Approvalからのデータマージ、新Approvalの内部実装、他の`matches`・`events`・`match_results`等の業務行は**削除・上書きしない**。

**安全上の注意**：既存関数定義の転送に動的SQLを使用しているため、関数名・所有者・内部呼出しが想定からずれた場合は**preflightで中断**する。実本番の正式Migrationとしては採用せず、SQLレビューと独立した実Auth検証が完了するまで候補扱いを維持。

## 4. 再現した実テスト（採用Actions #45300504350）

| 対象 | 実測結果 |
| --- | --- |
| ProdのREAD ONLYスキーマとH45の6表151行限定列、H48の18表4,279行全元列を隔離Postgres17へ復元 | PASS |
| Phase1(6工程) → Phase2(11工程) のCOMMIT・元列ハッシュ | PASS |
| Phase2後に旧`review_player_profile_link`がauthenticatedから利用可能である前提 | PASS |
| 非公開の元レビュー関数へのanon/authenticated直接EXECUTE | **拒否PASS** |
| 旧クライアントの`approved`（authenticated） | **42501拒否PASS** |
| 匿名ユーザーからの旧レビューファンクション呼出し | **拒否PASS** |
| authenticatedで**既存approved申請**に`rejected`を送る無変更・冪等経路 | PASS（既存approvedを維持） |
| `cancelled`の正常なpending申請処理 | **未実行**（この実データにはpendingがない） |
| 新しい名前付き承認の内部元レビュー呼出しと実行権限 | **定義/権限照合PASS** |
| 新しい名前付き承認の実際のpending申請成功 | **未実行** |
| 匿名`club_members`直接SELECT許可なし | PASS |
| 18表4,279行全列・6表151行限定列の元データ維持 | PASS |
| Phase2後にローカルで追加COMMITした検証用行の保持 | PASS |
| Phase1/2のMigration記録とRLS/ACL保持 | PASS |
| 一時DBと検証ファイルの掃除 | PASS |

**304件の旧H47アプリユニットテストや本番Workerの実HTTPを本Actionsで再実行したわけではない**。H51はSQL権限・実データ不変性の限定テスト。

## 5. 途中のテストエラーと修正

- [初回 #45300126925](https://github.com/g-ambe/Padel-match/actions/runs/45300126925)：H45/H48のPhase1+2実データ照合はPASS。H51の事前SQLで、まだ存在しない`profile_link_private.review_player_profile_link_original`を`has_function_privilege`等の文字列名から解決しようとしてPostgreSQL`42883`で停止。**候補SQLの適用前**なので互換性試験は未判定。
- テストの存在確認を`to_regprocedure(...)`のnull安全なOID解決に修正（本番Migrationや旧アプリは変更せず）。
- [採用 #45300504350](https://github.com/g-ambe/Padel-match/actions/runs/45300504350)：**全工程SUCCESS**。新SQLに期待する関数定義、旧クライアントの承認拒否、anon拒否、既存レビュー経路、業務行不変・後続行維持まで実測PASS。

## 6. 現状・次のゲート

**H51の安全制限付き旧RPC forward-fix候補は隔離DBでPASS。TASK-08リリースはNO-GO。** 次のH52以降：
- **実Pending申請の最小Fixtureで新`review_player_profile_link_named`正常承認＋CAS/公開同意＋旧承認拒否＋`rejected/cancelled`をロール別E2E**。実JWT/PostgRESTがある隔離/Stageと本番相当schemaの差分を考慮。
- **旧Workerの通常試合・グループ/本人連携・共有などの画面互換性**。旧連携承認停止が許容可能な短期縮退仕様かのユーザー判断。不可なら新旧DB両対応の橋渡しWorkerを先に配信する方式へ変更。
- **本番直前の166表全件暗号化バックアップ＋隔離復元**と、R2本体の別保全。Migration version採番・Cloudflare main自動配信の制御・最新PR HEADビルドを再確認。
- 本番にSQLは適用せず、既存PR #265をDraft維持。GitHub Issues #264/#215は未完了、GitHub Project項目は未更新。

**追加課金0の既存GitHub-hosted Runnerで実施。GitHub Actionsへの実UUID・個人名・申請内容・review_token等の出力なし。**
