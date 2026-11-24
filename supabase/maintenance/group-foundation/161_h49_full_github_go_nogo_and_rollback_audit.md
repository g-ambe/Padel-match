# TASK-08 / H49：GitHub全PR差分・既存本番との互換性・切り戻し可能性のGO/NO-GO審査

判定日：2026-11-22 JST。**結論：本番Phase2のCOMMITおよびPR #265のReady化/マージは NO-GO。** 本審査は読取専用調査とGitHub文書記録のみで、Prod/Stage/CloudflareのDDL・DML・デプロイ・設定変更は行わない。

対象：[TASK-08 #215](https://github.com/g-ambe/Padel-match/issues/215)、[#264](https://github.com/g-ambe/Padel-match/issues/264)、既存Draft [PR #265](https://github.com/g-ambe/Padel-match/pull/265)、作業ブランチ `codex/task-08-group-foundation` の監査開始時HEAD `d982977b8b0cd9153335158435725831d8398839`。

## 1. 対象・根拠・確認方法

- GitHub PR #265の**変更258ファイル全部のパッチ一覧**を取得して操作種別・リスク構文を横断確認。分類：`supabase`182、`app`11、`components`10、`lib`16、`scripts`1、`.github`2、`tests`36。アプリ実行コード38ファイル＋workflow2本を含む。全差分の存在と類型を確認し、事故影響の大きいSQL候補・共有画面・グループ/本人連携・Cloudflare部署・旧main側依存はファイル本文を再読した。**258ファイルのすべての行・すべての動的実行経路についてE2E動作を個別証明した意味ではない。**
- Repository tree 957 entries、PR branch vs main：**469 commits ahead / 1 behind**（main側の1件は`AGENTS.md`変更）。**最新mainのAGENTS.mdに新しいGitHub Issue/Project/承認/検証ルールが追記されており、PR branchのAGENTS.mdは旧版**。最新ルールを事前に読み、合流/競合確認・HEADテストが必要。
- 本番とStageへはREAD ONLY SQL、Supabase Security advisorsもREAD ONLY、Cloudflare Worker deployment/version情報はGETのみ。GitHub ReleaseとActions履歴はAPIで確認。
- SQL原本：`147_h41_prod_phase1_additive_candidate.sql`（6工程、48KB、1 transaction）／`145_h40_prod_phase2_atomic_cutover_candidate.sql`（11工程、88KB、1 transaction）／`149_h42_prod_migration_replay_gate_readonly.sql`／`150_h42_one_time_production_migration_protocol.md`。
- 依存資料：`146_h40_release_order_restore_and_decision.md`、`160_h48_real_legacy_preservation_result.md`、`105_p0_codex_anon_access_consumer_audit.md`、`109_p0_codex_consumer_inventory.md`。古いH40のOwner NULL1件の記録は**H42で是正済み**で、現在のGO障害として二重計上しない。

## 2. 重大なNO-GO要因（優先順）

### Critical A: Phase2 COMMIT後の**復旧SQLと旧/新アプリ兼用契約が未検証**

`145`が成功すれば**COMMIT後にはSQLの`ROLLBACK`は使えない**。Cloudflareで古いWorker版を配信しても、DBのカラム/ACL/RPCの変更は残る。

- `145`の内部`138`は、`REVOKE SELECT ON TABLE public.club_members FROM PUBLIC,anon`を実行してから`0056`の`club_display_name`/本人公開同意列を追加する（匿名漏えい回避）。Prodの現実の匿名`club_members`テーブルSELECTは**現在true**。旧コード `app/groups/[id]/page.tsx` や `app/groups/discover/page.tsx`、`lib/member-groups.ts` は旧直接読込経路を持つ（多くは認証済み）。セッション中の旧JavaScript/公開画面を含め、旧Workerと新DB併存は別検証が必要。
- `139`は公開`get_player_profile_link_request(uuid)`の**レスポンス形状（DTO）を変更**する。旧`lib/profile-links.ts`の型/旧UIと、PRの`detail_scope=recipient/manager` + 最小DTOは異なる。旧アプリへ戻した時の申請詳細/承認画面の互換性は証明されていない。
- 切替後の`20261121131943_task08_h35_legacy_video_click_anon_close.sql`で旧共有動画click RPCのanon実行を閉じるため、その後に旧Workerへ戻すと**旧共有動画clickが壊れる**可能性がある。
- **禁止：新しい公開別名列が存在する状態で匿名へ`club_members`のtable-wide SELECTを単純に再GRANTする復旧**。本人の別名・公開同意を意図せず露出し得る。旧RPC定義の無条件復元も新しいプライバシー制限を破壊する。
- `146`自身に「COMMIT後の旧アプリ復帰は保証しない」と明記。**具体的な限定互換SQLと復旧順、適用後の実確認/失敗テストがないのでGOしない。**

### Critical B: **最新の全件バックアップの検証成功が確認できない**

- GitHub Draft Releaseの最新確認物は**2026-11-18 UTC作成 `backup.tar.gpg`**、名前「非公開・復元確認済み」。対応する[Actions #44203293217](https://github.com/g-ambe/Padel-match/actions/runs/44203293217)のbackupとrestoreジョブが共に**SUCCESS**であることも確認済み。
- しかしこの日時は11/21の実オーナー・役職変更などより前。**現時点のデータ全件へ復元する根拠にはならない**。
- [H43 #44915274585](https://github.com/g-ambe/Padel-match/actions/runs/44915274585)の新規**全件バックアップ生成→隔離復元**経路はFAIL（スナップショット取得段階）。H44/H45/H46/H48は別方式：schema + 必要なデータsubsetの隔離移行テストであり、**最新全件バックアップからの災害復旧実績ではない**。
- Supabase Freeでは公式のPITR/DB復旧機能が限定的。外部バックアップを取得・暗号化・保管・**実際に復元して全主要件数が一致**し、失敗時の復旧担当・実行窓・RPOを明示するまでSTOP。既存スナップショットへDB全体を戻すと、バックアップ時点以降の正常な試合/ユーザー更新を喪失する点に注意。

### Critical C: Cloudflareの既存版への戻しとDB変更の組合せが未検証

- Cloudflare Worker `padel-match` のREAD ONLY実測：最新active deploymentのWorker version #389、デプロイ日時 **2026-11-20 01:51 UTC**、直前版 #388等もDeployment Historyに存在。Cloudflare製品にはWorker Version rollback機構があるが、**今回の契約変更と合わせた旧Worker復旧試験はない**。認証・R2 binding・古いJS cacheの組合せを含める必要がある。
- `146`の2026-11-21取得記録では**mainプッシュに対して自動Worker build/deploy**する設定（Prod `padel-match`、`npm run cf:build`→`npx wrangler deploy`）と記載。現在のCloudflare Build Trigger一覧GETでは`[]`が返ったため、**現時点でその自動連携が確実に有効かは再確認必要**。どちらにせよ、`main`マージで意図しないリリースが起き得ると扱い、切替管理/デプロイ前後の手順を確定するまでマージ禁止。
- 事前に**旧Worker版・新Worker版、旧/新DBでの互換性4パターン**の最小HTTP試験を行う。DBを変えたあと新Worker公開までの空白時間、既存タブの古いクライアントJS、本人連携のデータ型を特に確認。

### High D: Migration履歴の独立登録と将来の`db push`事故

- Prod migration **22件**、Stage **74件**、旧`supabase/migrations/0054〜0065`＋Stage用タイムスタンプMigrationとProd専用`maintenance`統合候補が同一repoに存在。
- H42の履歴ガードと隔離DBの**模擬版のPhase1/Phase2各1件**はPASS。ただし、**Supabase MCP `apply_migration`での実際のバージョン採番、SQL COMMITと履歴記録の故障時一貫性、今後のCLI`db push`禁止の恒常管理は未実地試験**。
- 失敗後の履歴を「足して揃える」、`db push`、`db reset`、StageMigrationの全量適用は禁止。正式version/履歴/DDLの独立検査・衝突時STOPを運用Runbookに追加する。

### High E: プライバシーと未完了機能

- Prod current READ ONLY grants：匿名の全表SELECTが`club_members`、`clubs`、`player_profiles`、`official_events`、`official_matches`等に残存（events/matches/resultsは列単位SELECTが残存）。Stage/ProdのP0匿名公開面解消は**Phase2だけでは全完了しない**。適切なtoken/RPC・UI利用側への置換と実HTTP/RLS正負例を個別継続。
- Supabase Security Advisorは2026-11-22に`anon_security_definer_function_executable` **WARN 9件**、`function_search_path_mutable` WARN 1件、`authenticated_security_definer_function_executable` WARN 49件等を検出。いずれも自動的に脆弱性を確定するものではないが、各RPCの必要な匿名公開/認可ガードを検査。現存を理由に無差別REVOKEしない。
- TASK-08親 #215未完了、#262メール招待は未実装、#241同一グループ限定プロフィール画像のR2配信は未実装、#264公開未所属者向け直近開催は公開同意DTOの判断待ち。**TASK-08全機能GO**と**既存限定Phase1/2のリリース判定**は別々に行う。
- Phase2で公開グループの連携済み4人が本人同意まで一時非表示（公開人数14、表示可能10）という仕様上の利用者影響がある。本人への説明/リリース計画が必要。

### Medium F: PR規模・main差分・CI最新性

- PR #265はDraft、変更**258ファイル**（うち182ファイルはSupabase maintenance/migration等）。**469コミットahead、mainのAGENTS.md更新に1コミットbehind**。新mainの開発/Issue/Production承認ルールを取り込み、変更競合を確認する。
- H44 DDL17工程、H45実所属列、H46ロール操作、H47既存アプリ304テスト、H48実イベント等**18表4,279行**の全元列保全は実行済みPASS。これは**重要な安全性の証拠**だが、正式DB cutover後の旧Worker兼用・本番ロード・最新全件DB復旧・R2実バイナリの復旧は未証明。CI 304件はH47時点で、H48検証コード/ドキュメント更新後の最新PR HEADで総合CIを再実施していない。
- 現行`production-smoke.yml`はmain push時、TOP/login/groupsの読取などが主で、本番のOwner承諾/本人連携/匿名共有クリック/固定ペアと新旧互換の総合ロールバック判定には不足する。

## 3. 明確な切り戻し対応表

| 発生時期 | できること | 今の限界 |
| --- | --- | --- |
| Phase1/2 SQLの各COMMIT**前** | PostgreSQLの同一transactionをROLLBACKし既存DBを維持、旧Worker配信のまま停止 | `apply_migration`登録と実DDL実行境界は別途確認 |
| Phase1 COMMIT後でPhase2前 | 旧ACLを変えていないので旧Worker維持を基本として停止可能 | 追加RPC/triggerを強制DROPせず、実旧機能正負例を確認 |
| **Phase2 COMMIT後**で新Worker前 | 旧Worker動作に必要なSQL/RPC/ACLの互換レイヤーを追加する**forward-fix**か、事前検証済みの限定逆変更を適用 | **検証済みの安全な逆Migrationなし。ここが最大のNO-GO条件** |
| 新Worker公開後 | Cloudflare Worker's previous versionへ戻す選択肢はある | DB・RLS・RPCは戻らず、旧JS/cached client/本人連携詳細など破損の可能性 |
| DB全体を過去バックアップへrestore | 取得済みの過去Snapshotを復元できる可能性はある | **バックアップ以降の正常データも巻き戻る**。11/22時点の全件復元成功・PITRなしで「無損失復旧可能」は言えない |

**禁止事項**：PR #265のmain merge、本番Worker deploy、本番Phase1/2 apply、旧匿名`club_members`全表SELECTへの単純GRANT、RLSの無条件無効化、過去snapshot全量上書き、Migration履歴の捏造。ユーザーの明示的な本番変更GOと下記ゲートが揃うまで実行しない。

## 4. GOへ近づけるための必須ゲート

1. **現在のProd全件の暗号化外部バックアップと隔離復元PASS**。本番にあるauth/public/private/試合/写真メタなど対象範囲とR2実ファイルの別復旧方針、バックアップ日時、保存場所、復元手順、RPO、正常更新との差分対応を記録。前回H43が失敗した原因を解消。**最新バックアップが取れないならPhase2はGOしない。**
2. **Phase2のCOMMIT後**を隔離DBで再現し、旧Workerの実PostgREST/主要RPC・旧/新JavaScriptを使う重要導線を試す。特に匿名共有token+旧click、公開グループ表示、本人連携詳細/承諾、オーナー申請、スコア・固定ペア。実際のプライバシーガードを壊さずに復旧する限定SQL/互換アダプタを作り、同一実データで逆/forward-fix→再復旧の**成功ログ**を保存。
3. **配信制御**：Cloudflareでmain自動デプロイの有効状態を正式確認し、新Worker版をPreview/buildで先に固定。DBとアプリの4状態（旧DB×旧アプリ／新DB×旧アプリ／新DB×新アプリ／復旧DB×旧アプリ）を確認。旧Worker version ID・Rollback権限を事前準備し、必要な停止窓とコミュニケーションを明記。
4. **Migration台帳**：実際の`apply_migration`での2本採番＋履歴整合を隔離環境で確認し、再実行防止だけでなく将来のdb pushとの衝突を解決。Stage歴史をProdへ単純コピーしない。
5. **最終QA**：mainの新しいAGENTS.mdを反映しPR HEADで`tsc`・Cloudflare build・関連304/新負例の再実行。試合/固定ペア/本人画像/公式/共有の実環境少数代表E2E。H47既知の5同点判定＋1負得点は元データを維持する。
6. **公開範囲と完了宣言**：#215/#262/#264/#241の完成/未完了範囲を明示し、本人同意待ち4名の名簿表示の変化を事前案内。P0匿名GRANT残件を別ゲートに分ける。運用停止/切戻し判断担当と時間窓をユーザーに提示する。

**最終判定：Phase1/2統合SQLの孤立実行テストPASSは本番GOに十分ではない。現時点はNO-GO。** 現役Prod/Stageは変更しない。リリース条件を満たし、ユーザーが対象範囲と復旧によるデータ損失許容を明示的に承認してからのみ再審査する。

## 5. 参考（外部製品公式）

- Supabase Database Backups：<https://supabase.com/docs/guides/platform/backups>
- Supabase Free plan backups：<https://supabase.com/kb/faqs/platform/free-plan-backups>
- Cloudflare Worker rollback：<https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/>

---

## H50・2026-11-24の進捗（H49時点の判定を更新）

本ファイルの「最新バックアップ未取得」は**当時の記述**。**2026-11-22 09:20 JST取得の166表全件暗号化バックアップと独立restore検証は[Actions #44966082064](https://github.com/g-ambe/Padel-match/actions/runs/44966082064)でPASS**。GitHub Draft Release ID454086112に暗号化・非公開保管済み。11/24の本番運用データ保全のためには引き続きリリース直前再取得が必要。

さらに[H50 #45297128444](https://github.com/g-ambe/Padel-match/actions/runs/45297128444)で、実際の本番構造＋業務24表（6表限定列/18表全列）を使用してPhase1→Phase2をCOMMITし、隔離DBの**破壊的な旧schema+元データへの復元・旧RPC/権限/Migration履歴照合をPASS**した。後続の試験用行は復元で消えることも確認。

**重要**：これは**全166表の11/22暗号化アーカイブを今回H50で復元した**という意味でも、**本番で後続の試合・得点を失わない切り戻しが実現した**という意味でもない。Phase2後に旧匿名membership参照が拒否され、本人連携RPC関数が変更されることを実証したため、**旧Workerへの単純切替は危険**。無損失forward-fix/旧Worker＋新DBの実HTTP互換テストは未完了。**本番GOは引き続きNO-GO**。

詳細：[H50結果](163_h50_post_commit_rollback_rehearsal_result.md)。
