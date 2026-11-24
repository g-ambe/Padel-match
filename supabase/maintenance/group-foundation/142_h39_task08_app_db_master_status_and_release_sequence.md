# TASK-08 / H39：改修仕様・アプリ／DB進捗・本番切替順の統合台帳

確認日：2026-11-21（JST）。正本：親 [#215](https://github.com/g-ambe/Padel-match/issues/215)、子 [#229](https://github.com/g-ambe/Padel-match/issues/229) / [#262](https://github.com/g-ambe/Padel-match/issues/262) / [#264](https://github.com/g-ambe/Padel-match/issues/264)。実装：既存Draft [PR #265](https://github.com/g-ambe/Padel-match/pull/265) の `codex/task-08-group-foundation`。画像関連は [#241](https://github.com/g-ambe/Padel-match/issues/241)。将来の任意10文字英数字ID [#263](https://github.com/g-ambe/Padel-match/issues/263) は **TASK-07-04、TASK-08とは別**。

> **判定：TASK-08は未完了。** 作業ブランチへの実装、StageのRPC試験、PRマージ、本番SQL適用、Cloudflareデプロイ、実機検証は別々の状態として読むこと。Issue本文の「未着手（2026-11-18）」などの過去履歴を現状の判定に使わない。修正に関しては最新コメント／実ソースと本台帳を優先する。本書は本番リリース承認ではない。

## 1. 子タスク全体

| 子タスク | 正式スコープ | 現状／次の担当 |
| --- | --- | --- |
| TASK-08-01 #229 | 現行グループ機能、API/RLS、名前、退会、画像、戻り導線、招待/ID設計依存の調査 | 一次棚卸し・H20/H25/H36〜H38の実装差分調査は進捗。実Authと本番互換の確認は残る。GPTで調査/DB照合 |
| TASK-08-02 #262 | 名前だけの仮登録、メール任意招待、登録済/未登録分岐、本人承諾、管理者再承認不要、拒否・再送等 | **要件合意、メール送信のアプリ・DB・通知フロー未実装**。別工程。Codexアプリ＋GPT DBで着手判断 |
| TASK-08-03 #264 | 概要/メンバー/戦績3タブ、公開範囲・所属名、退会/オーナー承諾、POP/戻り、同グループ写真 | **アプリ主要部分はDraft PR #265へ実装**。StageでRPC/権限を限定検証。本番DB移行・本番配信なし。**同グループ写真は未実装** |
| 参考 #263 | 任意10文字英数字アカウントID | **TASK-07-04**。DB影響の調査は#229と共有、アプリ/API/発行はTASK-08の完了対象に混ぜない |

## 2. 変更ごとのアプリ／DB対応表

「アプリ実装済」＝PR #265のブランチにソースあり、**本番には未配信**。「Stage実装済」＝Stage DB導入・限定SQL/HTTP試験済で、**本番導入とは別**。

| 改修内容（仕様） | アプリ側・Codex側 | DB/API側・GPT側 | 未完了／注意 |
| --- | --- | --- | --- |
| 公開グループの安全な取得（未所属は名前・未連携だけ、役職/プロフィール名/戦績は非公開） | `app/groups/[id]`, `lib/group-read.ts` で用途別RPCへ変更、未所属は戦績/内部申請を取得しない | `0054`, `0055`、Stageの限定列・認可RPC、Stage匿名基底表制限 | Prodの匿名 `club_members` 等は直接SELECT可能。新RPCはProdに無い。リリース同時切替が必要 |
| グループ詳細3タブ「概要／メンバー／戦績」 | H21：3タブ、共通POP、設定「…」、開催直近3件、ランキング個人/ペア/開催と総合pt説明、375px合成ブラウザ済 | 既存所属者向け開催/戦績の読取、用途別`0054/0055`を利用 | Prod RPC未導入、実機・全統合未完了 |
| 1人1行のメンバー・公開人数 | H21/H22：内部名簿と公開名簿を分離、公開未所属の人数は専用RPC・失敗時「不明」 | `0065` の `get_public_club_member_count` Stageで検証 | Prod導入前。非公開グループ/未ログインは対象外 |
| グループごとの表示名（連携済みは本人のみ、未連携は権限内の管理者） | H16：編集共通POPと保存処理、CAS/PT409、本人プロフィール名は不変 | `0056` / `0057` Stage導入。Prod互換候補 `138_h38_prod_alias_atomic_cutover_candidate.sql` | Prod `club_members` anon表SELECTが元0056と衝突。匿名権限切替とDDLを同じトランザクションにする |
| 加入時の希望名・公開同意、未連携選手との本人紐づけ | H17：公開申請・既存仮選手の確認POP、連携後の本人名・公開同意確認 | `0058`〜`0060`、Stage専用named RPCと申請後のalias保持 | Prod未移行。通常加入では従来の管理者承認を維持（招待#262と別） |
| 管理者からの本人連携依頼を受ける画面 | H18：本人が選ぶグループ名・公開同意＋既存の引継ぎ同意を維持 | `0061`、Stageの本人限定DTO/申請情報。Prod向け `139_h38_prod_link_scoped_preview_candidate.sql` | Prod旧詳細RPCは全行JSON、scoped helper欠落。0061前の限定切替が必要 |
| 本人自主退会（履歴保持、本人以外は不可、最終main保護） | H15：本人確認POP、退会後マイページへ、旧オーナーは引継ぎ後のみ | Stage `leave_my_club` 検証済。Prodは既存`guard_group_last_main_admin`を活用し、`136` status bridge → `137` 本人退会候補 | Prodの本人退会RPC未導入、二重ガードの無条件移植禁止 |
| オーナー引継ぎは候補本人が承諾・辞退、依頼取消/通知 | H19：候補・受信者確認画面、POP/通知・競合表示/キャンセル | Stage `0062`〜`0064`、実Auth・ROLLBACKの承諾/辞退・拒否検証済 | Prodにはowner-request表/RPCなし。`136/137`で前提を揃えてから導入 |
| マイページ／検索／通知／イベントからの戻り先 | H21：入口・タブ・スクロール・POP階層を復元、`/groups`旧導線を調整 | 基本はDB追加不要 | 実機の戻りと保存中断・例外経路は最終確認 |
| 通常・チーム／混合・公式戦の匿名共有結果 | token専用RPCを利用した共有画面へ移行、旧基底表fallbackなし | Stage `get_shared_event`。Prod追加候補は `54_h12_prod_compatible_rpc_candidate.sql` | H34実HTTP/Chromiumは限定成功。本番RPC欠落と本番旧匿名基底表の広い読取が残る |
| 共有動画クリック（通常試合・開催動画・公式動画） | 新token-bound RPCへ切替、H34 3種類ブラウザ受入成功 | Stage H31/H33/H35済、検証fixture回収済。Prod追加 `133_h37_prod_video_click_additive_candidate.sql`、公開後に旧RPC匿名停止H35 | Prodに新3RPC無し。旧RPC匿名EXECUTEを先に止めない |
| グループ戦績・過去の退会者/スコア/GP | H21は画面構成変更。既存の70/20/10総合pt、3試合未満参考、勝率順位など維持 | H14既存データ監査、統計の用途別取得 | 旧スコア例外6件を未判定で自動変更しない。Stage/Prod認証済みの主要戦績回帰が残る |
| 同グループ在籍者のみのプロフィール画像（未所属には標準アイコン） | **未実装**：現`memberButton`は標準SVGアイコンのみ。既存の本人専用画像APIは維持 | **未実装**：本人専用R2/APIを拡大せず、同グループ在籍のみの配信認可＋退会時失効が必要 | #264の確定要件。PR #265がマージされてもTASK-08-03を完全完了とはできない。別工程のCodex/API+DB/R2対応が必要 |
| 未所属への直近開催3件 | **未実装**：現在は「開催情報は所属後に確認できます」 | **未実装**：公開開催掲載同意、掲載対象・公開DTOの仕様確定後 | 所属者の直近開催は実装済。未所属の「概要で公開開催」要件は別途設計判断 |
| 仮メンバーのメール招待、後からの招待、再送・拒否 | **未実装**：#262で要件確定、メール送信/API/POPは別工程 | **未実装**：メール・token hash・期限・本人承諾状態の保護保存が必要か設計 | TASK-08全体の残件。既存の通常加入の管理者承認とは区別 |
| 任意10文字英数字ユーザーID | 今回のPRでは実装対象外 | 将来への設計影響だけ#229で確認 | #263/TASK-07-04として別管理 |

## 3. 試験済みと未完了を区別

**確認済み**：H15自主退会・H19オーナー引継ぎのStage SQL ROLLBACK正負例、H16〜H22の該当範囲の軽量unit/375px合成ブラウザ、H34の通常/チーム/公式の実HTTPとChromium共有画面・クリック3種成功、H35 Stageテスト行回収と旧クリックRPC匿名権限停止。H36〜H38ではProdをREAD ONLY確認、SQL候補はStageトランザクション試験。

**未確認**：PR全体の全テストPASS／本番とStageの全スキーマ互換／固定ペア・画像・施設・通常/チーム/公式運営の本番切替後回帰／アプリ本番配信／実機。既存プロフィールテスト12件の不整合は別に把握。H34共有リンク成功だけでTASK-08全体成功とは扱わない。

2026-11-21の読み取り専用集計：
- **Stage** `padel-hub-staging`：clubs 3、memberships 12、events 0、official 0、Migration履歴74。新token/roster/member-count/withdraw/owner RPCは存在、匿名`club_members` SELECTなし。
- **Prod** `padel-hub`：clubs 13、memberships 41、events 91、official 4、Migration履歴22。上記主要新RPCは未導入、匿名`club_members` SELECTあり。Prod固定ペア/画像/施設既存データを保持する。

## 4. 本番切替の依存順（実行しない手順書）

| ゲート | 順序・実施単位 | 切替条件・失敗時 |
| --- | --- | --- |
| 0. 現状記録 | `132`, `135`, `140` の既存READ ONLY、実体/列/関数・件数確認 | 既存利用データの非変更、Prod新RPC未導入を確認 |
| 1. 追加契約 | `54_h12_prod_compatible_rpc_candidate.sql` → `133_h37_prod_video_click_additive_candidate.sql` → `0054` → `0055` | 共通RPC追加。ただし各SQLはまだProdに適用しておらず、全DDL/認可の本番互換・正式移行番号が必要。旧匿名SELECT/旧RPCは維持 |
| 2. 退会前提 | `136_h38_prod_last_main_status_bridge_candidate.sql` → `137_h38_prod_self_withdraw_candidate.sql` | Prod既存ガードを残し、statusのみ補足。失敗時は旧退会ルートを拡張せず停止 |
| 3. 同時切替 | `138_h38_prod_alias_atomic_cutover_candidate.sql`（`club_members`匿名SELECT REVOKE＋元`0056`を単一BEGIN/COMMIT）→ `0057` → `0058` → `0059` → `0060` → `139_h38_prod_link_scoped_preview_candidate.sql` → `0061` → `0062` → `0063` → `0064` → `0065` | **旧画面との互換が変わる区間**。短い切替窓・異常時の配信/DB復旧順と実HTTP/運営動線を揃える。候補は本番適用許可ではない |
| 4. 新UI公開 | DB契約成立を確認後、既存PR #265をレビューしてCloudflare公開 | Stage実Auth・通常/公式/チーム・固定ペア・プロフィール画像本人操作・グループ・戦績の主要動線検証、ユーザーによる本番承認 |
| 5. 後処理 | 新共有UIが動作した後、`20261121131943_task08_h35_legacy_video_click_anon_close.sql` で旧3クリックRPCの匿名EXECUTEだけ停止 | 旧関数自体は残す。その他の匿名基底表権限も、対応する画面を確認した対象だけ切替。無差別`db push`や一括REVOKEをしない |

**STOP**：ゲート3の途中でDBと旧UIの契約が合わなくなるときは、アプリを単純に旧版へ戻すだけでは復旧しない可能性がある。実行前にどの変更が可逆か、旧アプリ利用可能な期間、実確認する合成/許諾済みイベントを固定してから判断する。マージや本番DDLはユーザーの明示的なリリース承認を得て行う。

## 5. 今後の担当別優先作業

| 優先 | 担当 | 必要な作業と完了条件 |
| --- | --- | --- |
| P0 | GPT / DB | `0054〜0065`とH37/H38候補の連続依存、権限切替順・復旧方法を本番互換の小さな実施単位に確定。Prodへ無断適用しない |
| P0 | Codex / アプリ検証 | **新機能追加ではなく**現在のPR #265に対する実Auth＋代表操作の回帰、配信バージョン/移行前後互換確認。新しいPRを作らない |
| P1 | Codex＋GPT（別工程） | #264の**同グループ在籍者プロフィール写真**。現在未実装なので、DB/R2認可/APIと一覧画像を確定仕様どおり実装・試験 |
| P1 | GPT＋Codex（仕様確定後） | 公開未所属者向け直近開催の掲載同意/対象・最小DTOとUI（現在は未公開） |
| 子タスク | #262の担当 | メール招待（仮登録後追加、登録済/未登録、本人承諾、拒否・再送、本人同意後の管理者再承認不要）を別工程で実装 |
| 別タスク | #263 | 任意アカウントコード。TASK-08のリリース条件に含めない |

## 6. 運用ルール

- Issue/PRの既存リンクを保持し、**既存PR #265だけ更新**。AGENTS.mdを遵守し、重複PR、新規ブランチ、無関係なアプリ改修を行わない。
- 大きな機能追加より、現在のユーザー確定仕様と既存機能維持を優先。戦績/GP、スコア、固定ペア等を勝手に変えない。チュートリアル/ヘルプはUI変更時の関連箇所だけ同期。
- DB本番とCloudflareは本書作成時点で未変更。**今回の作業範囲は棚卸しと手順の整備、GitHub記録のみ**。

## 7. H40追記：本番移行の実態・段階的ゲート（2026-11-21）

**新規SQLと最終検証記録**：`143_h40_prod_release_impact_readonly.sql`（利用者影響）・`144_h40_prod_preservation_snapshot_readonly.sql`（Prod件数保全）・`145_h40_prod_phase2_atomic_cutover_candidate.sql`（0056〜0065を単一トランザクション候補へ統合）・`146_h40_release_order_restore_and_decision.md`（実行/復旧手順）。

- Prod有効グループ3件、うち公開2件・公開所属14名（linked4、未連携10）。旧Linked4名は0056導入後、**本人公開同意がないため名簿からいったん省かれる**。所属人数自体は14。無断公開バックフィルはしない。
- Prod有効グループのうち1件は`owner_id`が現役main_adminの所属に対応していない。現役main_admin自体は各有効グループに存在する。**ownerを自動修正しない**。当該グループのオーナー引継ぎには別途個別確認が必要。
- Prod固定ペア関連：state10、pairs2、rounds78、画像object1、通常試合521/結果351。本人データ・戦績・写真を変更しない件数照合として保存。
- 145候補：前提となるRPC追加後に、138→0057→0058→0059→0060→139→0061→0062→0063→0064→0065の**11原本（sha固定）をBEGIN/COMMIT一組に集約**。コミット前の失敗は全てROLLBACKされる。**COMMIT後に旧アプリを戻すだけでは修復できない可能性を明記**。
- Prod migration履歴22件 vs Stage74件。**ソースMigrationの登録/二重適用防止方法未確定のため本番NO-GO**。自動`db push`不可。Cloudflare配信手順も現物で確定してから公開する。
- **H40は追加開発ではなく本番リリース準備。** DBはREAD ONLYのみ、GitHub既存PR #265に候補を保存。各ソースの部分的Stage ROLLBACKテストが通ったことと、**本番スキーマでの11連続DDLが通ったことは別**。本番適用・PRマージ・Cloudflare公開なし。

**Cloudflare実トリガーの追記**：本番`padel-match`はGitHub `main`を自動デプロイ（`npm run cf:build` → `npx wrangler deploy`）、Stage `padel-match-staging`は`codex/minimal-security-replacement`を自動ビルド対象としており、**PR #265の`codex/task-08-group-foundation`ではない**。確認はCloudflare API GETのみ。詳細と復旧上の注意は`146_h40_release_order_restore_and_decision.md`。公開前にStageプレビューとProd DB切替の整合が必要。
## 8. H41追記：本番Owner NULLグループとMigration履歴整合（2026-11-21）

新しい`148_h41_owner_null_and_migration_history_plan.md`に実測・調査結果を集約し、`147_h41_prod_phase1_additive_candidate.sql`を新規作成。**Prod/StageはREAD ONLY、PR #265はDraft・未マージ。**

- 問題のグループ名は**「Wytel Bule Owls」**（DB記載の綴り）。有効9所属・有効main_admin2名、`clubs.owner_id=NULL`、ownerに紐づく有効main_admin0。**管理者ゼロではなく、正式Owner未設定**。NULL列は既存スキーマ上許容。main_adminから誰かを自動選択しない。
- Phase1（H12→H37 click→0054→0055→136→137）を原本GitHub SHA固定で6工程・**単一BEGIN/COMMIT**へ統合。`147`は構造チェックまで、Prod等価環境の連続DDL実行はまだ。
- Phase2既存`145`は138→0057→0058→0059→0060→139→0061→0062→0063→0064→0065の11工程。Stage74/Prod22履歴。**正式migration-versionと旧0054〜0065の重複適用防止**が実際のリリース前STOP条件。
- Phase1は`directory_refs`への所属行生成・追加triggerを含み、完全な無副作用ではない。既存アプリのグループ操作を本番等価な環境で確認し、`main`のCloudflare自動デプロイと適用順を揃える。
- H41でも本番変更なし。写真・メール招待の未実装、残余anon基底SELECTの扱いは引き続き個別課題。

## 9. H42追記：管理者変更完了・Migration二重適用防止（2026-11-21）

- 本番の「**Wytel Bule Owls**」は**owner＝あんべ（設定済み）／あんべ＝main_admin／瀧田＝sub_admin**に確定変更。対象2レコードのみ、事前ROLLBACK・本番COMMIT・独立READ ONLY検証済み。active所属9名、試合/戦績/他メンバーに変更なし。H40/H41のowner ID NULLは**変更前**情報に訂正。
- 本番向けSQL `147_h41_prod_phase1_additive_candidate.sql` と `145_h40_prod_phase2_atomic_cutover_candidate.sql` に**履歴での二重適用・順序違反拒否ガード**を追加。名前は`task08_prod_phase1_additive`→`task08_prod_phase2_atomic`に固定。
- `149_h42_prod_migration_replay_gate_readonly.sql`をStage/Prodで実行。Prodは`phase1_eligible=true`、Stageは`false`（旧Stage用0054〜0065履歴あり）。将来は`apply_migration`で2本のみ登録・監査し、ディレクトリ全体の`db push`は禁止。
- `150_h42_one_time_production_migration_protocol.md`に確定手順と費用条件を保存。Prod相当branchの料金はSupabase見積**$0.01344/時間から**、作成には明示費用承認が必要。現時点branchは**未作成**であり17工程の連続実行はまだ未検証。
- 本番追加DDL・PRマージ・Workerデプロイは行っていない。TASK-08子タスク#262のメール招待と#264の同クラブ画像は引き続き未実装。

## 10. H43追記：有料Preview Branchを使わない本番相当の連続検証

- ユーザー意向によりSupabase Branch課金（$0.01344/h〜）を**回避**。既存StageへProd実データを恒久コピーしない。StageはすでにPhase1/2相当が適用済みで移行前テストに使えないため、公開GitHub Repoの**無料標準GitHub-hosted runner**上で一時的なPostgresを用いる。
- 既存 `cloud_backup.py` の信頼済みread-only Prod Snapshot・暗号化・厳密復元/外部ネットワーク遮断機構を再利用。Production実データは一時的にランナーに読み込み、公開リポジトリ/Stage/永続Artifactに保存しない。Workflowのfinally/always cleanupで削除。
- `151_h43_cost_free_isolated_rehearsal.py` と既存登録済み `.github/workflows/task08-staging-b0-auth-http.yml` の専用H43 jobを追加。Trigger File `.task08-free-rehearsal-trigger` による一回起動のみ。既存のStage Auth/HTTP jobはH43起動時に実行しない。
- 実行 [Actions #44915274585](https://github.com/g-ambe/Padel-match/actions/runs/44915274585)。Python構文、Secrets存在、Pinned Supabase CLIと公式CAはPASS。続く隔離復元・Phase1→Phase2実SQLは**ジョブ完了後に判定**し、未完了時点ではGOとしない。
- 既存の本番DDL/Worker/Stage DBは変更していない。Phase1/2成功の有無とMigration履歴・既存データ行ハッシュはジョブ結果で別途報告。

## 11. H44最終結果（2026-11-22 JST）— Phase1/Phase2のschema-only実SQL検証PASS

正本：[H44詳細報告 `152_h44_free_schema_only_prod_migration_rehearsal_result.md`](152_h44_free_schema_only_prod_migration_rehearsal_result.md)。

- H43の**実データ暗号化全件バックアップ方式**は初回run`#44915274585`で取得中に失敗したため廃止。**現在の採用方式は利用者データ行を一切コピーしないschema-only**。前節「H43」は過去の試行記録であり、現在の方式を示すものではない。
- `#44952103384`：schema取得PASS／ローカル復元でSQLSTATE 2BP01→既存の安全な復元手順を適用。`#44952370833`：schema取得・隔離復元・スキーマ構造一致PASS／JSON出力処理のKeyErrorを修正。
- **[#44952613293](https://github.com/g-ambe/Padel-match/actions/runs/44952613293) 成功**。本番のスキーマ・RLS/ACL・ロール・関数・trigger・Migration名/versionをREAD ONLYで取得し、ネットワーク隔離PostgreSQL17へ復元。元のPhase1 6工程→合成履歴→Phase2 11工程→合成履歴→二重適用不可判定のすべてPASS、最後に一時コンテナ/ファイル削除PASS。
- **Prod/Stageは無変更**：Prod migration22/通常event91/公式event4/club13、新共有RPCなし。Stage migration74/event0/club3、新共有RPCあり。Wytel Bule Owlsのowner=あんべを再確認。PR #265はDraft/未マージ、Cloudflare未変更。
- **残件**：実データ（もしくは合成fixture）での移行時バックフィル/ACL/Owner分岐はH44の検証対象外。Stageのreal Auth/HTTP・主要画面/固定ペア/画像の回帰、正式Migration履歴とCloudflare公開順序、COMMIT後の復旧手順が別途必要。**H44成功は本番リリースGOを意味しない**。

## 12. H44 Stage Auth/HTTP追加回帰成功（2026-11-22）

- [GitHub Actions #44952963586](https://github.com/g-ambe/Padel-match/actions/runs/44952963586)：`staging-b0-http` **SUCCESS**。TypeScript、単体回帰（28+8+10+12＝**58 PASS／0 FAIL**）、Stage実Auth/PostgREST、公開人数（JWTとhelper）、匿名/未所属者閲覧、無効動画tokenの拒否はすべてPASS。
- `H34_RUN_SHARE_FIXTURE=0`で実Chromiumステップは**今回スキップ相当**（ジョブstepは正常終了）。実Chromiumでの通常/チーム/公式共有は過去の[#44873920056](https://github.com/g-ambe/Padel-match/actions/runs/44873920056) PASSに依拠。
- 先のH44[#44952613293](https://github.com/g-ambe/Padel-match/actions/runs/44952613293)で**Prodスキーマ相当のネットワーク隔離DBへPhase1(6)→Phase2(11)を連続適用PASS**。**合成前データ→後データのbefore/after移行検証は未完了**。初期0行のDBでのSQL実行成功と、実利用者データに対する移行の影響は区別する。
- Stage/ProdへのDDL反映・PRマージ・Cloudflare deployは今回していない。TASK-08の未実装写真と招待も引き続き残件。

## 13. H45 本番の実グループデータを使った移行試験PASS（2026-11-22）

詳細：[H45結果 `154_h45_real_data_migration_rehearsal_result.md`](154_h45_real_data_migration_rehearsal_result.md) ／ [GitHub Actions #44953743963](https://github.com/g-ambe/Padel-match/actions/runs/44953743963) **SUCCESS**。

- 本番READ ONLY・GitHub Actionsの**無料・ネットワーク隔離PostgreSQL**で検証。取得データはグループ13・所属41・選手プロフィール84・アカウントプロフィール7・加入申請3・本人連携申請3の**6表の限定列**。認証ユーザー/メール/パスワード/トークン/イベント得点/画像/通知本文などはコピーせず、行内容のログ出力/保存は行わない。
- **Phase1 6工程→Phase2 11工程の連続SQL実行PASS**。元の6表の限定列JSONハッシュが移行前後で一致。Phase1の名簿参照は**所属41件すべて生成**。
- Phase2で既存41所属の新表示名・本人公開同意は**NULLのまま**。公開グループ2件／有効所属14人のうち**連携済4人は本人同意前で公開名簿から省略、未連携10人は掲載**。公開人数RPCは14人を返し、各実公開クラブ別の照合PASS。認証なし直接`club_members`SELECTは禁止。owner NULLの稼働グループ0件。
- Migration履歴シミュレーションPhase1 1件・Phase2 1件・再実行不許可PASS。一時ファイル/隔離DB削除PASS。
- **限界**：`auth.users`を含む完全な実データ復元ではなく、実在メンバーのOwner引継ぎ/退会、固定ペア・戦績・画像/施設、旧UIから新UIへの切替確認は未完了。**本番GOではない**。Prod/Stage/Cloudflare/main無変更、PR Draft継続。

## 14. H46：本番実所属データによる退会・オーナー引継ぎのロール別試験PASS（2026-11-22）

詳細：[`156_h46_real_role_transfer_rollback_result.md`](156_h46_real_role_transfer_rollback_result.md) ／ [GitHub Actions #44954884161](https://github.com/g-ambe/Padel-match/actions/runs/44954884161) **SUCCESS**。

- 本番READ ONLYで取得したH45のグループ13／所属41／選手プロフィール84／アカウントプロフィール7／加入申請3／本人連携申請3の限定列を、隔離DBへ再投入。Phase1の6工程＋Phase2の11工程が再度PASS。
- **実役職のまま**：Bule OwlsのあんべOwner/main_admin、瀧田sub_adminを確認。匿名・他人の退会、Owner引継ぎ前の退会、sub_admin宛のOwner移管申請は拒否、sub_admin本人退会／重複拒否／所属・選手行履歴保持までPASS。
- **隔離DB内だけの一時昇格**：本人承諾の引継ぎ、辞退、第三者拒否、二重申請/承諾防止、承諾後の旧Owner退会可・新Owner退会不可、通知4件一致をPASS。さらに降格後承諾禁止・辞退許可・取消・取消後拒否をPASS。
- **3つの独立したROLLBACK群**を実行。各群終了後に実データ6表の元列の全行ハッシュが一致し、試験用auth.users・通知・引継ぎ申請の残存0件。
- 試験中に発見した`42704`は**テスト用GUC名の不備**（`h46_request`等）。名前空間付き`h46.request`等へ修正後に全工程PASS。**本番移行SQLやアプリ動作の変更なし**。
- Prod事後READ ONLY：Migration22、club13、members41、events91、matches521、match_results351、Ownerあんべ／瀧田sub_adminのまま。Stage Migration74で変更なし。本番/Stageへの新DDL/DML・Cloudflare deploy・PR merge無し。
- **限界**：本人の実JWT/HTTP操作、試合スコア行そのものの全件回帰、本番切替後の旧UI復旧は別検証。TASK-08全体のプロフィール画像・メール招待など未実装も引き続き残る。H46 PASSだけで本番GOとは判定しない。

## 15. H47：通常試合・チーム戦・固定ペア・スコア・画像・施設の非破壊監査と回帰（2026-11-22）

詳細：[`158_h47_legacy_regression_and_prod_integrity_result.md`](158_h47_legacy_regression_and_prod_integrity_result.md) ／ 本番READ ONLY検査SQL[`157_h47_prod_legacy_preservation_fingerprint_readonly.sql`](157_h47_prod_legacy_preservation_fingerprint_readonly.sql) ／ [成功Actions #44957088606](https://github.com/g-ambe/Padel-match/actions/runs/44957088606)。

- 本番の**22テーブル**について全行のDBサーバー側MD5集合フィンガープリントと件数を2回取得。両スナップショットで**22/22件一致**。情報は集約して扱い、実UUID・名前・スコア行・動画トークンなどはGitHubに記録していない。
- 本番の通常イベント**91**／ラウンド**336**／試合**521**／結果**351**／選手配置**2,084**、チーム戦**8**、公式イベント**4**／公式試合**15**、固定ペアstate**10**／pairs**2**／rounds**78**、プロフィール画像object**1**／施設**24**を確認。試合結果孤立/二重保存/完了と結果の矛盾、固定ペアの参照欠損、本人画像の参照・所有者不整合は監査した範囲では**0**。固定ペア/本人画像はRLS有効、anon直接SELECT不可。
- **既存スコア注意**：同点2-2にB勝ちが付いた**5件**（通常の公式集計候補）、削除済イベント内の負得点**1件**。これらは既存データとして観測され、今回修正は行っていない。前後比較時に既存異常を取り違えない。
- PR #265の現行コードでGitHub Actionsの既存機能回帰を実行。初回[#44956850136](https://github.com/g-ambe/Padel-match/actions/runs/44956850136)は**旧グループ削除テストの期待URLとref漏れ**により最終群で1件FAIL。実アプリ`/profile#profile-groups`遷移は変更せず、**`tests/group-delete.test.cjs`だけを更新**。
- 再実行[#44957088606](https://github.com/g-ambe/Padel-match/actions/runs/44957088606) **SUCCESS**：試合生成**35**、固定ペア**101**、スコア/GP/ランキング/動画**87**、画像/施設**54**、グループ/イベント**27**＝**304テスト実行PASS・0 FAIL**（重複実行1件を含む）。TypeScript `tsc --noEmit` PASS。
- H47は**既存機能のコード回帰＋本番現状のREAD ONLY整合**。本番の全イベント/画像を隔離DBに移してPhase1/2適用後の全行保持まで検証したわけではない。Stageは固定ペア/画像テーブルを欠き、Prod完全互換ではないため混同しない。
- **本番GOはまだ保留**。次はレガシー実データの隔離DB移行前後比較、Cloudflare`main`自動配信と本番Migration cutover/復旧整合、PR現HEADの実UI回帰、TASK-08別残件（同クラブ写真・招待等）。

## 16. H48：実イベント・固定ペア・戦績・画像管理4,279行のPhase1/2前後保持PASS（2026-11-22）

詳細：[`160_h48_real_legacy_preservation_result.md`](160_h48_real_legacy_preservation_result.md) ／ [成功Actions #44958408725](https://github.com/g-ambe/Padel-match/actions/runs/44958408725)。

- 無料GitHub Actions上のネットワーク切断済みPostgreSQL17へ、本番READ ONLY snapshotから**旧試合・公式・チーム戦・固定ペア・画像管理・施設の18表4,279行**を全列で一時復元。H45のクラブ/所属/選手/申請等**6表151行**も同一検証DBに復元。計24表4,430行の元データを検証した。
- **`before_phase1`→Phase1(6工程)後→Phase2(11工程)後の全18表の元列JSONB/SHA-256一致PASS**。本番データの得点異常（同点2-2勝者B×5件、削除イベント負得点×1件）を勝手に修復せず、RLS/匿名固定ペア・非公開画像の直接SELECT禁止、孤立試合結果・固定ペア参照・本人画像所有者整合を維持。
- H45の名簿参照backfill41行、本人同意を要する公開名簿、Migration履歴の前後確認も連続PASS。CI終了時一時DB/ファイル削除PASS。**本番/StageへのDDL/DML・Worker deploy・PRマージなし**。
- [初回run #44958331284](https://github.com/g-ambe/Padel-match/actions/runs/44958331284)はテストコードのPython局所`importlib`衝突でSQL未到達のFAIL。検証コードのみ修正後の[#44958408725](https://github.com/g-ambe/Padel-match/actions/runs/44958408725)は全PASS。
- **データ取扱注意**：実データ全列にはゲスト名・共有リンクtoken・R2オブジェクトキー・media attempt ticket等を含む。GitHub標準runnerのプロセスメモリとネットワーク隔離DBでのみ利用し、ログ・Artifacts・Stageへ出力せず、実画像バイナリは未コピー。ユーザーは実データ利用を許可済み。
- **限界**：R2の実画像本体/Cloudflare本番配信/全ページ実ブラウザ/本番同時更新と障害時復旧は別判定。**TASK-08本番リリースはまだNO-GO**。次の最優先はPhase2権限切替とCloudflare main自動デプロイ・旧UI互換・COMMIT後の安全な復旧順序の最終整合。

## 17. H49：GitHub PR全差分・本番切替/復旧可否の独立審査＝**NO-GO**（2026-11-22）

詳細：[H49全量審査 `161_h49_full_github_go_nogo_and_rollback_audit.md`](161_h49_full_github_go_nogo_and_rollback_audit.md)。

- 既存Draft PR #265の**全258変更ファイルの差分パッチ**を一覧化・リスク構文を横断確認、旧`main`側の重要アプリ画面/DB参照、Phase1(6)/Phase2(11)の原本SQL、Migration運用、GitHub Backup/Release/Actions、Cloudflareの実Worker部署状況、Prod READ ONLY権限/Supabase Advisorsも照合。
- **DBのCOMMIT前**のロールバックはトランザクション内で可能。しかし**Phase2 COMMIT後には確立・検証済みの限定逆Migration/互換SQLがない**。特に`club_members`匿名SELECTのREVOKEと新たな公開別名列、本人連携申請詳細RPCのDTO変更、H35の旧動画click匿名停止。古いWorkerへ戻すだけではDB権限・RPCが戻らず、単純にanonに全表SELECTを再付与すると個人公開別名漏えいリスク。
- **最新全件バックアップ不足**。GitHub Draft Releaseには2026-11-18 UTCの暗号化バックアップがあり、その時点のbackup/restore Actions #44203293217は両方SUCCESS。だが11/21の役職変更等より前。11/21-22の全件Snapshot/隔離復元H43 #44915274585は失敗。H44～H48の部分的実データ隔離Migration試験PASSは**全件災害復旧の証明ではない**。
- Cloudflare Prod `padel-match`には現行Worker version **#389**（2026-11-20 UTC）と旧版#388等のDeployment Historyあり。**Workerのアプリコード版のみのrollback経路はあるが新DBの互換性は保証されない**。H40資料では`main`自動deploy設定を記録、一方最新APIのBuild Trigger一覧GETは空であったため現有効設定の追加確認要。
- 本番現行匿名`club_members`テーブルSELECT=true、`clubs`/選手プロフィール/公式基底テーブル等の別のanon公開面も残り、H35後もTASK-08 P0全部は終わらない。Supabase Advisorのanon SECURITY DEFINER警告9件等を認可ガード別に確認する必要あり。
- PR branchは`main`より**469コミットahead/1 behind**、main側の1コミットは`AGENTS.md`のタスク管理/本番承認/検証ルール拡充。現在のPR branchのAGENTS.mdは旧版。これを取り込み、最新PR HEADのCI/Cloudflare互換性を再検証する。
- Issue #262メール招待、#241同一グループメンバーだけの写真表示、#264公開直近開催の一部要件が未実装。Phase1/2限界とTASK-08全体未完了を区別する。
- **本番Migration/Worker/main/PR mergeは未実施**。GO条件：最新本番全件外部バックアップ＋隔離復元成功、Phase2 COMMIT**後**の逆/forward-fixテストPASS、旧/新Worker×旧/新DBの互換テスト、Migration履歴正式採番・再実行防止、Cloudflare自動deploy制御、最新mainルール/PR HEAD CI、安全な手順とユーザーの本番GO。

## 18. H50：本番の実データによるPhase2 COMMIT後の切り戻しリハーサル（2026-11-24）

詳細：[H50結果 `163_h50_post_commit_rollback_rehearsal_result.md`](163_h50_post_commit_rollback_rehearsal_result.md)／[Actions #45297128444](https://github.com/g-ambe/Padel-match/actions/runs/45297128444) **SUCCESS**。

- 11/24最新READ ONLYの本番DB定義をネットワーク隔離Docker Postgres17に復元し、既存H45グループ関係**6表151行・限定列**＋H48通常/チーム/公式試合・固定ペア/プロフィール画像/施設等**18表4,279行・全元列**を導入。Phase1 6工程COMMIT→Phase2 11工程COMMITを再実行し、全列/元列データと権限・公開名簿14名（linked同意待ち4名、未連携10名）をPASS。
- **Phase2 COMMIT後**、旧anonの`club_members`直接SELECTが実際に拒否されること、本人連携詳細RPCの関数定義が旧版と異なることを確認。**旧Cloudflare Workerだけ戻してもDB契約は戻らない**。匿名への`club_members`全表SELECTを再GRANTする危険な互換化は実施しない。
- 隔離DBに後続の試験用書込みをCOMMIT→**元のschema.dump＋24表の取込済み本番実データから破壊的に再構築**して、旧ACL・RPC関数定義・Migration台帳（22件）・データ照合をPASS。追加した後続レコードは復旧で**消滅**した。**戻せるが後続正常データを失い得る**ことを実証。
- 最新の**実全件バックアップ**に関するH49の古い記述を上書き：2026/11/22 09:20 JSTに[Actions #44966082064](https://github.com/g-ambe/Padel-match/actions/runs/44966082064)で**166表を暗号化取得・別job隔離復元・行/値/RLS/ACL照合すべてPASS**、非公開Draft Release ID454086112保管済み。ただし**今回のH50ではこの全件アーカイブをダウンロードしていない**。直近の本番変更を守るには実公開直前の再バックアップが必要。
- **H50は局所的な破壊的復旧実証PASSだが、実本番無損失rollbackではない**。本番DB・Stage DB・Cloudflare/Worker/mainは変更せず、既存PR #265 Draft維持、Supabase有料環境を作成せず無料Runnerだけを使用。
- **TASK-08リリース判定NO-GO継続**。次は旧/新Worker×旧/新DBの実HTTP互換と旧アプリの限定forward-fix、プライバシーの維持、Migration正式履歴・Cloudflare配信制御の確認。DB全体を過去snapshotへ戻すことを常用の切戻しとしない。

## 19. H51：Phase2 COMMIT後の「データを巻き戻さない」旧連携承認セーフガード候補PASS（2026-11-24）

詳細：[H51結果 `166_h51_safe_forward_fix_legacy_link_rehearsal_result.md`](166_h51_safe_forward_fix_legacy_link_rehearsal_result.md)／検証SQL[`164_h51_postcommit_safe_legacy_approval_guard_CANDIDATE.sql`](164_h51_postcommit_safe_legacy_approval_guard_CANDIDATE.sql)／隔離テスト[`165_h51_postcommit_no_loss_guard_rehearsal.py`](165_h51_postcommit_no_loss_guard_rehearsal.py)／[Actions #45300504350](https://github.com/g-ambe/Padel-match/actions/runs/45300504350) **SUCCESS**。

- 既存H45/H48無料・ネットワーク切断PostgreSQLで、Prod READ ONLYの**6表151行限定列＋18表4,279行全元列**を復元し、Phase1 **6工程**→Phase2 **11工程**の独立COMMITまで再PASS。新しいコード経路をユーザー認可付き別名・公開同意を通らず旧Workerから呼び出せることが重要なリスク。
- **旧`main`の本人連携画面**は旧`review_player_profile_link(...,'approved',review_token)`を呼び、**新仕様のグループ別表示名・公開の確認は行わない**。その旧RPCがPhase2にも残っているため、旧Worker単体rollbackでは**同意欠落の承認**が可能になり得る。実ブラウザでの悪用再現までは未実施。
- **H51候補SQLは隔離用・本番未承認**：元のreview処理を非公開`profile_link_private`へ複製して直接EXECUTEを禁止、同意付きの`review_player_profile_link_named`だけを元処理へ内部接続。旧public`review_player_profile_link`は`approved`を**42501拒否**し、`rejected/cancelled`のコード経路は元処理へ委譲。匿名`club_members`全表SELECTは再GRANTしない。
- **実測PASS**：認証済み旧`approved`拒否、匿名review拒否、内部元実装のanon/authenticated直接呼出し不可、旧`rejected`を既存approved申請で呼んでも状態維持、新namedの内部接続・EXECUTE権限、既存24表元データハッシュ/ACL/RLS/Migration件数不変、Phase2後に隔離DBへ追加COMMITしたマーカー残存。**破壊的なsnapshot復元は実施していない**。
- 初回[#45300126925](https://github.com/g-ambe/Padel-match/actions/runs/45300126925)はテストコードで未存在privileged関数を文字列からOID解決しようとしてPostgres`42883`、H51 SQL実行前にSTOP。null安全な`to_regprocedure`へ変更後に再実行[#45300504350](https://github.com/g-ambe/Padel-match/actions/runs/45300504350)で**全工程SUCCESS**。
- **本番GOは引き続きNO-GO**。現在の本番実申請3件は全てapprovedにつき、**新named正常承認／本来のpending拒否・取消のE2Eは未実施**。旧Workerの連携承認は意図的に利用不可のまま、旧管理者画面DTOも一部一致しない。ブラウザ/実JWT/PostgREST/Cloudflare Worker全導線と本人同意新規pending fixtureの実証が別ゲート。正式SQLの組込み・同意を省く旧承認経路の閉鎖タイミングは公開前に審査。
- **Prod/StageへはDDL/DMLせず、Cloudflare/main/PR mergeなし、無料Runnerのみ。** 既存PR #265 Draft維持。Github Project項目更新は未実施、Issue #264／親 #215への実績コメントと本台帳で記録。

## 20. H52/H53：本人連携・通常加入・管理者手動復元の本番相当隔離SQL検証PASS（2026-11-24）

- H52 初回 #45305167255、診断 #45305784260 は公開named正常承認でP0001。Prodの0039 FK guardに0048の本人専用3 FKが未登録。Stageに3テーブル自体なし。Prod READ ONLYで確認し、[168候補](168_h52_media_reference_guard_CANDIDATE.sql) で既知3 FKのみ許容、source側に該当行があれば拒否、未知FK拒否と本人側不変を維持。正式Migration未採用。
- [H52 #45306362432](https://github.com/g-ambe/Padel-match/actions/runs/45306362432) HEAD 27a721a4c104c7a40a92f164f125960ba27aa567： [167 probe](167_h52_pending_link_isolated_rollback_probe.sql) 27判定すべてPASS。公開/非公開named承認、CAS、公開同意、旧承認拒否、pending拒否/取消、対象本人の画像メタデータ不変、仮選手側の3種参照拒否、未知FK拒否、監査整合、ROLLBACK後の24表・権限・履歴・マーカー保持。
- [H53 #45307148744](https://github.com/g-ambe/Padel-match/actions/runs/45307148744) HEAD b2798daeb18eb3f22fe04bf7273995fe3791a727： [169 probe](169_h53_join_and_reviewed_restore_isolated_probe.sql) 16判定すべてPASS。H52の27判定も再PASS。通常加入、仮選手引継ぎ、公開同意なし拒否、既存mainの管理者手動復元SQL本体による元所属・表示名・仮プロフィール復元、本人画像/設定と別加入の保持、監査と申請状態、ROLLBACK後データ/ACL/履歴維持。隔離cleanup成功。通常画面からの解除機能追加なし。
- H52/H53はSQL role/claim模擬のみ。実JWT/HTTP/Worker、並行操作、統合後に編集した行の復元拒否、実R2画像本体は未検証。Stage HTTPとH47別jobはskip。本番/Stage書込み、Cloudflare/main/mergeなし。H51/H52候補は隔離専用。NO-GO維持。

## 21. H54：旧/新アプリ×旧/新DB互換性のコード調査開始（2026-11-24）

- mainとPR #265の連携画面、グループ詳細/検索、通常・公式共有ページ、group-read/public-club-join、Phase1/2を比較。現段階はソースと既存SQL証跡の調査であり配信Workerや実HTTPの検証ではない。
- 旧連携画面は旧review approvedを呼ぶ。Phase2＋H51では意図的に拒否。旧管理者画面はpendingかつrequest.sourceを要求する一方、Phase2管理者DTOはsourceを返さず、取消ボタンが表示されない（別のグループ管理画面の取消経路あり、実動作未確認）。新画面は管理者DTOを別表示しnamed承認を使用。旧DBではnamed RPC/表示名DTOが存在せず、承認不可。
- 旧グループ詳細/検索はclub_members直接SELECT。Phase2のanon ACL撤回は確認済みだが、認証済みの旧画面の全挙動は未確認。新画面はget_my_club_memberships/get_club_roster/get_public_club_directory等、Phase1/2に依存。旧DBへ新アプリだけ先行配信するとRPC欠落。公開人数はPhase2まで必要。
- 新通常・公式共有ページはPhase1 get_shared_eventとtoken別click RPCを使用。旧ページは直接events/official_events等と旧click RPC。Phase1は旧anon基底SELECTを撤回しない。旧click停止は新共有導線確認後の別工程。全旧共有の動作は未検証。
- 次：旧/新アプリの4組合せ＋Phase1中間状態を実JWT/PostgREST/ブラウザで検証する方法を設計。旧→新切替に同意欠落の窓を作らない（Phase2と承認ガードの正式順序/原子性を検討）。必要な互換アプリはCodexに既存PR範囲で指示する。既存権限を再開放しない。最新版DB・Worker・自動deployの実状態照合、正式Migration・復旧/バックアップ・最終承認は残件。

## 22. H54検証範囲の変更：DB先行・直後に新アプリ配信（ユーザー方針 2026-11-24）

- ユーザーはDB適用直後に新アプリを配信する方針を選択。H54の旧/新アプリ×旧/新DBの4組合せ完全互換・長期共存・互換用追加実装は今回の対象外とする。既存のコード調査結果は切替リスク資料として保持するが、旧アプリの通常機能の継続動作を公開条件にはしない。
- **新アプリ×適用後DB**の実Auth/HTTP・アプリ導線、データ保全・権限・公開同意、最新HEAD CI/Cloudflare互換ビルドへ検証を集中する。StageはProdと構造が異なるため、Stageだけの成功を本番相当の証明としない。
- DB適用から新Worker配信確認までの短い切替区間も、旧クライアントや直接APIからの同意回避を許容しない。H51旧承認拒否、H52参照guard、Phase2のACLを維持し、同意欠落の窓が生じない正式SQL順序・原子性を審査する。旧UI互換目的で広い権限を復活させない。
- 切替前に新Workerのビルドを成功させ、必要に応じて短時間のメンテナンス/対象操作停止を設計する。DB適用後は直ちに新Workerを配信し、配信成功・実バージョン・DB履歴・スモーク結果を確認する。失敗時は安全な操作停止・forward-fixを優先。旧Workerへの単純rollbackや破壊的な全件DB巻戻しを標準復旧にしない。
- 最新の全件外部バックアップと復元、R2の扱い、正式Migration履歴/二重適用防止、main自動deploy制御、明示的な本番承認は引き続き必要。H54の次工程は新アプリと新DBの実HTTP・ブラウザ検証に必要な環境・契約の整理。H53の並行操作等の未検証項目は別途リスクに応じて評価する。
- **今回の方針承認は検証範囲の変更であり、本番SQL適用・配信・main mergeの許可ではない。** 本番NO-GO、PR #265 Draftを維持する。今回の変更は進捗台帳のみ。

## 23. H54：安全な一括切替リハーサルと新アプリCI（2026-11-24、結果確認中）

- [170 H54 driver](170_h54_atomic_cutover_rehearsal.py) を追加。Phase1 COMMIT後、Phase2 145＋H51 164＋H52 168＋隔離用履歴を一つのtransactionで処理し、直前故障（SQLSTATE 22012）、Phase1への復帰、正常COMMIT、重複拒否、H52/H53の再試験を要求。[DB run #45308564260](https://github.com/g-ambe/Padel-match/actions/runs/45308564260) tested HEAD 1cd17708fc17822f4ebc76013edb88779126462e。Python compile成功、DB runの完了ログは未確認。隔離専用2099履歴・markerは正式Migrationではない。
- 新アプリ回帰16ファイル＋TypeScript＋OpenNext build専用CI追加（dummy localhostのみ、Prod/Stage credentialなし、deployなし）。[初回 #45308698957](https://github.com/g-ambe/Padel-match/actions/runs/45308698957) tested HEAD def66b2b258077f6acfda649905e6d6785682aae：66/66 PASS、TypeScript PASS、OpenNextは /bin/sh: bun: not found でFAIL（Nextビルド開始前）。固定Bun PATHのCIのみ修正 115b452a4ceb、[retry #45308838062](https://github.com/g-ambe/Padel-match/actions/runs/45308838062) tested HEAD 10b448a4701f8db980dba8e7d6e4d478b5ee22cf、完了未確認。
- [171 新アプリ×新DB実Auth/HTTP受入計画](171_h54_new_app_new_db_http_acceptance_plan.md) を追加。実データ入り隔離DBをHTTP公開しない。実Auth/HTTP・SDK・ブラウザは別の合成データ専用ローカルSupabaseで確認する設計、既存Stageの構造差/未検証範囲とA1〜A10受入条件・Codex担当を記録。環境の構築・実HTTP受入は未実施。
- 次：両runのログとcleanup確認、失敗時は原因別に修正。新アプリ×新DBの合成環境実Auth/HTTP・画面試験（Codex担当とSQL担当分離）へ。正式Migration/履歴整合、リリース順序/バックアップ・復元・本番承認は残る。NO-GO、PR #265 Draft維持。Prod/Stage書込み、Cloudflare変更、main merge、追加有料環境なし。

## 24. H54：一括切替SQL・新アプリCIともPASS確定（2026-11-24）

- [DB run #45308564260](https://github.com/g-ambe/Padel-match/actions/runs/45308564260) tested HEAD 1cd17708fc17822f4ebc76013edb88779126462e：全対象step SUCCESS。ログでH54故障注入後のPhase1契約・行・履歴復帰、Phase2＋H51＋H52＋試験履歴の一括COMMIT、二重適用拒否と状態不変を確認。H45/H48/H51、H52 27/27、H53 16/16、既存24表の元データ/権限/整合と後片付けstep再PASS。H47・Stage HTTP jobは対象外skip。実JWT/HTTP/Worker連携を証明するものではない。
- [新アプリretry #45308838062](https://github.com/g-ambe/Padel-match/actions/runs/45308838062) tested HEAD 10b448a4701f8db980dba8e7d6e4d478b5ee22cf：66 tests、66 PASS、fail/skip 0、TypeScript PASS、Next compile PASS、OpenNext worker.js生成、Worker/assets BUILD_ID一致PASS。固定Bun PATH修正のみで初回CI環境障害を解消。dummy localhostでbuildのみ、実配信なし。両run以降のHEAD b15f4eb23cd07e014aa21857fb1f97dfc7a9df39 は台帳更新のみ。
- **H54 SQL/新アプリCI部分PASS。実Auth/HTTP/ブラウザ受入は未実施**。次は171計画に従い、合成データ専用ローカル環境で新アプリと新DBをつなぐ受入検証。アプリ実装/試験はCodex担当、SQL/DB契約と独立安全審査はChatGPT担当。正式Migration履歴と原子性、最新バックアップ・復元、配信制御と明示本番承認も残る。
- Prod/Stage書込み、Cloudflare変更、main merge、追加有料環境なし。PR #265 Draft／本番NO-GO維持。Projectフィールド未更新。

## 25. H55：合成専用ローカルSupabaseの実Auth/PostgREST環境ゲート（2026-11-24）

- H54 SQL/アプリCI PASSを受け、171計画の次工程へ。ProdのMigration履歴をREAD ONLYで再確認し22件（0047〜0053＋手動セキュリティ15件）。旧SQL全件の番号順再生は本番相当性を保証しないため、アプリschema再構築は過去の実適用定義/ACLと照合して進める。
- [172 H55 probe](172_h55_local_auth_http_environment.py) と専用workflow `.github/workflows/task08-h55-local-auth.yml` を追加。既存checksum検証済みCLI v3.0.0、新規runner/一時ディレクトリ/loopback Docker network、合成3アカウント。実signup/password sign-in/getUser/JWT→PostgREST auth.uid()照合、合成sentinelテーブルの自己行insert/select・第三者read/write拒否・anon拒否・改ざんJWT拒否。管理者SQLは合成fixtureのみ、公開用keyでHTTP実行、終了時stack/volume/network/一時dir削除。実データ入りLocalRestoreをネットワークに接続しない。Prod/Stage鍵・データ・Cloudflare認証は渡さない。
- [H55 Actions #45310943180](https://github.com/g-ambe/Padel-match/actions/runs/45310943180)、tested HEAD b35a0035670ff08d35477065c9073fa73caff58c、起動確認・結果未確定。今回は環境ゲートのみ。H55 PASS後は実アプリschema/RPC/ACL/FKの合成環境構築・H52/H53の実HTTP COMMIT・新アプリSDK/375px画面受入へ。正式Migration確定・本番適用とは別。
- Prod/Stage書込み、Cloudflare変更、main merge、追加有料環境なし。既存Draft #265、NO-GO維持。Projectフィールド未更新。
