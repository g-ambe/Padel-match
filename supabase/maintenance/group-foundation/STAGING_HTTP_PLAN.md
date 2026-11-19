# TASK-08-03 / P0：既存ステージングの実Auth・HTTP試験準備

## 0.16 2026-11-19：本番互換の共有RPC新設候補と導入順序（Stage適用・Prod未実施）

**対象**：PR #265、Issue #264。**本番DB・本番Cloudflareデプロイ・PRマージは一切変更なし**。

- ProdをREAD ONLYで再監査：実行所有者 `postgres`、`security_private` schema・`get_shared_event(text,text)` が不存在、0045混合/ラウンドの必須15列欠落0。終了済み共有ONの有効な通常9件＋公式1件、現行共有tokenに不正な文字0（実token値は取得・記録していない）。
- Stageの旧限定共有SQLとProdのカラムを照合し、`54_h12_prod_compatible_rpc_candidate.sql` を既存PRに追加。新設では `security_private` schemaを必要な場合のみ作成し、`security_private.shared_event` をprivileged内部関数、`public.get_shared_event(token,kind)` を匿名/ログインの意図的なtoken検証付き `SECURITY DEFINER` 公開RPCとする。内部関数の `PUBLIC/anon/authenticated` の直接EXECUTEをREVOKE。**既存`security_private` schemaのUSAGEは他のRLS helperを壊さないため一括REVOKEしない**。基底表anon SELECTの変更は明確に別工程。
- `54` のStage `BEGIN/ROLLBACK` では、既存関数上書き・両関数を同一トランザクション内で一時DROPした**Prod初回導入相当**の双方で作成成功。初期版のpreflightに存在しない関数への `::regprocedure` 参照があり、存在検査を `to_regprocedure` + `pg_proc` の安全なSQLに修正した後、新設相当のROLLBACK試験PASS。
- 新しいRPCを同一ROLLBACK内で `50_h12_mixed_round_rollback_probe.sql` と `46_h12_share_token_rollback_probe.sql` に通し、混合のラウンド/コート/4-2/所属/匿名化と通常/公式の正規token、無効/共有OFF/種別違いの返却、基底表直接拒否はいずれも期待値一致。
- **Stageだけ** `task08_staging_h12_prod_compatible_rpc_boundary` としてRPC更新成功。更新後の独立ROLLBACK試験もPASS。Stage公開RPCはanon/auth EXECUTE可、内部helperはanon/auth直接EXECUTE不可、匿名基底表SELECTも従前どおり不可。Stageイベント・公式イベントはそれぞれ0件のまま。
- `tests/shared-event-rpc-release.test.cjs` を追加し、`test(H12)` ワークフローへ登録。初回CI [#44536061885](https://github.com/g-ambe/Padel-match/actions/runs/44536061885) はテストがpreflight以外の正常なpostflightの `regprocedure` まで拾う**静的テスト自身の過剰検出**で失敗。テスト対象をpreflight区間に限定して修正し、[**#44536600145**](https://github.com/g-ambe/Padel-match/actions/runs/44536600145) ではH12 DTO/新設時権限検査、TypeScriptコンパイル、Stage実Auth/PostgREST B0の全ステップ成功。
- 将来の本番リリース手順と失敗時の中断条件は `55_h12_production_cutover_plan.md` に記録。本番では **①RPC導入→②他P0互換確認/アプリ切替→③実リンク画面確認→④7表の匿名SELECT遮断** の順序とする。既存PRは他のP0改修も含むため、H12だけを先に本番デプロイしない。元の `53` の固定合成tokenチェックはProd用に置換が必要。
- **未完了**：本番の正式Migration化と本番適用/実トークン動作確認、H12画面E2E、全P0本番移行条件、H14実履歴例外。**Draft PRを維持**。


## 0.15 2026-11-19：H12実HTTP正例・混合0044/0045 Stage互換・匿名SELECT遮断

**対象**：既存 `codex/task-08-group-foundation` / Draft PR #265 / Issue #264。**本番 DB、Cloudflare本番、マージ、デプロイは無変更**。

### Stageで追加したDB互換性とロールバック検証
- 本番には存在しStageで欠落していた `0044_friendly_team_attendance.sql` と `0045_friendly_team_random_rounds.sql` を、リポジトリ内の原本から取得。両ファイルを同じトランザクションで **BEGIN→ROLLBACK** して、CREATE TABLE/ALTER/関数/RLS/制約/匿名RPC EXECUTE拒否などの成立を検証。Stageのイベント・公式イベント・試合・ゲストが0件であることを確認後、**Stage限定** `task08_staging_only_0044_attendance_parity`→`task08_staging_only_0045_team_rounds_parity` として順次適用成功。Prodは既存Migration済みのまま。
- `50_h12_mixed_round_rollback_probe.sql` を追加し、新スキーマの実 `event_team_rounds` に1ラウンド、混合4対2、A/B両所属から2人ずつ、ゲスト4名を合成。**匿名共有RPCの混合得点4対2・ラウンド/コート1・ペア勝敗・所属元4枠・匿名化ゲストID・無効token非返却がすべて真**。全件ROLLBACK（Stage試合データに未保存）。
- `51_h12_stage_http_fixture_setup.sql` でStageだけに限定した合成通常1件・チーム混合1件・公式1件を事前条件でガードし一時作成。関連4人/1試合ずつ、公式・混合スコア4対2。共有tokenは合成fixture専用（本番token/プロフィールID/JWT等を使用しない）。
- `08_staging_auth_http_smoke.mjs` へ `TASK08_H12_TEST_POSITIVE=1` のときのみ走る正規tokenの実HTTPケースを追加。通常・混合・公式の正規tokenがHTTP200で最小結果を返すこと、匿名直接テーブル3件の取得拒否を検証。[**run #44533019156**](https://github.com/g-ambe/Padel-match/actions/runs/44533019156) **成功**。一時フラグは試験後に除去。

### Stage限定の匿名基底表権限の閉鎖
- **追加発見**：本番/Stageとも `event_team_matches`, `event_team_guests`, `event_video_links` にanon SELECTを持ち、Prodの公式3表とチームサイドはさらに公開。本番公式の無token生データ閲覧リスクは依然 **本番未対応**。
- `53_h12_anon_shared_base_acl_candidate.sql` に、token共有RPC存在・EXECUTE権限・PostgreSQL実ロールのガードと、**共有関連7表のanon SELECTだけをREVOKE**する候補を追加。authenticatedのSELECT/RLS/INSERT/UPDATE/DELETEは無変更。StageでBEGIN→ROLLBACKの正負例確認後、Stage限定 `task08_stage_h12_close_anon_shared_base_select` として適用。
- Stage適用後の `has_any_column_privilege('anon',...,'SELECT')` は対象7表すべてfalse、authenticated SELECTは7表すべてtrue。token RPC正規共有（通常/混合/公式）の実HTTPを再試験し、直接GET負例も維持。[**run #44533432780**](https://github.com/g-ambe/Padel-match/actions/runs/44533432780) **成功**。この結果は本番への適用許可を意味しない。
- `52_h12_stage_http_fixture_cleanup.sql` を事前BEGIN→ROLLBACKでテスト後、本適用。対象3開催、2組の試合/出場/スコア/ゲスト・ラウンド/公式戦をガード付きで全件削除。Authユーザー/クラブ/所属/実プロフィールは変更なし。**終了後Stage events=0, official_events=0, event_team_rounds=0, event_team_matches=0, event_team_guests=0, match_results=0**、既存テスト用グループ2件・所属12件は維持。
- Stage GitHub Actionsの一時正例フラグを削除し恒常の読み取り専用B0へ復元。後片付け後の [**run #44533669933**](https://github.com/g-ambe/Padel-match/actions/runs/44533669933) で **H12 DTOガード・TypeScript `tsc --noEmit`・実Auth/PostgREST B0すべて成功**。共有名・トークン・資格情報の生出力なし。
- セキュリティAdvisorは既存の `SECURITY DEFINER` / immutable search_path等を警告。今回のH12だけで全警告がなくなったわけではなく、対象関数の利用元と認可の別レビューが必要。

### 残るリリースゲート
1. **Prod互換RPC Migration候補**：Stageに既存だった `security_private.shared_event` と `public.get_shared_event` はProd未実装。Prodのスキーマ・ポリシー差と列一覧に合わせた追加Migration、利用側への切替、匿名SELECT REVOKEの**段階的な本番適用順**が必要。現時点では本番migration/デプロイ禁止。
2. **H12画面・副作用の実機確認**：リンク表示（通常・混合・公式）、動画クリック、個人/ペアランキングが本番既存UI/集計と完全互換かは未確認。HTTPのDTOだけで画面のE2Eを合格扱いしない。
3. **H14の既存履歴・スコア例外6件**、退会者戦績、グループ別名/自主退会/画像/3タブ、本番/Stage環境差、H01〜H14全体受入は残件。**PR #265 Draft・Issue #264 OPENを維持。**


## 0.14 2026-11-19：H12チーム共有DTO／共有ページRPC移行（Stage限定）

**対象**：既存ブランチ `codex/task-08-group-foundation`・Draft PR #265・Issue #264。
**本番DB・Cloudflare・PRマージ・デプロイ：変更なし。**

- `49_h12_shared_team_dto_stage_candidate.sql` を既存 `security_private.shared_event(text,text)` の返却DTOを拡張する候補として追加。変更前後とも公開ラッパー `get_shared_event(token,kind)` を使用し、共有ON・終了・有効クラブ・token一致の条件を維持。匿名の基底表SELECT権限は追加しない。
- 追加項目：通常の参加者種別、チーム試合の試合順・ラウンド・コート・対決/混合モード・混合スコア・所属元・匿名化ゲストID・チームゲスト一覧。チーム選手のプロフィールIDは既存の共有イベント単位の仮名に留め、本人IDや共有tokenをDTOに載せない。
- **Stage ROLLBACK**：候補関数の作成・無効token/null・匿名呼出しを確認。合成手動チーム戦（2チーム、試合1、ゲスト2）で `team_matches=1`、`team_sides=2`、`team_guests=2`、`match_order=1`、得点表示用の最低限のフィールドを確認。全データROLLBACK。
- 上記を確認後、**ステージングのみ** `task08_h12_shared_event_team_dto_staging` として関数変更を適用成功。元の `46_h12_share_token_rollback_probe.sql` を再実行し、通常・公式の正規token、無効/共有OFF/種類違い、匿名基底表取得拒否はすべて期待通り。ステージングの実イベント・試合は0件のまま。
- `app/share/events/[token]/page.tsx` を匿名基底表/プロフィール直接取得から **token専用 `get_shared_event('event')`** に移行。チームDTO欠落時は結果を推測補完せずエラー表示。公式共有画面は既存のtoken RPC移行を維持。`tests/shared-event-page-rpc.test.cjs` で基底表直取得復活とDTO漏れをガード。
- **追加発見：匿名共有基底表のACL/RLS**。Stage `event_team_matches`・`event_team_guests`・`event_video_links` には匿名SELECT表権限と共有ON等を条件とするSELECT policyが残存。ただし**合成イベントを用いた共有ヘッダーなしanonの実SQL直接SELECTは3表とも42501拒否**（Stageの現在の他表権限との合成結果）。実漏えいを再現したとは判断しない。今後の権限差解消時はこれらも明示的に閉じ、共有RPCだけを許すことを再検証。Prodで確認済みの公式共有関連の匿名直接取得リスクは別途未修正。
- **制約**：Stageは `event_team_rounds`・混合列が本番と未一致。候補関数は `to_jsonb(etm)` による存在列参照でStageと本番の差を吸収するが、**実混合モードの正例は未確認**。正規token実HTTP、ユーザー実機表示、正式な本番互換Migration、全H12/H14受入は未完了。既存PRはDraft/OPEN維持。
- Stage B0・DTOガード・TypeScriptをGitHub Actionsで再実行するよう既存workflowを更新し、`.task08-b0-trigger` から起動（[run #44531006625](https://github.com/g-ambe/Padel-match/actions/runs/44531006625)で **H12 DTO回帰テスト・TypeScriptコンパイル・ステージング実Auth/PostgREST B0の全ステップPASS**。ブランチ/SecretsはStage専用、PRはDraftのまま）。Secrets値はコード・ログに含めない。

**次工程**：①GitHub Actions結果確認 ②Stageチーム混合/ラウンド同等スキーマ・正規token HTTP正例 ③本番の匿名基底表公開を閉じる候補をStage負例→互換検証 ④H14既存スコア例外/退会履歴確認。**本番変更は別承認。**


## 0. 2026-11-19：ChatGPT連携からの最新DB照合・ステージング追加Migration適用（後続更新）

この節は後続の作業結果。以下にある「当時は未実行」「接続不足」は、コミット `2b5ef1d` の作成時点の履歴として保持する。**本番への適用を意味しない。**

- 接続済みSupabase管理連携で、明示した本番 `padel-hub`（`ntczrmvffmpjzilfebyi`）とステージング `padel-hub-staging`（`zzjwpresqkefnyjyisgd`）それぞれに、リポジトリ内の**同一の** `04_http_preflight.sql` を実行。`BEGIN READ ONLY` / `ROLLBACK` で完了し、関数本文やデータ行の取得・外部保存はしていない。
- 2026-11-19 05:06 UTC時点：本番の履歴22件／監査対象relations 42／policies 59／functions 28。ステージングは履歴42件／relations 32／policies 38／functions 30。**監査対象件数でありDB全件数ではない。**
- 本番では `clubs`・`club_members`・`player_profiles` に匿名SELECT許可があり、ステージングでは3表とも匿名SELECTなし。`profiles.display_name`の匿名列SELECTも本番のみ許可。旧連携5関数の定義ハッシュは本番・ステージングで不一致。RLS指紋も主要表で不一致。**この意味差・既存の旧公開リスクは未解消。**
- 0054・0055由来の主要公開RPCは、適用前は**両環境に存在しない**ことを確認。ステージングで既存カラム・呼出先関数の事前照合は欠落0件、所有者 `postgres`、既存所属8件、選手プロフィール8件、Authユーザー0件、対象所属／選手プロフィールの孤立参照0件。非公開スキーマと新RPCも事前には存在しなかった。
- ユーザーからChatGPT側での作業・DB修正を進める指示を受け、**ステージングのみにリポジトリの追加型Migration 0054→0055を原文で適用**。SupabaseのMigration履歴は `task08_0054_group_read_interfaces_staging`（`20261119051640`）と `task08_0055_group_read_consumer_support_staging`（`20261119051703`）の2件が追加され、計44件。**本番DBは未適用**。旧表ACL/RLS/旧連携関数・既存データの一括更新は行っていない。
- 適用後の読み取り専用検証：新公開RPC 17件、非公開helper 6件、`group_directory_reference`トリガー1件。既存所属8件に対し公開参照も8件、欠落0件。匿名の非公開スキーマUSAGE・公開名簿RPC・本人申請RPC・加入申請一覧RPCは拒否。ログインユーザー向けの必要なEXECUTEは許可。ステージングの `club_members` / `player_profiles` の匿名基底表SELECTは引き続き拒否。
- **未実施**：現行ステージングの本物のAuth試験アカウント作成・JWT付きHTTP試験、`03_link_detail_candidate.sql` の確定適用、旧連携RPCや表/列の公開権限切替、ステージングと本番のRLS・5関数意味差の解消、通常/チーム/公式等の完全な実HTTP互換検証。ステージングの不足11表はそのまま。**既定ROLLBACKの候補SQLは変更していない。**
- セキュリティAdvisorには既存View `public.public_player_profiles` のSecurity Definer設定などが報告されている。新Migrationに起因するとは確認しておらず、この作業で無関係なView・権限・機能を変更しない。

**残るゲート**：現行B0の実Auth/HTTP基準取得には、既存データと分離した試験用Authユーザー/fixtureの安全な作成手段が必要。B1/B2の安全性証明には既存関数・RLSの意味差レビュー、独立した復旧手順、管理UPDATE RETURNING/初期所属/共有/戦績を含むHTTP負例が必要。PGliteやSQLの `SET ROLE` を実Auth/HTTPの代用にしない。PR #265はDraft、マージ・本番SQL・本番デプロイ禁止。

## 0.13. 2026-11-19：H12共有token境界とH14履歴監査のREAD ONLY検証

**今回のH12/H14は、既存のStage/本番データへの書き換えを行わない事前監査を主体とする。** 本番での匿名公開リスクを確認したが、**本番のACL/RLS/関数/アプリ・Cloudflareは未変更**。グループ基盤の既存Draft PR #265だけを更新し、新規PR/branch/merge/deployなし。

### H12：既存の共有画面とStageの実際の権限に差がある

- `app/share/events/[token]/page.tsx`（通常/フレンドリーチーム結果共有）は`events`, `event_participants`, `matches`, `match_players`, `match_results`, `event_team_*`, `event_video_links`を**匿名クライアントから直接SELECT**する。通常イベント側は`x-padel-share-token`ヘッダー付きの独立した匿名クライアントを使用するが、Stageの`events/matches/match_results/event_participants`は`anon SELECT`を許可しないため**Stageでは既存画面の読み取りが成立しない**。
- Stageには既存の限定`public.get_shared_event(p_token text,p_kind text)`＋`security_private.shared_event`がある。元の`p_token`と共有enabled・closed・削除されていない状態・club有効性を検証して、イベント名/参加者表示名/試合スコア、または公式イベントの相手・スコア・氏名の必要項目だけをJSONで返す。通常テーブルへの匿名SELECT権限は不要。共有試合内のplayerプロフィール識別子は変換され、Auth ID・メール・プロフィール内部情報を返さない設計。
- **本番にはこの`get_shared_event` RPCが存在しない**（Stageの限定RPCを本番へ未移行）。UIをRPCへ変更しても、本番移行に先立ってRPC SQLの互換Migrationと本番同等の実データ試験が必須。現行フレンドリー共有の**チーム混合（generation_mode/pair_1/2_score/pair_result）・ラウンド・ゲスト判定**はStage RPCのDTOだけでは完全再現できないため、通常共有ページの直接SELECTを無断でRPCへ一括置換していない。
- `app/share/official-events/[token]/page.tsx`はもともと本人セッションを保持するクライアントで`official_events/official_opponents/official_matches`の直接SELECTと公開プロフィール名RPCを使用。**この共有ページのデータ取得に限り**独立した匿名トークン専用`getSharedEventClient(token)`による`get_shared_event(token,'official')`へ切り替えた（既存の動画クリック計測は変更しない）。表示名は共有限定RPCが返す試合行の安全な名前を使用。**PRはDraft、本番にRPCがないため未マージ・未デプロイ**。
- [`46_h12_share_token_rollback_probe.sql`](46_h12_share_token_rollback_probe.sql)はStageのイベント0件・公式イベント0件を確認した後、**合成通常イベント2件（共有有効/無効）、合成公式イベント1件、通常参加者4件・試合1件・得点4-2・公式試合1件・得点4-2**を単一トランザクションだけに作成。SET LOCAL ROLE anonで**正規tokenの通常/公式結果・スコア取得、無効token・共有OFF・種類違い・未対応kindの非返却、匿名基底表の取得拒否**の8真偽値全てtrueを確認し、最後に**ROLLBACK**。実データ/試合/戦績を保存・変更していない。**これはDBロール模擬であり本当のHTTP通信の正例ではない**。
- [`47_h12_no_header_anon_acl_probe.sql`](47_h12_no_header_anon_acl_probe.sql)をStage/Prodの**同一SQL**で`BEGIN READ ONLY`、`request.headers={}`、`SET LOCAL ROLE anon`で実行：Stageは`events/official_events/official_opponents/official_matches`全て**42501で直接拒否＝仕様どおり拒否PASS**。本番は通常`events`0件表示だが、**official_events 1件、official_opponents 4件、official_matches 12件をトークンなしで参照できる**ことを確認。後者は「リンクを知る人だけ共有」の想定に反するなら**プライバシー・セキュリティリスク（未修正）**。本番の公開権限をこの段階で変更していない。
- Stageの既存B0 Auth HTTPスクリプト`08_staging_auth_http_smoke.mjs`に**匿名の無効トークン2件（友好/公式）、匿名基底表直接アクセス拒否2件**を恒常回帰として追加。実HTTP [GitHub Actions #44515044820](https://github.com/g-ambe/Padel-match/actions/runs/44515044820) で**既存16+新H12 4＝20/20 PASS**（無効tokenはHTTP200/null、直接SELECTは401/42501）。本物の正規共有token HTTPはStageに永続のイベントfixtureがなく**未実施**。
- 公式共有ページの変更は一時的なread-only CIで[GitHub Actions #44514563412](https://github.com/g-ambe/Padel-match/actions/runs/44514563412) の**TypeScript`tsc --noEmit`＋共有関連unit tests**がPASS。終了後、CIの一時チェック手順は削除し、恒常B0は読み取り専用のまま。**未配信**。

### H14：本番データの整合性READ ONLY検査

- [`48_h14_history_integrity_readonly.sql`](48_h14_history_integrity_readonly.sql)をStage/Prodに同じREAD ONLY SQLで実行。各試合行・参加者・本人UUIDやトークンを取得せず**件数のみ**返す。
- 本番集計：`events`89件、`matches`498件、`match_results`329件、`official_matches`15件。孤立した試合結果0、同一match重複結果0、completedなのに結果なし0、未完了matchの結果0、match_playersとevent_participantsのイベント不一致0、無効参照profile0。公式match孤立/負数/確定勝敗なのに得点欠落はいずれも0。
- **要確認の既存記録**：友好試合の**負のスコア1件（6対-1、winner A）**、**同点で勝者がdraw以外5件（いずれも2対2、winner B）**。終了済み自動イベントの記録。GP/旧得点仕様の手動勝敗指定、歴史的データの条件を確認してから仕様適合を判定する。**結果を不正・破損と確定せず、自動修正しない**。
- 本番では非activeのclub_membersは2件、そのうち**1件が過去イベント参加に紐づく**。現在の在籍状態だけを理由に過去戦績を削除してはならない。Stageは本物のevents/matches/results/official_matchesが**0件**なので、Stageの孤立・破損0という値は本番戦績の完全性を証明しない。
- H14は今後、実イベント/退会者を参照する画面・ランキングの集計規則とイベント単位の所属境界、共有との交差、戦績不変性を本番と同等のfixture/安全なread-onlyケースで確認するまで**未完了**。全履歴の自動修復・手動書換えはしない。

### 残件の見取り図（作業時間ではなく工程）

1. **H12の残り**：通常・チーム混合結果の共有DTO/画面一致、公式と通常の本物の正規共有token HTTP正例、本番での匿名公式データ無token閲覧経路の遮断方針、本番導入前のRPC互換/テスト
2. **H14の残り**：旧GP/スコア例外6件の仕様照合、過去結果・ランキングと退会者の保持、他グループの参照権限・回帰テスト
3. **TASK-08-03の未完了コア仕様**：グループ内独立表示名、本人自主退会とオーナー承諾付き引継ぎ、同一グループ在籍者限定の画像閲覧、グループ詳細3タブ・POP/戻り導線（要件のどこまでが別工程かIssueと整理）
4. **DB/本番互換**：StageとProdのRLS/GRANT、旧RPC、未移行11表・共有関数差を列挙し、最小単位で別途適用判断（本番データ無変更）
5. **最終受入・リリース準備**：H01〜H14の不足正負例、実画面・Auth/JWT・Cloudflare互換、Tutorial/ヘルプ同期、本番適用前レビュー。PR #265 Draft維持、Issue #264 OPEN。別Issueのメール招待#262、英数字ID#263はこの残数に含めない。

**注意：5領域は概算の作業分類であり、完了までの時間見積ではない。H12/H14はこの時点で完了判定せず、本番適用/デプロイ/マージ禁止。**

## 0.12. 2026-11-19：H09最後のメイン管理者保護・H10本人限定プロフィール保存と実JWT HTTP全PASS

**ステージング限定の段階的な対策。** Stage Migration **52→53件**、本番SQL/Cloudflare/マージ/デプロイなし。判定は「正常許可・PASS」「仕様どおり拒否・PASS」「想定外の許可・FAIL」「想定外の拒否・FAIL」「未確認」で区分し、HTTP200・更新0件は正常な更新と混同しない。

### H09：最後のメイン管理者をDBで保護

- 現行画面の更新は[`lib/player-profiles.ts`](../../../lib/player-profiles.ts)の`setClubMemberActive`/`saveClubMemberRole`で、`club_members`の`role/is_active`を列単位UPDATEし、`id,club_id,player_profile_id,role,is_active`を`RETURNING`で確認。ステージングではこれらの列UPDATE/SELECTは可能、`profile_id/player_profile_id`の列UPDATEは拒否。
- [`38_h09_members_update_returning_rollback_probe.sql`](38_h09_members_update_returning_rollback_probe.sql)で管理者Aによる役職変更・非管理者の欠席/復帰、サブ管理者Bによる一般/サブ変更とメイン変更禁止、別クラブへの変更拒否を実ロール模擬で確認（すべてROLLBACK）。
- **問題を発見：** UIを経由せず、DB API相当の直接UPDATEで**最後のメイン管理者自身の`is_active=false`が許可された**。RLSの`can_edit_player_profile_member`だけでは最後の1人の保護がない。これは「メイン管理者は最低1人必要」という確定仕様に反する**想定外の許可・FAIL**。
- [`39_h09_last_main_guard_rollback_candidate.sql`](39_h09_last_main_guard_rollback_candidate.sql)で、`club_members`の`role/is_active/status/club_id`更新に対するBEFORE UPDATEトリガー候補を作成。`main_admin`在籍者が退会・降格・ステータス変更される場合、**対象グループ行を`FOR UPDATE`で直列化し、別のactive mainがいなければ42501で停止**。一般/サブメンバーや別main引継ぎ後の変更は妨げない。`security_private`内のSECURITY DEFINER関数はpostgres所有・search_path空・anon/authenticatedの直接EXECUTEをREVOKEし、既存GRANTやRLSは拡大しない。
- [`40_h09_last_main_role_status_rollback_probe.sql`](40_h09_last_main_role_status_rollback_probe.sql)を候補39と組み合わせてROLLBACK試験。単独mainのrole変更/在籍ステータス変更＝**仕様どおり拒否・PASS（42501）**、同グループに他のmainを準備した場合の退会＝**正常許可・PASS**。38との組合せでも管理者/サブの通常UPDATE・RETURNINGは維持。
- [`41_h09_last_main_stage_apply.sql`](41_h09_last_main_stage_apply.sql)をステージングに限りMigration`task08_h09_staging_last_main_departure_guard`として適用、**履歴53件**。実適用後に38/40を単体ROLLBACK再試験し、上記の正負例がすべてPASSであることを再確認。

### H10：本人専用RPCで既存画面の詳細取得・保存を復旧

- 既存画面は自己紹介/レベル/利き手/ポジション/活動エリア/表示名の6項目を保存する。旧`fetchLinkedPlayerProfiles`と`saveLinkedPlayerProfile`は**直接`player_profiles`をSELECT/PATCH・RETURNING**するため、ステージングで詳細列のSELECT/UPDATE権限が不足していた（`bio/play_level/dominant_hand/preferred_position/activity_area`のauthenticated SELECT/UPDATEはfalse）。これは画面の期待する取得/保存と権限に不一致。
- **広い列GRANTは付与しない。** `security_private.can_read_player(id)`は本人だけでなく同一グループ在籍者・同イベント閲覧者を許すため、詳細列を`authenticated`に一律GRANTすると他人の詳細を漏らすリスクがある。
- 現存する**本人限定のRPC**を監査：`public.get_my_player_profiles()` → `security_private.my_players()`（本人`auth.uid`に紐づくactive選手のみ）、`public.save_my_player_profile(uuid,jsonb,jsonb)` → `security_private.save_my_player`（本人リンク・許可6項目・expectedスナップショットに基づく競合保護・更新後の行返却）。両方とも既存の認証済みEXECUTEあり。
- [`42_h10_owner_profile_rpc_rollback_probe.sql`](42_h10_owner_profile_rpc_rollback_probe.sql)で、本人詳細取得/6列更新と返却、古いフォームの期待値拒否、他アカウントからの保存拒否、認証ID書換え拒否、管理者の未連携選手表示名変更成功、非所属者の更新拒否、直接`bio`取得42501を**全8判定ROLLBACKで確認**。
- [`lib/player-profiles.ts`](../../../lib/player-profiles.ts)の**プロフィール本人の読込/保存関数だけ**を既存RPC経由に切替。取得後は`linked_auth_user_id`と本人uidの一致を必須検証。保存時は既存RPCが期待値比較・項目制限・本人確認を一括処理し、返却後にも本人RPCで再読込して保存一致を確認する。アプリ画面UI/ラベル/他の権限は変更していない。未連携仮選手名の管理者編集は現行の限定列PATCHを維持。
- **H10のDB Migrationなし**。全ログイン利用者への`player_profiles`詳細列SELECT/UPDATEは引き続きfalse、本人用RPCだけで更新可能。

### 実Auth/JWT・TypeScript・専用fixture

- [`43_h09_h10_stage_http_fixture_setup.sql`](43_h09_h10_stage_http_fixture_setup.sql)で、ステージングに**一時的な非公開テスト用クラブ1・未連携選手1・所属3（mainA main、outsider sub、未連携member）**だけ作成。既存A/Bの所属やプロフィールを変更せず、一般ユーザーの本物のデータも使わない。所有者・Auth ID・合成名の事前条件を厳格に確認。
- 初回[GitHub Actions #44509830613](https://github.com/g-ambe/Padel-match/actions/runs/44509830613)では、既存B0認証・名簿16件、Node構文、TypeScript/プロフィール画面の関連試験は成功。ただし専用H09/H10試験が**テスト前提の`clubs.owner_id`取得をHTTP403/42501で拒否**されたため`BLOCKED`。これは`owner_id`を通常ユーザーへ公開しない設計が適用されたものであり、アプリのグループ更新機能のFAILと取り違えない。DB側でowner本人を事前検証済みのため、スクリプトだけを非公開列不要な`id,name,visibility`取得へ修正。GRANT/RLSは変更していない。
- 2回目の[GitHub Actions #44510146124](https://github.com/g-ambe/Padel-match/actions/runs/44510146124)は**B0既存16/16 PASS＋専用実JWT/HTTP [`45_h09_h10_stage_http_write_smoke.mjs`](45_h09_h10_stage_http_write_smoke.mjs) 18/18 PASS**。さらにNode構文、`bun x tsc --noEmit`（TypeScript）と`node --test tests/profile-v4.test.cjs`が成功。
- H09 HTTP：mainのrole変更、subの非main変更、mainの非main休止/復帰は**HTTP200・UPDATE/RETURNING 1行＝正常許可PASS**。sub→mainと他クラブへの操作は**HTTP200・UPDATE 0行＝RLSの仕様どおり拒否PASS**（HTTP200でも操作成功ではない）。最後のmain退会・降格は**HTTP403/42501＝仕様どおり拒否PASS**。
- H10 HTTP：`get_my_player_profiles`はHTTP200で本人の詳細のみ。既存`save_my_player_profile`で**変更値が全て元と同一のno-op保存**を使い本人とRETURNINGを検証（本物の個人プロフィール内容は変更しない）。古い期待値／他人の編集／認証ID書換えは**HTTP400/P0001＝仕様どおり拒否PASS**。通常テーブル詳細SELECTは403/42501（本人用RPCだけを利用）、管理者によるテスト専用未連携選手名更新/復元はHTTP200で各1件、非所属者はHTTP200/0行で仕様どおり拒否PASS。
- 直後に[`44_h09_h10_stage_http_fixture_cleanup.sql`](44_h09_h10_stage_http_fixture_cleanup.sql)で、関連する全FK子参照・所属3件のAuth・テスト用player/clubの組み合わせを照合してから**テストクラブ1/未連携player1/関連所属3件のみ回収**。残存0。既存所属8、従来A/Bテスト所属4、A/Bに共通の仮選手2所属は変化なし。検証用join/link申請0、active merge0。
- 専用の**H09/H10書き込み試験ステップはGitHub Actionsから削除**し、workflowを再び読み取り専用のB0へ戻している。パスワード・JWT・実UID・個人プロフィール内容はGitHubログ/PR/Issueへ出力しない。

### 現時点の停止条件・次の作業

- Stage `padel-hub-staging`：**ACTIVE_HEALTHY、Migration 53件**。H09トリガー有効、SECDEF関数を匿名・認証済みが直接EXECUTE不可。H10詳細列の幅広いGRANTなし、本人限定RPCは使用可能。
- 本番`padel-hub`：**ACTIVE_HEALTHY、未変更**。本番とステージングの旧SELECT/RLS/関数差・不足11表が残り、ステージングの成功を本番へ無条件展開しない。PR #265はDraft、Issue #264はOPEN、マージ/デプロイを行わない。
- **未完了**：H12の匿名共有tokenの閲覧境界、H14既存の試合/結果/ランキング履歴の不変性、全イベント/権限/複数actorの高並列性、本番との差分解消と最終移行。本タスクIssueで確定した**グループごと独立した表示名**や詳細3タブ等の全面実装はこのH09/H10で完成していない。現在の未連携選手名変更は従来どおり共有playerプロフィール名の操作なので、グループ専用別名モデルは別工程で要実装。
- **次の作業予定**：H12共有イベントの公開tokenと閲覧可能な名前/スコアの範囲をREAD ONLYで調査し、匿名REST経由の正負例を準備。続いてH14の試合/戦績の整合性・非所属者の閲覧漏洩を調査する。必要ならStageだけに最小変更し、必ずROLLBACK→実HTTP→fixture回収→ドキュメント更新の順で進める。

## 0.11. 2026-11-19：H08本人承認と管理者承認の別経路をステージングで閉鎖／H09・H10の読取監査

**今回のステージング限定対策。** H13の並列JWTテスト後、H08のレビュー処理2経路を再現・保護した。拒否の分類は「**仕様どおり拒否・PASS**」「**想定外の拒否・FAIL**」「**想定外の許可・FAIL**」「**未確認**」の4種類で統一する。旧コードが動作していただけでは正しい仕様とは判定しない。

### H08-1：申請先本人による`review_player_profile_link`

- 既存の`scoped_preview`は申請対象グループAの所属**1件のみ**表示するが、レビューtokenは`profile_link_private.preview`の全体snapshotに由来する。元の仮選手がA/Bに**2件所属**している場合、`review_player_profile_link(...,'approved',token)`が`merge_profiles`を呼びA/B両方の所属を移していた。[`25_h08_scoped_consent_cross_club_rollback_probe.sql`](25_h08_scoped_consent_cross_club_rollback_probe.sql)で**想定外の許可・FAIL**をROLLBACK再現（データ永続変更なし）。
- [`26_h08_cross_club_approval_guard_rollback_candidate.sql`](26_h08_cross_club_approval_guard_rollback_candidate.sql)で、申請対象以外のグループ所属/参加履歴/加入申請/チーム戦/公式戦が統合で変更され得る場合に権限エラー42501で停止する候補を作成。A/B複数所属の承認は**仕様どおり拒否・PASS**、別途[`27_h08_single_group_approval_rollback_probe.sql`](27_h08_single_group_approval_rollback_probe.sql)の単一A所属では承認・統合が正常成功することをROLLBACKで確認。
- Stage Migration `task08_h08_staging_block_hidden_cross_club_merges`として[`28_h08_staging_consent_scope_guard_apply.sql`](28_h08_staging_consent_scope_guard_apply.sql)のみ**ステージングへ適用**。改変は対象レビュー関数のみでGRANT/RLSを拡張しない。
- 正規Auth/JWT [GitHub Actions #44501997672](https://github.com/g-ambe/Padel-match/actions/runs/44501997672) は**19判定PASS**。本人のAのみ詳細previewはHTTP200、A/B全体を見せずに承認する操作はHTTP403/42501で**仕様どおり拒否・PASS**、申請statusはpendingのまま。保護対象のA/B所属とプロフィールの変更はなし。一時的なリンク申請**1件・関連通知1件**は照合後に削除。試験フラグも解除。

### H08-2：公開グループの本人申請を管理者が承認する`review_profile_join_request`

- **別の未保護経路を確認**。`preview_public_club_claim`はAのみを表示し、`submit_public_club_claim`が全snapshot付きの同意を作る。元の`review_profile_join_request(...,'approved')`は別の`merge_profiles`呼出しから、A/B両方を統合していた。[`31_h08_join_approval_cross_club_rollback_probe.sql`](31_h08_join_approval_cross_club_rollback_probe.sql)で**想定外の許可・FAIL**をROLLBACK再現。
- [`32_h08_join_manager_approval_guard_rollback_candidate.sql`](32_h08_join_manager_approval_guard_rollback_candidate.sql)で管理者承認の別経路にも同じ「表示外の所属/履歴が書き換わる場合は42501拒否」のチェックを追加。A/Bは**仕様どおり拒否・PASS**、[`33_h08_join_single_club_positive_rollback_probe.sql`](33_h08_join_single_club_positive_rollback_probe.sql)によるAのみの正当な加入同意・管理者承認は**正常許可・PASS**。いずれも同一transaction ROLLBACK。
- Stage Migration `task08_h08_stage_block_hidden_join_manager_merge`として[`34_h08_join_manager_stage_guard_apply.sql`](34_h08_join_manager_stage_guard_apply.sql)を**ステージングだけに適用**。再度元の[`31`](31_h08_join_approval_cross_club_rollback_probe.sql)/[`33`](33_h08_join_single_club_positive_rollback_probe.sql)をROLLBACK実行して結果不変を確認。
- `35_h08_join_manager_http_fixture_setup.sql`で、既存のテスト専用仮選手U（A/B所属2件）と`outsider`に限定したpending加入申請**1件・関連通知2件**を作成。実Auth/JWT [GitHub Actions #44504198179](https://github.com/g-ambe/Padel-match/actions/runs/44504198179) は**18判定PASS**。管理者の`review_profile_join_request(...,'approved')`はHTTP403/42501＝**仕様どおり拒否・PASS**、申請はpendingのまま。正規ログインや従来のB0負例16件もPASS。
- 試験用申請/通知は[`36_h08_join_manager_http_fixture_cleanup.sql`](36_h08_join_manager_http_fixture_cleanup.sql)によりID/グループ/本人同意/未承認/統合なしの照合後、**pending加入申請1件＋通知2件を限定削除**。最初のcleanup SQLはPL/pgSQLローカル`club_id`名が曖昧で実行失敗し、transactionはROLLBACK。変数名を`v_club_id`に限定修正して再実行成功。cleanup専用フラグはGitHub Actionsから解除済み。

### H09/H10 UPDATE ... RETURNINGの読み取り専用監査

- [`37_h09_h10_update_returning_acl_preflight.sql`](37_h09_h10_update_returning_acl_preflight.sql)を**GitHub上の実ファイルから両DBへ同一SQL**で実行。すべて`BEGIN READ ONLY`、書き込みなし。RLS predicate全文/行データは公開せず名前とMD5で差分照合。
- Stage/prodどちらも`club_members`/ `player_profiles`にUPDATE用RLS policyは存在し、対象2表の`authenticated`表全体UPDATE権限はfalseだが**列単位UPDATE権限あり**。表UPDATE=falseを「全更新不可」と誤解しない。
- `club_members`：`role/is_active/status`は両環境で`authenticated`列UPDATE=true。`profile_id/player_profile_id`は列UPDATE=false。Stageでは`authenticated SELECT`は表全体trueだが対象グループ限定RLS、prodは匿名SELECT可能でRLSに差があるため**本番公開は未対策**。
- `player_profiles`：両環境で`display_name`の列UPDATE=true、`linked_auth_user_id`はfalse。**Stageの`bio/play_level`列UPDATEと列SELECTはfalse**、prodはtrue。Stageでは`authenticated`表全体SELECT=false（表示名等の列SELECTはtrue）、prodは表SELECT=trueで匿名SELECTも可能。したがって本人詳細のPATCH/RETURNING互換を未確認のまま「PASS」としない。
- **H09/H10とも本物のJWT PATCH + `Prefer: return=representation`の正/負例は未実施**。RLS USING/WITH CHECKと各列GRANT、既存クライアントの`RETURNING`列を照合してから、既存データを変更しないROLLBACKシナリオ/専用fixtureで追加検証する。本番の公開SELECT/広いGRANTを安易にコピーしない。

### 終了時点のチェック・次に行うこと

- Stage `padel-hub-staging`：**ACTIVE_HEALTHY、Migration 52件**（H13 50件＋H08本人側51件＋H08管理者側52件）。既存所属8件、A/Bテスト所属4件、元のA/B仮選手はactive・未連携で2グループ所属のまま。H13一時クラブ0件、pending加入/リンク申請0件、active merge0件。H03旧View匿名SELECT/旧H06・旧直接加入申請EXECUTEの閉鎖は維持。
- **本番DB・Cloudflare本番・PRマージ/デプロイは未変更**。Draft PR #265とIssue #264はOPENを維持する。
- **次の作業予定：** H09/H10の既存画面が要求するPATCH/RETURNING列とRLS/列GRANTを確認し、Stage専用の正例と仕様どおりの拒否負例を構築。その後H12共有（匿名共有token境界）、H14戦績・参照整合の隔離試験。複数グループをまたぐ本人連携は、本人が全対象と影響を確認できる新しい同意/権限設計ができるまで**安全側で承認停止**。一律「完全に実装済み」とは扱わない。

## 0.10. 2026-11-19：H13初期グループ・管理者INSERTの最小権限適用と正規JWT並列試験

本節以降、「拒否」と書く場合は**(A) 仕様どおりの拒否・PASS（既存実装/セキュリティ要件が拒否すべきもの）／(B) 想定外の拒否・FAIL（正当な処理ができない不具合）／(C) 想定外の許可・FAIL（不正な処理が成功する不具合）／(D) 未確認**に明確に分類する。単にHTTPエラーとなったことをPASSと呼ばず、対象actor・許可条件・実SQLトリガー/RLSと照合する。

### H13をステージングへ最小権限で適用

- 既存[`19_h13_initial_owner_insert_rollback_candidate.sql`](19_h13_initial_owner_insert_rollback_candidate.sql)の正例/負例を再利用し、[`22_h13_staging_owner_insert_apply.sql`](22_h13_staging_owner_insert_apply.sql)に**ステージング固定fixture、元のINSERT policy 0件、本人既存所属8件、所有者postgres**等の検査を追加。**本番DBへの適用は禁止**。
- ステージングで`task08_h13_staging_owner_bootstrap_insert`として適用。Migration履歴49→**50件**。次の列への`authenticated INSERT`だけを許可：`clubs(name,description,owner_id,is_active,visibility)`と`club_members(club_id,profile_id,player_profile_id,role,is_active)`。匿名INSERT/非対象列INSERTの広範な権限は追加していない。
- clubs INSERTは`owner_id=auth.uid()`かつactive/非削除だけを許可。club_members INSERTは本人が作ったクラブ・本人のaccount profile・本人にAuth連携済みのactive選手・`main_admin`・active・`status=active`・**まだ初期所属が存在しないクラブ**の組合せのみ。private `security_private.task08_initial_owner_member_allowed`関数において、対象クラブ行を`SELECT ... FOR UPDATE`でロックした後に既存所属を再確認する。SECURITY DEFINERはpostgres所有、search_path空、anon EXECUTE禁止、authには最小のEXECUTEのみ。
- この変更は「グループ作成→所属作成」という**既存UIの2段階HTTPフローを維持**するものであり、途中で登録が失敗した場合のクラブ孤立をすべて解消する原子的な変更ではない。既存UIのエラー表示・再作成禁止は維持、独自の新UIは追加していない。

### 実Auth + PostgREST HTTP（独立2リクエストの並列性を含む）

- [`23_h13_staging_http_write_smoke.mjs`](23_h13_staging_http_write_smoke.mjs)をステージングURL固定・専用`main-A`と`recipient`のみのログインで実行。**事前にテスト専用クラブ不存在を確認**し、合成クラブ名`TASK08-H13-HTTP-20261119-SINGLE/RACE`だけを作成。パスワード/JWT/内部UUID/個人データの出力なし。
- [GitHub Actions run #44498384116](https://github.com/g-ambe/Padel-match/actions/runs/44498384116) のworkflowとログを直接検査。通常の**読み取り専用B0：16 PASS**、追加の**H13実JWT試験：10 PASS／FAIL・BLOCKED 0**。2件のmain_admin同時挿入はJS`Promise.all`で別HTTPリクエストとして並列送信し、**1件201成功・1件403/42501拒否、保存は1件**。
- HTTP負例の拒否は、既存RLSとトリガーに照らし、すべて**「仕様どおりの拒否・PASS」**。HTTP 400/403だけで判断せず、根拠を以下に記載：

| テスト | HTTP/DB結果 | 判定 | 仕様・実装根拠 |
| --- | --- | --- | --- |
| H13_AUTH | main-Aとrecipient双方のログイン成功 | 正常成功 PASS | Authユーザー本人の接続 |
| H13_CREATE | main-Aがownerでprivateクラブを201作成 | 正常成功 PASS | `clubs`の自分ownerのみINSERT可能 |
| H13_ROLE | 初期role=memberを403/42501で拒否 | **仕様どおり拒否 PASS** | 初期所属はmain_admin固定 |
| H13_PLAYER_MISMATCH | 本人account＋他人のlinked player IDを400/P0001で拒否 | **仕様どおり拒否 PASS** | 既存`profile_link_private.guard_reference`の連携整合チェックと新policy |
| H13_BOOTSTRAP | 本人main_adminを201で登録 | 正常成功 PASS | owner本人・選手本人・初期一名だけ許可 |
| H13_DUPLICATE | 同じmain_adminの追加を403/42501で拒否 | **仕様どおり拒否 PASS** | 新policyは同クラブ既存所属がある場合INSERT不可 |
| H13_OTHER_ACTOR | recipientによるAクラブ初期main_admin登録を403/42501で拒否 | **仕様どおり拒否 PASS** | owner不一致、新SECDEF判定 |
| H13_BOOTSTRAP_COUNT | Aクラブ所属を1件だけ確認 | 正常成功 PASS | 役職/所属行の不変性 |
| H13_RACE_CREATE | 別の空クラブを201作成 | 正常成功 PASS | テスト専用のownerクラブ |
| H13_CONCURRENT | main-Aが同クラブへ同時2件INSERT→201×1、403/42501×1、DB所属1件 | **仕様どおり1件拒否 PASS** | クラブ行ロック＋既存所属検査の実挙動 |

- この並列検証は**1回の本物のAuth/PostgREST同時2リクエスト**であり、負荷試験、複数DB分離レベル、トランザクション障害復旧、異なるプロフィールの高並列性を網羅するものではない。すべてのレース条件への保証ではない。

### テストfixtureの限定削除と書き込みジョブの撤去

- 実HTTP後、Stage READ ONLYでテストクラブ2・専用所属2、その他既存所属8、想定外の子レコード0を確認。
- [`24_h13_stage_http_fixture_cleanup.sql`](24_h13_stage_http_fixture_cleanup.sql)でクラブ名・owner本人・選手のAuth連携・役職・同クラブの子FKを**個別に確認**し、当該テストクラブ2件/所属2件のみ削除。先に関連する他の試合・通知・申請・連携統合等が存在すれば削除を停止する安全ガードつき。専用公開directory_refsはFK連鎖の範囲内のみ。既存クラブ/プロフィール/試合/他所属は削除なし。
- cleanup結果：**専用クラブ2・専用所属2回収、残存0**。完了後にGitHub Actionsの**H13書き込み試験ステップ自体を削除**し、ワークフローを元の読み取り専用B0スモークに復帰。Secretsの値は閲覧/保存していない。
- READ ONLYの最終確認：`ACTIVE_HEALTHY`、Migration**50件**、元の既存所属**8件**、既存のgroup-A/B検証所属**4件**、一時H13クラブ**0**、pending加入/リンク申請**0**、新INSERT policyは**2つのみ**。旧H03/H06/submit公開経路の閉鎖は維持。本番DBとCloudflareは未変更。

### 未完了／次ゲート

- **H13の「同時2要求で重複0」まではステージングで確認済み**。ただし、本番同等のDDL/アプリ動作・二段階HTTP途中失敗時の復旧、特異な隔離レベル・複数actor/高並列時の不変性は要継続。
- H08の本人最終承認/統合は、既存A/Bの複数所属の参照と履歴を変更し得る。十分な隔離fixtureと**既定ROLLBACK**のSQL正負例・FK/戦績不変を最初に検証し、承認を無条件COMMITしない。H09/H10の更新RETURNING、H12共有、H14既存試合/戦績も未完了。
- 本番はステージングとRLS/ACL・旧関数MD5が異なるため、Stageでの成功を本番へ無条件展開しない。**PR #265 Draft、Issue #264 OPEN。新ブランチ・新PR、main merge、本番SQL/Cloudflareデプロイは禁止。**

## 0.9. 2026-11-19：旧加入申請・連携詳細/一覧の最小化とH13初期登録の隔離試験

**ステージング `padel-hub-staging` のみに実施。本番・デプロイ・マージなし。** 前節のH03/H06対策は保持。今回のステージング履歴は**46件→49件**、現在`ACTIVE_HEALTHY`。新しいブランチ/PRは作成していない。

### 旧加入申請RPCの直接EXECUTEを閉鎖

- `submit_profile_join_request(uuid,uuid,text,text)`は、内部所属IDを引数に取る旧RPC。既存アプリの公開グループ加入導線は、公開参照を検証する`submit_public_club_claim`を利用。内部呼び出し先はSECURITY DEFINERで維持できる。
- [`14_legacy_join_submit_acl_rollback_probe.sql`](14_legacy_join_submit_acl_rollback_probe.sql)を実ステージングでROLLBACK検証。旧RPC直接拒否、無効な同意token拒否、**正しい公開参照+本人tokenで新ラッパー経由の加入申請・同意snapshot生成が成功**し、申請/通知は保存されないことを確認。最初の試験SQLは認証済みロールで非公開申請表をSELECTしようとして失敗、検証照会だけpostgresへ戻して再実行成功。RLS/GRANTを緩めて対処していない。
- [`15_legacy_join_submit_staging_apply.sql`](15_legacy_join_submit_staging_apply.sql)をステージング限定で適用（履歴`task08_legacy_join_submit_acl_staging`）。**PUBLIC/anon/authenticatedの旧関数直接EXECUTEのみREVOKE**。新`submit_public_club_claim`の認証EXECUTEと旧関数のSECURITY DEFINER内部呼出しは維持。
- ステージング固定のB0 HTTPスモークに、無効tokenしか送らない`LEGACY_SUBMIT_DIRECT`負例を追加。正規Auth JWT HTTP [run #44490847281](https://github.com/g-ambe/Padel-match/actions/runs/44490847281)で**16判定すべてPASS**、旧直接呼出し403/42501・申請作成なし。これはH08本人承認の全面試験ではない。

### 旧連携詳細RPCの管理者DTO限定と一時fixtureの安全な回収

- 以前の本番用`03_link_detail_candidate.sql`は変更せず、ステージング固有`scoped_preview`を守る`06_staging_link_detail_candidate.sql`を再ROLLBACK試験。管理者用10キー限定／他グループBの非返却、申請先本人のpreviewとreview_token不変、無関係者拒否を確認。
- [`16_link_detail_staging_apply.sql`](16_link_detail_staging_apply.sql)をガード付きで**ステージングだけに適用**（履歴`task08_staging_link_detail_minimal_dto`）。旧関数`get_player_profile_link_request(uuid)`を管理者用の最小DTOに置換、受取人には従来の`scoped_preview`同意内容を維持。既存EXECUTE/ACL/RLSは変更していない。
- 実HTTP検証は、一時的なテスト専用リンク申請1件＋正常通知1件を[`17_link_detail_staging_http_fixture_setup.sql`](17_link_detail_staging_http_fixture_setup.sql)でステージングにだけ作成。対象は固定識別名`TASK08-P0-20261119-A`の仮選手U、申請者main-A、受取人recipient。パスワード・token・内部UUIDはGitHub/Issueへ出力しない。
- [run #44492138197](https://github.com/g-ambe/Padel-match/actions/runs/44492138197)：**20判定＝19 PASS/1未解消観測**。管理者詳細HTTP200・許可10キーのみ、受取人の同意preview/token一致、outsider詳細拒否。残る1観測は管理者向け一覧`list_player_profile_link_requests`に`target_auth_user_id`と`source_player_profile_id`が返ること。
- テスト後は[`18_link_detail_staging_http_fixture_cleanup.sql`](18_link_detail_staging_http_fixture_cleanup.sql)で**当該1件の申請とその通知1件だけ**を照合して削除。一般プロフィール/club/所属、別通知、Authユーザーは保持。ワークフローの一時的な詳細テストフラグを解除。

### 一覧RPCの不要な認証IDを削除（画面の申請中表示は維持）

- 現行UI`app/groups/[id]/page.tsx`では、管理者の連携申請一覧にある`source_player_profile_id`を、メンバー行の「申請中」表示と結びつけている。一方、`target_auth_user_id`は現行画面で使われていない。
- [`20_link_list_target_id_rollback_probe.sql`](20_link_list_target_id_rollback_probe.sql)により、管理者・受取人の両一覧から**target_auth_user_idだけを除外**し、本人の指定/管理者一覧の閲覧条件・source_player_profile_id・status/表示名を維持できることをROLLBACK検証。outsiderの他クラブ一覧は0件。
- [`21_link_list_minimal_staging_apply.sql`](21_link_list_minimal_staging_apply.sql)をステージング限定で適用（履歴`task08_staging_minimal_link_request_list`）。既存関数所有者・現物ハッシュ照合あり、ACL/RLSは不変。`lib/profile-links.ts`の型から不要な認証IDを除き、UI機能は変更しない。
- 同じステージングの専用fixtureを1回だけ再作成し、[run #44494344175](https://github.com/g-ambe/Padel-match/actions/runs/44494344175)の実Auth JWT＋PostgRESTで**21判定すべてPASS**。管理者一覧と受取人一覧にtarget認証IDを含めず、管理者には必要な同クラブsource選手IDを維持。連携詳細3役、旧RPC/H03/H06を含む既存負例もPASS。HTTP試験後、専用cleanupで申請1件/通知1件を削除。B0 workflowの一時的なリンク詳細検証フラグを再び解除した。
- **source_player_profile_idは管理者が既存グループ内メンバーと突合するため現時点では残存**。将来の全内部ID非公開化とは別のUI/DTO変更に分割し、ここではユーザーに見える機能を変更しない。

### H13：初期メイン管理者登録は候補のみ（ステージング未適用）

- 実DB読取監査で、ステージングは`clubs`も`club_members`もauthenticatedの**INSERT表/列GRANTが0、INSERT RLS policyも0**。対して本番は両表にINSERT権限と所有者ベースのINSERT policyがある。以前の「club_membersだけ欠落」という説明は不十分だった。現行画面`app/groups/new/page.tsx`は`clubs INSERT ... RETURNING id`→`club_members INSERT(main_admin)`の二段階。
- [`19_h13_initial_owner_insert_rollback_candidate.sql`](19_h13_initial_owner_insert_rollback_candidate.sql)を**ROLLBACK専用**で作成。ステージングの既存ACL/RLSは永続変更せず、トランザクション内だけで限定列INSERT GRANT、`owner_id=auth.uid()`限定のclubs INSERT policy、およびSECURITY DEFINER判定関数を経由した**本人/本人に連携済みの選手ID/main_admin/最初の所属のみ**のclub_members INSERT policyを試す。本人以外のowner、誤役職、別選手ID、二重self、別アカウントによる登録は拒否。
- 既存`guard_club_owner`と`guard_reference`トリガーの負例が`P0001`を返すため、試験SQLは権限を緩めずに期待する拒否を識別するよう修正。**現物の正例/負例はすべて成功**：本人クラブ作成1、本人main所属1、その他5種拒否。
- 初期登録の競合を意識し、判定関数に**ownerクラブ行`FOR UPDATE`ロック**を追加して再ROLLBACK。7判定すべて成功（owner1/main1/5拒否）。ただし**実際の2接続同時実行・JWT HTTPでの作成/回収・既存契約の広範な互換試験は未実施**。この候補をステージングに確定適用せず、`clubs`/`club_members`の現行INSERT拒否を維持。**本番の旧INSERT policyを丸ごとコピーしない**。
- H13候補は正式Migrationに昇格していない。特に複数同時操作・ロック待機・途中失敗後の孤立club/復旧・複数回操作の不変性・owner変更トリガーを別検証する。必要な権限を一括GRANTせず列単位に限定したまま判断する。

### 終了時点と次の停止条件

- **ステージングMigration 49件、稼働状態`ACTIVE_HEALTHY`。** 既存所属8件＋専用fixture所属4件は維持。検証用の連携申請・通常加入申請ともに0件、一時H13クラブ0件、H13専用INSERT policy 0件。`clubs`/`club_members`のauthenticated INSERTは引き続き拒否。
- **未完了**：H13の真の同時実行・実JWT HTTP/復旧、本番とステージングの広範なRLS/ACL差、旧公開基底表SELECT、H08本人レビュー・統合、H09/H10更新系、H12共有、H14試合/戦績の不変性。H01〜H14全体の完了と判断しない。
- **本番DB／Cloudflare／PRマージ・デプロイは未変更**。従来`03`本番候補は既定ROLLBACKのまま。PR #265 Draft、Issue #264 OPENを維持。

## 0.8. 2026-11-19：H03旧Viewの直接SELECT閉鎖・H06/H03実HTTP全15判定PASS

**実施対象は既存ステージング `padel-hub-staging` のみ。H03とH06の公開経路を両方閉じ、正規Auth + PostgREST HTTPで検証した。本番DBへの適用・本番デプロイ・マージは一切していない。**

### H03の調査・最小適用

- ステージングの`public.public_player_profiles`は`postgres`所有の`security_barrier=true` View（`security_invoker`未設定）。本番に同名Viewはない。現物ViewはactiveかつAuth連携済みの`player_profiles.id/display_name`、`profiles.avatar_url`を返す。旧anon/authenticated SELECTが両方付与されており、合成fixtureの連携済み選手名3件が匿名HTTPから取得可能だった。View定義MD5：`42f906073d724e0636cbd0e4e1c7b909`。
- GitHub既存ブランチの`app/`37、`lib/`52、`components/`47、計**136ソースファイル**を調査し、`public_player_profiles`への直接参照がないことを確認。ステージングのpublic/profile_link_private/group_read_privateの関数定義内にも同View名参照はなかった。**旧外部クライアント・今後の仕様まで非依存という証明ではない**。
- 新規`12_h03_public_player_profiles_view_acl_candidate.sql`は既定ROLLBACK。元Viewのowner/MD5/ステージングfixtureと現行SELECT ACLを照合し、Viewを削除・改変せず`PUBLIC/anon/authenticated`への`REVOKE SELECT`だけを試す。
- 現物の同一トランザクション試験：従来のSQL匿名ロールで合成3件→ACLを一時閉鎖するとanon/authenticatedとも**SQLSTATE42501**で拒否。新限定公開名簿`get_public_club_directory`は認証済み利用者へ2件返り、service_roleのView SELECTも維持。**ROLLBACK**で元に戻してから確定適用を判断。
- 事前ガードとROLLBACK試験を経て、`13_h03_staging_apply.sql`をSupabaseのDDL管理操作で**ステージングにのみ適用**。Migration履歴名`task08_h03_close_global_profile_view_staging`、ステージング履歴45→46件。View本体の定義/行、RLS、プロフィール本人取得RPC、アプリのUI/ヘルプ/ルーティングは変更しない。anon/authenticatedのView SELECTはfalse、service_roleはtrue、View MD5は不変。

### H06/H03両対策後の正規JWT・HTTP再試験

- `08_staging_auth_http_smoke.mjs`に`TASK08_EXPECT_H03_CLOSED=1`のHTTP401/403・code42501負例条件を追加。前節の`TASK08_EXPECT_H06_CLOSED=1`と併用し、GitHub Actionsの**ステージング専用トリガーファイルだけ**を更新。
- [GitHub Actions run #44487713301](https://github.com/g-ambe/Padel-match/actions/runs/44487713301)、trigger commit `fd8835bbc97c1b15a34d6d5645630a8340433798`。**run/job`completed/success`、ジョブログの15判定すべてPASS、FAIL/BLOCKED/OBSERVEリスクは今回0件**。
- H06：無所属outsiderの旧`preview_profile_join`直接HTTPは**403・42501**、`source`・`review_token`非返却。H06_SAFE：限定公開`preview_public_club_claim`は**200・最小DTO10キーのみ**、レビュー用プレビュー取得を維持。
- H03：匿名`public_player_profiles`へのHTTP SELECTは**401・42501**（行取得なし）。H01ログイン3、H02旧基底SELECT4、H11内部名簿3、H07公開名簿2は引き続きPASS。
- **15判定はH01〜H14の全ケースではない。** 本番とステージングのRLS/関数/不足11表差、旧公開表/列SELECT、未処理のRPC経路、グループ作成後の初期所属INSERT、レビュー・統合などは別ゲートで未完了。H03/H06のclosureだけでP0の完了/PRマージ可とは判定しない。

### 復旧境界・後続作業

- **H06 ACLの戻し方**（安全審査で本当に必要な場合のみ）：`GRANT EXECUTE ON FUNCTION public.preview_profile_join(uuid,uuid) TO authenticated;`。H06リスクを再度公開するため、安易に戻さない。
- **H03 ACLの戻し方**（必要性と公開範囲を確認してから）：`GRANT SELECT ON TABLE public.public_player_profiles TO anon, authenticated;`。これも元のプロフィール公開リスクを再導入するため、原則として戻さず、特定画面用の限定DTOで対応する。
- 両適用はステージング限定の管理SQL（`supabase/maintenance/group-foundation/11_h06_staging_apply.sql`、`13_h03_staging_apply.sql`）。**本番へそのまま適用禁止**。既存の`03`/`06`連携詳細修正候補はROLLBACKのまま、ステージング未適用。
- 今回のステージングの既存所属8件、検証専用所属4件は維持。サービス側Authセッション更新を除き、追加のアプリDB行変更なし。本番データは読み取り検証以外変更なし。
- **次に進む対象**：旧`submit_profile_join_request`直接EXECUTEと新公開ラッパーの認可/同意契約、`get_player_profile_link_request`管理者DTO（候補06の適用可否）、旧公開表SELECT閉鎖の依存、H13初期所属INSERT・H09 UPDATE RETURNING、通知/プロフィール統合・共有/ランキングの実HTTP正負例。Issue #264に従い単位を絞って進める。

## 0.7. 2026-11-19：H06旧RPC直接EXECUTEのステージング閉鎖と実JWT HTTP再試験

**重要：本節は前節B0のH06問題をステージングだけで修正し、実JWT HTTPで確認した結果。H03およびP0全体は引き続き未解消。**

### 根拠・影響範囲の確認

- Issue #264の確定仕様では、公開グループの未所属ログインユーザーは、仮選手から**本人紐づけ申請に必要な最小限の内容**を事前プレビュー・同意できるが、他グループの役職・内部ID・本人プロフィール名・詳細戦績は取得させない。
- 旧 `public.preview_profile_join(uuid,uuid)` はステージングでは `profile_link_private.scoped_preview` で旧プレビューの一部を限定しているが、全JSONには `source` や `review_token` を含み、内部所属IDを知る外部者が実HTTPで直接呼べる問題をH06で確認した。
- Migration 0055で追加した限定公開 `public.preview_public_club_claim(uuid,uuid)` は、独立公開参照から内部所属IDを解決し、所有者`postgres`のSECURITY DEFINER経由で**内部から旧previewを呼んで最小DTOだけ返す**。したがって旧関数の`authenticated`直接EXECUTEを閉じても、このラッパーの認証済み実行は維持可能。
- 新公開ラッパーによる申請previewと`review_token`一致を確保し、`submit_public_club_claim`／旧`submit_profile_join_request`の関数本体・権限はこのH06修正では変更しない。

### 実施したこと

1. `10_h06_legacy_preview_acl_candidate.sql` は**既定ROLLBACK**の安全な候補。現物旧preview MD5 `97a1f5de84750f0e3bf1cffa1d6805fd`／新ラッパーMD5 `dfc4453b42c6a734da9acd2f48e50e31`／所有者postgres／SECURITY DEFINER／既存EXECUTEをガードする。両呼出経路を同一トランザクションで一時テスト後ROLLBACK。
2. ステージングA仮選手U・無所属`outsider`の疑似ロールSQL試験で、**直接旧previewは拒否**、一方`preview_public_club_claim`は**必要10キーを返し、元の同意`review_token`が変わらない**ことを確認。SQL試験のみで実HTTP合格とはしない。
3. `11_h06_staging_apply.sql` を同じ署名/現物ハッシュ・ステージング専用fixture名でガードし、SupabaseのDDL用Migration管理ツールで**`padel-hub-staging`のみに永続適用**。履歴名`task08_h06_close_legacy_preview_staging`（20261119081303）、既存44→45件。変更は`public.preview_profile_join(uuid,uuid)`の`PUBLIC,anon,authenticated`からの直接EXECUTEのREVOKEに限定。関数本体、内部helper、RLS、表/列GRANT、既存アプリデータに変更なし。
4. 適用後のREAD ONLY監査：旧previewの定義MD5は**不変**、anon/authenticated直接EXECUTEは**false**、service_roleは引き続き**true**。限定公開`preview_public_club_claim`と`submit_public_club_claim`のauthenticated EXECUTEは**true**。既存所属8件、検証用クラブ2件、連携申請0件を維持。
5. 既存`08_staging_auth_http_smoke.mjs`に**H06実HTTPの拒否判定**と`H06_SAFE`（旧プレビューを内部的に使う新限定DTOの正例）を追加。ワークフローの実行ステップだけに`TASK08_EXPECT_H06_CLOSED=1`を設定し、対象ブランチの非秘密トリガー更新で**1回**実行した。
6. [GitHub Actions実行 #44486005853](https://github.com/g-ambe/Padel-match/actions/runs/44486005853) において、正規GoTrueログインとJWT付きPostgRESTを再実行。ジョブ/試験ステップ`completed/success`、ジョブログの**15判定：PASS 14、OBSERVE_PRIVACY_RISK 1、FAIL/BLOCKED 0**。具体的には、H06 `outsider`の旧関数直接呼び出しが**HTTP403・code42501**、`source`と`review_token`非返却。H06_SAFE `outsider`による限定公開ラッパーは**HTTP200、許容10キーだけ、preview/tokenあり**。H01/H02/H07/H11は引き続きPASS。
7. **H03匿名ViewはHTTP200・合成fixture名3件の公開を維持**（`OBSERVE_PRIVACY_RISK`）。H03はこのH06修正では対象外。14 PASSをP0全体の合格やH01〜H14全件消化と誤認しない。

### 停止条件

- **本番 `padel-hub` は完全未変更**であり、H06旧RPCの広い実行経路は本番側では閉じていない。ステージングで成立した修正の本番移行には、本番の関数本文・所有者・ACL・現行UI/消費者の照合と別承認が必要。本番は0054/0055自体も未適用。
- H03の既存View、本番と異なる`club_members`初期INSERT・旧RLS/公開SELECT、未移行のRPC、申請/統合、共有/戦績の回帰、H01〜H14未実施項目は継続。
- 本節でステージングAuthセッションメタデータを除くアプリ行の作成・更新・削除はなし。旧`03`/`06`候補は依然として既定ROLLBACK・未適用。**PR #265 Draft維持、Issue OPEN、マージ/本番SQL/本番デプロイ禁止。**

## 0.6. 2026-11-19：実Auth/PostgREST B0初回実行の確認済み結果

ユーザーがGitHub Actionsの [run #44483674678](https://github.com/g-ambe/Padel-match/actions/runs/44483674678) を提示し、GitHub連携から**run本体、jobステップ、実ジョブログ**を直接確認した。対象は既存ブランチ `codex/task-08-group-foundation`・トリガーコミット `020f8fe5bd01b41911469eb5b477f196c151a6e9`。Workflow名 `TASK-08 staging B0 Auth HTTP`、event `push`、2026-11-19 07:57:59〜07:58:19 UTC、run/jobとも `completed/success`、attempt=1。**本物のGoTrueログインとJWT付きPostgREST HTTPが実行された**。チェックアウト/Node22/Secrets存在検査/構文検査/隔離SDKインストール/HTTP本試験の各step成功。

**14判定の内訳：PASS 12、`OBSERVED_NOT_ACCEPTED` 1、`OBSERVE_PRIVACY_RISK` 1。0件の `FAIL` / `BLOCKED`。** 14は判定の行数であり、**H01〜H14の全14ケースを実装・消化した意味ではない**。

| 対象 | 本物のHTTP観測 | 判定 |
| --- | --- | --- |
| H01、main-A/recipient/outsider | 3名ともメール＋パスワードログイン成功、`getUser`整合 | PASS 3 |
| H02、匿名 | `club_members`直接SELECTはHTTP401、code42501 | PASS |
| H02、main-A | A所属はHTTP200、2件 | PASS |
| H02、recipient/outsider | A所属はHTTP200、各0件 | PASS 2 |
| H11、main-A | A内部名簿RPCはHTTP200、2件 | PASS |
| H11、recipient/outsider | A内部名簿RPCはHTTP403、code42501 | PASS 2 |
| H07、匿名 | 公開名簿RPCはHTTP401、code42501（匿名で取得できる設計ではない） | PASS |
| H07、outsider | 公開名簿RPCはHTTP200、2件、許可済みの最小フィールドのみ | PASS |
| **H06、outsider** | **旧`preview_profile_join`を内部メンバーID指定で呼ぶとHTTP200、`source`と`review_token`を返却、所属1件** | **OBSERVED_NOT_ACCEPTED：未解消** |
| **H03、匿名** | **`public.public_player_profiles`へHTTP200、3件取得でき、3件とも合成fixture表示名** | **OBSERVE_PRIVACY_RISK：公開要件の再評価が必要** |

**重要：GitHub Actionsの緑色のSuccessはスモーク実行成功を意味するだけで、P0の認可・データ公開が安全という結論ではない。** 現行B0は旧公開経路の再現を狙うためH06/H03の「問題を観測」もexit codeを非失敗にしている。これらを受入PASSに算入しない。テストにおいてJWT/パスワード/response本文/内部IDをIssue/計画に保存しない。ジョブログではテストスクリプトのBoolean/件数/statusのみを読んだ。GitHubが一部のactor表示を自動マスキングしたため、テストスクリプトの固定実行順・パラメータ名で判定した。

### 次に進むゲート

- **P0の最優先対策候補：H06**。旧`preview_profile_join`は、所属先グループの管理者・申請受取人でないテスト利用者へsource/同意tokenを返す実HTTP経路。返却内容/呼出者権限とUI利用箇所を確認し、単純なEXECUTE一括REVOKEで本人導線まで壊さず、狭いDTO・必要な権限で拒否できる対策を**新規の隔離検証候補**として設計する。既存`06_staging_link_detail_candidate.sql`は別の`get_player_profile_link_request`用であり、**H06の対策済みとは扱わない**。
- **H03**：既存Viewの目的が本来「公開プロフィール」かをアプリ利用箇所/仕様から確認する。現状の`security_invoker=true`は匿名を42501で拒否することをROLLBACK試験したが、正当な公開機能まで壊す可能性がある。Viewを無条件DROP/REVOKE/ALTERしない。
- B0で成功したH01/H02/H07/H11も本番とのACL/RLS差があるため、本番相当のB1/B2とは区別。H01〜H14の未実装ケース（新規所属INSERT/UPDATE RETURNING・本人申請・マネージャ詳細/統合・共有イベント等）は引き続き未実施。必要なら後続の**読み取り専用**HTTP/B1/B2検証を別のゲートとして増やす。
- 実Authログインに伴う`auth.users`のサインイン関連メタデータは変化し得るが、B0スクリプトはアプリDBのUPDATE/INSERT/DELETE、連携申請、承認/統合、本番デプロイを行わない。
- **今回のステージング・本番DB DDL/RLS/GRANT/データ変更はなし**（B0 Authログインの通常のセッション履歴以外）。`03`/`06`は既定ROLLBACKの検証候補のまま未適用。P0未完了、PR #265 Draftを維持、マージ/本番DB SQL/デプロイ禁止。

## 0.5. 2026-11-19：秘密値をChatGPTに渡さないB0 HTTP GitHub Actions起動手順

**ここは実行手段の整備のみ。GitHub Actions上での実Auth・PostgREST HTTP試験は依然として未実施。** ステージング用3ユーザーの既存パスワードはチャット、PR、Issue、README、GitHubコメントへ転記しない。

1. 既存Draft PR #265に[`.github/workflows/task08-staging-b0-auth-http.yml`](https://github.com/g-ambe/Padel-match/blob/codex/task-08-group-foundation/.github/workflows/task08-staging-b0-auth-http.yml)を追加。**このブランチの`.task08-b0-trigger`変更を伴うpushだけ**で起動する。通常のPR修正・Migration更新・mainブランチでは起動しない。必要な秘密値が欠落していればネットワーク認証前に停止する。
2. **本人が**GitHubリポジトリ `Settings > Secrets and variables > Actions > New repository secret` で以下の4件を登録する。パスワードは**テスト専用アカウントのもののみ**で、個人/本番/再利用パスワード禁止。ステージングの鍵はSupabase `padel-hub-staging > Project Settings > API Keys` で確認した`sb_publishable_`から始まる**Publishable key**を使う。anon JWT/Service Role/Secret Keyは使わない。
   - `TASK08_STAGING_PUBLISHABLE_KEY`
   - `TASK08_STAGING_MAIN_A_PASSWORD`
   - `TASK08_STAGING_RECIPIENT_PASSWORD`
   - `TASK08_STAGING_OUTSIDER_PASSWORD`
3. UserがSecrets登録完了を知らせてから、ChatGPT/GitHub連携で既存ブランチ`supabase/maintenance/group-foundation/.task08-b0-trigger`の**非秘密テキストだけを更新**。これにより1回の `push` イベントでB0ジョブが起動する。**未登録のうちにトリガーは更新しない**。
4. WorkflowはGitHub提供ランナー上でSHAピン留めの`actions/checkout`・`actions/setup-node`を使い、`permissions.contents=read`、元リポジトリ/対象ブランチ限定、既存`08_staging_auth_http_smoke.mjs`の構文を`node --check`で確認し、必要な`@supabase/supabase-js@2.112.1`のみ隔離ディレクトリに`--ignore-scripts`でインストールする。**Secrets環境変数は秘密値事前検査ステップ・実際のスモーク試験ステップにだけ注入し、checkout/依存インストールへは渡さない**。
5. スモーク側はステージングURL`https://zzjwpresqkefnyjyisgd.supabase.co`に固定。Publishable Keyが`sb_publishable_`形式でなければ最初に停止。ログインによりSupabase Authの最終サインイン時刻等は更新され得るが、アプリDBへのINSERT/UPDATE/DELETE、連携申請/レビュー/統合、RLS/GRANT変更、デプロイは実行しない。SQLログ/JSON応答/内部ID/ユーザーパスワード/JWTの実値は公開しない。結果はH01/H02/H03/H06/H07/H11の**一部B0観測**であり、H01〜H14全件完了とはしない。ステージングの旧preview/匿名Viewを`OBSERVED_NOT_ACCEPTED`などに分類し、P0合格に含めない。
6. 完了後にGitHub Actionsの成否/検証数・匿名View/旧previewの**真偽・件数・HTTP statusのみ**をIssue #264に追記する。テストが動作しても旧`03`/`06`候補の永続適用、ステージングRLS変更、本番DB適用やPRマージへ自動進行しない。秘密値は試験不要になったらGitHub Actions Repository Secretsから削除/ローテーションを検討する。

**コスト注記**：GitHub Actions使用分数とnpmインストール等の実行時間は発生する。無料枠が残っているかは本工程で確認していない。ランナーは`timeout-minutes: 10`、事前の秘密値チェックで未設定なら早期停止。Action公開コードはSHAで固定している。今はトリガーファイルに`NOT_TRIGGERED`と明記してあり、テスト未実施。

### 匿名Viewの限定的なROLLBACK改善実験

- 既存[`09_staging_view_invoker_rollback_probe.sql`](09_staging_view_invoker_rollback_probe.sql)を追加し、**GitHub上のSQLそのものを実ステージングへ適用してROLLBACKした**。既存テストプロフィール3件が見える状態で、匿名ロールの現行Viewは3件可視。トランザクション内でのみ`ALTER VIEW ... SET (security_invoker=true)`を試すと、匿名アクセスは**42501**で拒否された。ROLLBACK後は元のView設定に戻っている。
- この実験は匿名公開を閉じる有効な選択肢を示すが、**既存の公開プロフィール画面/アバター等を壊す可能性**があるため、正式適用を禁止。Viewの呼び出し側・公開要件・正例/負例を確認してから、専用DTO・認可スコープを決める。P0全体の解決を意味しない。

## 0.4. 2026-11-19：06修正候補の実ステージングROLLBACK試験・実Auth HTTP実行器

**対象は既存ステージング `zzjwpresqkefnyjyisgd` のみ。本番SQL未実行。** 直前工程のテスト用グループA/B・Auth3アカウントに付随するアプリデータを利用し、連携の漏えい検査を進めた。

### 06を一時的に有効化した候補SQL試験（実DBだがHTTPではない）

- 既存[`06_staging_link_detail_candidate.sql`](06_staging_link_detail_candidate.sql)をGitHubから取得、現物ハッシュ/owner/内部helper権限のガードを維持したまま、**1つのDBトランザクション内で**申請の作成→既存関数の挙動測定→候補関数の一時的`CREATE OR REPLACE`→同じ申請で再検査→**必ず`ROLLBACK`**する試験を実施。
- 事前の実DBの旧関数MD5は`7a8056ebfc2eddadf1dcff41c42a22cc`。候補を使ったSQLロール模擬試験は、**A管理者・申請受取人・無関係なoutsiderの3役**で完了。
- 修正前：A管理者用詳細に`target_auth_user_id`・`source_player_profile_id`・`review_token`が返ることを再現（値自体はログ/外部保存しない）。
- 修正候補中：A管理者には`detail_scope=manager`・対象Aの所属role情報・選手の名称を返し、認証ID/内部選手ID/review_token/全所属リスト/本人source/統合先IDを返さない。Bのクラブ名を含まない。**管理者DTOのキー数10**。
- 申請受取人には`detail_scope=recipient`・本人同意source/所属プレビューが維持。**`review_token`は修正前後で同じ値**（DB内のハッシュ一致比較のみ、値は返却しない）。プレビュー所属数は修正前後とも1。outsiderが同じ申請の詳細を取得すると拒否。
- 終了後の別のREAD ONLYクエリで、旧詳細RPC定義MD5は適用前と同じ、連携申請0件、既存所属8件・追加テスト所属4件、fixtureクラブA/B 2件が残っていることを確認。**候補06は実ステージングへ永続適用していない**。`03`の元候補も変更なし。

### 管理UPDATE RETURNINGと初期INSERTのロール模擬確認

- 同様に`BEGIN`〜`ROLLBACK`内のトランザクションローカルAuth ID＋`SET LOCAL ROLE authenticated`で、Aのmain管理者の仮選手所属を一時UPDATEすると**RETURNING行が取得できた**。無関係なoutsiderではUPDATEは0行。
- Aのmain管理者が所属レコードを新規INSERTしようとすると**SQLSTATE 42501**で拒否。既知の`club_members` INSERTポリシーがステージングで欠落している差分を、実ロール模擬でも確認した。**本番の初期所属INSERTが動作しないという意味ではない**。RLSのコピーやGRANT拡張で安易に解消しない。
- 変更はROLLBACKし、テストグループの役職/所属件数は維持。H09相当のSQL正例・負例は一部確認、H13は**ステージング側の要修正前提**として記録。**どちらも実HTTP試験の合格ではない**。

### 検証用の実Auth/PostgREST HTTPクライアント

- 新規[`08_staging_auth_http_smoke.mjs`](08_staging_auth_http_smoke.mjs) は、既存`@supabase/supabase-js`を使う**実Auth HTTP専用**スクリプト。外部URLは`https://zzjwpresqkefnyjyisgd.supabase.co`に固定。明示的な環境変数がすべて設定されない限りネットワーク試験は開始しない。アプリDBの書込は行わない。入力パスワード・アクセストークン・内部ID・応答本文を出力しない。
- 必要な環境変数：`TASK08_STAGING_PUBLISHABLE_KEY`（本番キーは不可）、`TASK08_STAGING_MAIN_A_PASSWORD`、`TASK08_STAGING_RECIPIENT_PASSWORD`、`TASK08_STAGING_OUTSIDER_PASSWORD`。**GitHub Secret・Codex環境の秘密値管理等で設定し、チャット・PR・Issue・ログへ値を貼らない**。ステージングにはmodern publishable keyが存在することを管理連携から確認済み（キー値は保存していない）。
- 実行時はプロジェクトの依存を準備した環境から `node supabase/maintenance/group-foundation/08_staging_auth_http_smoke.mjs`。実ユーザーパスワードを使ってGoTrueログイン＋`getUser`検証、Data APIによる基底表SELECT、名簿/公開名簿RPC、旧`preview_profile_join`、ステージング固有の匿名Viewアクセスを確認し、レスポンスは状態・真偽・件数だけを出す。旧漏えい観測は`OBSERVED_NOT_ACCEPTED`として**P0受入合格に数えない**。
- **現在の実Auth HTTP結果：全件未実施。** ChatGPTの接続済み管理ツールはAuthパスワード/ユーザーセッションを扱わず、こちらに試験用パスワードは渡されていない。スクリプトは準備済みだが、本番相当の修正版/B1・権限切替後/B2テストではない。Node構文や実ネットワークの動作確認も未実施であり、実行時は結果を別途記録する。

### 新たな匿名View経路の具体的な影響

- テストユーザーのリンク済みプロフィール3件が追加された後、**ステージングのSQL `SET LOCAL ROLE anon`で`public.public_player_profiles`から3行を取得できることを件数のみで確認**。3件とも`TASK08-P0`の合成表示名。avatar URL表示対象0件。以前の「匿名可視0行」という観測は**fixture作成前**だったため更新。
- このViewはステージングにのみ存在、`security_invoker`未指定、anonのView列SELECT可。基底表の匿名拒否を迂回し得る。**元の個人名ではなく合成fixture名が可視**だが、実HTTPのH03/H04に加えて確認する。Viewの利用箇所・公開仕様未確認のまま削除/権限変更はしない。

### 現在のゲート

1. **B0本物のAuth+PostgREST HTTP**を安全な秘密環境から実行し、JWTと権限を観測する（未実施）。
2. 仮選手Uの二所属/役職差を含め、修正候補06の実SQL負例と同意tokenの一貫性は確認したが、HTTP+永続適用の検証は別ゲート。
3. H13新規グループの初期所属INSERTや本番と異なる旧SELECT/RLSの意味差、Viewの公開影響、元0039に依存する処理・復旧方法を整理。**今回ステージングRLS/ACL/旧関数の永続変更なし**。
4. PR #265はDraft、Issue #264はOPEN、P0未完了。**本番Migration・Cloudflare本番デプロイ・マージ禁止**。

## 0.3. 2026-11-19：既存ステージングに実Auth登録3アカウント・合成グループA/Bの検証データを準備

ユーザーがSupabaseの**既存ステージングだけ**で検証用Authユーザー3名を作成し、ChatGPT管理接続から3名のAuthレコード・メール確認済み状態を読み取り専用で確認。パスワード・JWT・APIキーは取得していない。その後、アプリ側のプロフィール/所属は未作成（3名とも0件）であることと、既存ステージングのクラブ1件・所属8件・選手8件を確認してから新しいfixtureを準備した。

### 追加したステージング専用fixture

- 固定識別名：クラブ `TASK08-P0-20261119-A` / `TASK08-P0-20261119-B`、アプリ側の表示名は`TASK08-P0 …`。実名、既存クラブ、既存試合、既存選手、既存認証情報は使用しない。正規のAuthユーザーはユーザー作成済みの3アカウントだけを参照し、Authスキーマへ直接INSERTしない。
- 追加：`public.profiles`にAuth ID対応のテストアカウント3行、`player_profiles`に連携済み3行＋未連携の仮選手U1行、`clubs`に公開テストクラブA/B 2行、`club_members`に所属4行。`group_read_private.directory_refs`へトリガーを通じて参照4行。
- 所属：main-AはAのmain_admin、recipientはBのmain_admin、仮選手UはAのmember・Bのsub_admin。outsiderは無所属。仮選手Uを2グループに所属させ、旧連携詳細の他グループ情報漏えいを安全な合成データで再現できる状態にした。
- 最初に**同じINSERTのROLLBACKドライランが成功**し、新規クラブ2・所属4・選手4を検証。ROLLBACK後にテストクラブ/選手が0件、元のクラブ1・所属8・選手8を確認してから、事前の一致件数・ID競合無し・確認済みAuth・FK/トリガー整合を条件に**単一トランザクションでCOMMIT**。
- COMMIT後の読取確認：テストクラブ2、所属4、新選手4、新アプリプロフィール3、公開参照4。既存クラブは残り、既存所属8件は維持。外部者の所属0、仮選手Uの所属グループ数2。**削除・マージ・既存レコードUPDATEなし**。
- 将来回収時は`TASK08-P0-20261119-`のクラブと`TASK08-P0 `の選手/アカウントのみを、個別のFK確認/明示承認後に対象ID台帳と照合して回収する。既存ユーザー／既存クラブのCASCADE・無条件削除は禁止。Authユーザーも自動削除しない。

### SQLロール別ベースライン（実Auth HTTPではない）

`BEGIN READ ONLY`でテストアカウントの実DB上のAuth IDを読み取り、トランザクションローカルの`request.jwt.claim.sub`と`SET LOCAL ROLE authenticated`を使って**疑似ロール**試験した。**正規に発行されたJWTを使うGoTrue/PostgREST HTTP試験ではない**。

| 疑似actor | 本人所属RPC | A内部名簿 | A公開名簿 | B公開名簿 |
| --- | --- | --- | --- | --- |
| main-A | 1件 | 2件取得 | 2件 | 2件 |
| recipient（B管理者） | 1件 | 権限エラー42501 | 2件 | 2件 |
| outsider | 0件 | 権限エラー42501 | 2件 | 2件 |

基底表`club_members`のA直接SELECTもmain-Aで2行、recipient/outsiderで0行。公開名簿は**ログイン済み外部者も公開グループなら取得できる設計**のため、取得成功自体を漏えいとみなさず、内部ID・役職・本人名が出ないDTOであることを別途確認する。

### 旧連携経路の残存を合成データで確認

- outsiderが**既知の内部所属ID**を渡して旧`preview_profile_join`を直接実行すると、仮選手の`source`と`review_token`を含むプレビューが返った。ステージングのscoped previewでA所属1件に限定され、Bのクラブ名はこの応答には含まれなかったが、**旧RPCの直接実行可能経路は残る**。この結果は実HTTPと区別する。
- main-Aの疑似認証で旧`request_player_profile_link`からrecipient宛の申請を作成し、旧`get_player_profile_link_request`の管理者・受取人応答を比較する**ROLLBACKドライラン**を実施。現行ステージングの管理者向けレスポンスには`target_auth_user_id`・申請の内部`source_player_profile_id`・`review_token`が存在。本人の応答にも`source`・`review_token`が存在。管理者向け`memberships`はscopedによりB名を含まなかった。**トークン値・認証ID・申請行本体は取得/保存せず、Booleanフラグのみ**記録。
- ドライラン後の読取確認で`player_profile_link_requests`の残存申請は0件。新規の本人申請・通知は保存していない。今回のP0問題は**別グループの名前が出なくても、管理者に不要な認証IDや同意トークンを含む申請全行を返す**問題も含むため、限定DTO化の必要性は変わらない。

### 未実施と次の停止条件

- 既存の`03_link_detail_candidate.sql`と`06_staging_link_detail_candidate.sql`は**既定ROLLBACKのまま実環境未適用**。旧公開表/列SELECT、旧`preview_profile_join`などの直接EXECUTE、RLS変更・権限閉鎖もしていない。
- Authユーザーが存在しても、**パスワード/セッション/JWTを使った実HTTPのH01〜H14は未実施**。パスワード/JWTをチャットやGitHubに貼らない。現行B0 HTTPの安全な試験クライアント接続と、追加権限/修正が必要なB1/B2の各ゲートを分ける。
- ステージングの`club_members` INSERTポリシー欠如や、本番と異なる旧連携関数/RLSは未解決。認証付きHTTPを試すために権限を無差別にGRANTしたり、プロジェクトのURL/キーを本番から流用しない。
- PR #265 Draft、Issue OPEN、本番SQL・本番デプロイ・マージは禁止。

## 0.2. 2026-11-19：ステージング固有scoped_previewの維持候補とREAD ONLY確認

既存ステージングの旧詳細RPCは `profile_link_private.scoped_preview(p_source uuid,p_user uuid,p_club uuid)` を使用し、旧連携5関数の定義が本番と異なる。前節の差分を踏まえ、**ステージング用の隔離検証候補** [`06_staging_link_detail_candidate.sql`](06_staging_link_detail_candidate.sql) を追加した。元の本番系 `03_link_detail_candidate.sql` は不変。

- `06`は管理者へ対象グループ限定のDTOを返す`03`の方針を保持し、**受取人の枝のみをステージング既存の`scoped_preview(source,user,club)`へ差し替え**る。受取人兼管理者は受取人用の同意を優先する。
- 対象旧RPCのowner/SECURITY DEFINERと**ステージング現物の定義MD5 `7a8056ebfc2eddadf1dcff41c42a22cc`**を前提条件に固定。内部`scoped_preview(uuid,uuid,uuid)`がpostgres所有/SECURITY DEFINERかつanon/authenticatedへ直接EXECUTE不可であることも検査。現物が変わればエラー停止する。**本番へは適用禁止**。
- 候補SQLは`BEGIN`／`ROLLBACK`で終わり、適用可能な番号付きMigrationではない。既存ステージング・本番の関数/ACL/RLSはこの工程で**上書きしていない**。元の同意・承認・統合関数も未変更。
- 新規 [`07_staging_scoped_preview_preflight.sql`](07_staging_scoped_preview_preflight.sql) を既存ステージングへ**READ ONLYでそのまま実行**した。架空ターゲットUUIDと既存の有効な未連携プロフィール1件を用い、実プロフィールID・氏名・preview本文・tokenを一切結果に含めず、返却キー/トークンの存在・一致/件数のみ比較した。
- 結果：`read_only=on`、標本あり、全previewとscoped previewの**トップレベルのキー集合は一致**、双方に`review_token`が存在しトークン値は等しい。所属件数はどちらも1。**既存の対象者が単一グループ所属であるという限定試験**なので、複数グループを跨ぐ管理者情報非漏えいの証明ではない。
- 実Auth/実HTTP・2グループfixture、候補の隔離DBへの適用・ロール別負例、適用後のHTTPの実行と復旧リハーサルは**未実施**。現状のステージングではAuthユーザー0件のため、実JWTログインは未実施。SQL `SET ROLE`や既存プロフィールの形状試験を実HTTPとして数えない。
- Supabaseの接続済み管理ツールはAuthユーザーの作成機能を提供していない。専用架空アカウントを正規のSupabase Auth管理経路から作るには、追加の承認済み管理操作手段が必要。**auth.usersへの直接INSERTはしない**。
- **次の判定**：別クラブの所属/役職がある状態で管理者用DTOの非返却、受取人の同意レビュー/token一致、無権限の直接旧RPC/基底表・列SELECT、および管理UPDATE RETURNINGを隔離SQLで検証したのち、復旧手段と実HTTP試験環境が確立してからステージングの確定適用を別途判断する。旧公開SELECT/RPC全体の閉鎖はさらに後段であり、P0未完了。

## 0.1. 2026-11-19：旧連携RPC・RLSの読取専用意味フラグ比較

この節は**ステージングへの0054/0055適用後**に、GitHub上の `05_legacy_link_acl_semantics.sql` と等価な読取専用SQLを、両実DBへ個別実行して得た追加調査。SQLは `BEGIN READ ONLY`／`ROLLBACK`、関数本文・RLS式そのもの・Authやアプリの行データは返さず、定義ハッシュと検出フラグ・ACL/ポリシー名だけを比較する。テキスト検出の成否だけでは関数の安全性を証明しない。実Auth・HTTPは未実施。

| 対象 | 本番 `padel-hub` | ステージング `padel-hub-staging` | 意味・対応 |
| --- | --- | --- | --- |
| `get_player_profile_link_request` | `to_jsonb(request)`あり／`profile_link_private.preview`を呼出し | `to_jsonb(request)`あり／**`profile_link_private.scoped_preview`を呼出し** | 管理者へ申請行全体が返り得る問題は両側に残存。ただし呼出すpreviewの意味が異なるので、0039や候補SQLを無検証で上書きしない |
| `preview_profile_join` | `profile_link_private.preview`を呼出し | `profile_link_private.scoped_preview`を呼出し | 本人申請の公開・同意範囲が変わる可能性があり、返却キー・preview計算・review_tokenを照合する必要あり |
| 内部 `scoped_preview` | なし | **存在**（postgres所有／SECURITY DEFINER、anon/authenticatedの直接EXECUTE不可） | ステージング固有の保護ロジックとして扱い、復旧情報なしで削除・置換しない |
| 旧連携5RPC | 5件ともpostgres所有・SECURITY DEFINER・authenticated EXECUTE／anon拒否 | 同左。ただし**5件の定義MD5はすべて不一致** | 名称/署名/ACLが同じでも同等動作とは証明できない |
| `club_members_read` | SELECT `USING(true)`、anon/authenticated対象 | 認証ユーザー限定、条件付き | 本番の公開SELECTリスクをステージング単体の拒否結果で再現したとは扱わない |
| `player_profiles_read` / `profiles_read_names` | SELECT条件/列GRANTがステージングより広い | 制限付きの別定義 | 本人名・公開名簿、管理のUPDATE RETURNINGを閉鎖前後で確認する |
| `club_members` INSERTポリシー | 1件存在 | **0件** | ステージングのグループ新規作成・作成直後のmain管理者所属試験（H13）は、現状のままでは本番の互換証明に使えない |
| `profiles.display_name` anon列SELECT | 許可 | 拒否 | `profiles.email`のanon列SELECTは両環境で拒否 |

関連7表のRLSポリシー（全command）は**本番27件／ステージング15件**、定義指紋と構成が不一致。特に本番は`club_members_read`の公開許可を残している。上記フラグは関数本文の一部キーワードをDB内で走査したもので、実際の返却値・認可分岐・動的SQL・ロック/同意の意味レビューを完全に終えたものではない。

### 追加確認：ステージングの既存ViewとSQLロール試験

- `public.public_player_profiles` は**ステージングのみに存在**し、`security_invoker=true` の指定がない既存View（`security_barrier=true`）。anon/authenticatedともにViewの`id`・`display_name`・`avatar_url`列へSELECT可能。基底表のanon SELECTを拒否していても、Viewの権限・定義は別の公開経路になり得るため、B0/B2の確認対象に追加する。
- ステージングへの**実DBの読取専用SQLロール検査**（`SET LOCAL ROLE anon`）では、現状このViewからの可視行は0件、avatar URLも0件だった。既存の仮メンバーが見えないことを示す限定結果であり、実Auth/JWT・PostgREST経由で将来も安全という証明ではない。ViewのSQL定義本文、プロフィール行、画像URL自体は返却/保存していない。
- 本番にはこの名称のViewがない。両環境の機能/認可差として記録し、権限を広げたりViewを改変したりせず、実HTTPの前に何を検証するかを決める。

### 既存の修正候補SQLに対する停止判断

`03_link_detail_candidate.sql`は、受取人向けに**本番0039の `profile_link_private.preview` を呼ぶ設計**。これをステージングへ確定適用すると、現状の `scoped_preview` 経路が置き換わる。**プレビュー/同意/tokenの意味が変化する危険があるため、現状の候補SQLをステージングへ適用しない**。保護対象・認可境界・返却契約を揃えたステージング専用の修正案を、独立した隔離DB・実Auth試験と既存定義の安全な復旧方針が整うまで決め打ちしない。

- 現時点では本番・ステージング双方で**旧連携RPC、RLS、表/列GRANTの変更なし**。0054/0055のステージング追加適用は前節の通り完了済み。
- 実Authの試験ユーザーはステージングに未作成。管理者権限のDB接続や合成JWT・`SET ROLE`によるチェックは**本物のGoTrue/PostgREST HTTP正例/負例の代用にならない**。
- 次の実施範囲は、①`scoped_preview`と本番`preview`の返却境界、②管理UPDATE RETURNINGと初期所属INSERT、③現行ステージングB0の試験アカウント/fixtureを安全に作る方法の設計。既存ステージング8名分のデータや本番データを変更・複製しない。
- マージ・本番SQL適用・デプロイは禁止、PR #265 Draft・P0未完了を維持する。

2026-11-19。基準コミット `98598df55d1e2473751ec241110dfa1e1c322c53`。
仕様：Issue #264、設計コメント6975098709。停止条件：[STAGE3.md](STAGE3.md)。
既存 `codex/task-08-group-foundation` / Draft PR #265を使用する。
**計画のみ。本番・ステージングの構造/データ/Authへの書込み、マージ、デプロイは許可されていない。**

## 1. 根拠と現在の到達点

| 根拠 | 確認内容 | この工程での扱い |
| --- | --- | --- |
| GitHub PR #265 | head 98598df、OPEN/Draft | 作業開始時に再確認 |
| Issue #264 [コメント6999573499](https://github.com/g-ambe/Padel-match/issues/264#issuecomment-6999573499) | 両DBを読取専用比較。ステージングACTIVE_HEALTHY、public表29対40、Authユーザー0、既存グループ1/所属8/選手8 | **前回調査の記録**。最新の実DB状態として再確認したわけではない |
| 同 [コメント6999633499](https://github.com/g-ambe/Padel-match/issues/264#issuecomment-6999633499) | 旧連携5関数の定義ハッシュとSELECT/RLSが本番と不一致 | 本文差分/安全性は未確定。履歴数だけで補完しない |
| 98598dfの隔離試験 | 連携49件、最終P0 8件、0039+0054+0055の共存等が成功 | 架空データのPGlite SQL試験。実Auth/HTTPとは区別 |
| この工程の接続確認 | 本番の既知poolerに対する認証前TLSプローブが名前解決失敗 | SQL/認証情報は送信していない。両DBの最新カタログ比較は未実施 |

この実行環境にはステージングの確定project ref/接続情報、Supabase管理接続ツール、管理API認証を
確認できない。本番用DB URLやanonキーをステージング用と誤認して使用しない。
名前だけを根拠に新規プロジェクトを作らず、既存ステージングをリセット/再構築しない。
最新差分の確定には、両プロジェクトを明示指定できる既存の読取専用管理接続が必要。

## 2. 既知の差分と限定試験の依存

以下は前回コメントの報告値と、リポジトリのDDLの対応。**今回のライブ照合結果ではない。**

| 項目 | ステージングの前回状態 / 本番との差 | 対応方針 |
| --- | --- | --- |
| Migration履歴 | 42件・末尾minimal_security_replacement、番号付きは0039まで確認 / 本番22件・異なる命名体系 | version/nameと実オブジェクトを個別対応。42件だから新しいとは判断せず、番号の追記/履歴書換えはしない |
| club_members / player_profiles / clubs / events / join_requests | SELECT許可・RLS数等が不一致。具体的な全ACL/式は未取得 | 表/列ACL、SELECT/ALL/UPDATE、所有者・helperを再照合。既存ステージングを本番相当にするための一括REVOKE/GRANTは禁止 |
| 旧連携5関数 | get_player_profile_link_request、preview_profile_join、submit_profile_join_request、request_player_profile_link、review_player_profile_linkの定義MD5が不一致 | 同じDB内で本文を確認する経路で差分をレビュー。ハッシュ相違だけで0039全文を上書きしない。本文をファイル/ログ/成果物へ出力しない |
| 固定ペア | event_fixed_pair_state / event_fixed_pairs / event_fixed_pair_roundsが未確認（0040） | 今回の限定連携HTTP試験の直接依存ではない。固定ペアまで互換確認する工程では必要 |
| 通常カード保存 | friendly_round_lineup_state / friendly_match_operationsが未確認（0041、関連0042/0043） | 旧連携DTOだけの前提にはしない。現行アプリのスコア/手動保存のHTTP回帰確認を行う前に別途整合が必要 |
| チーム戦 | event_team_attendance / event_team_roundsが未確認（0044/0045、動画RPC0047） | 既存event_team_matchesへの統合参照試験と、現行の乱数/出欠/保存試験を分ける。後者は未整合のまま成功扱いしない |
| プロフィール非公開機能 | profile_media_objects / player_profile_private / profile_media_operations / profile_media_attemptsが未確認（0048、関連0049〜0051） | 画像/ホームコートは対象外。今回のためにR2設定/Secretsや画像用構造を一括導入しない |
| 用途別読取 | 0054/0055の存在・定義・ACLの最新確認が必要 | 必要なら追加対象。ただし現在は適用しない。CREATE競合・既存関数のsignature/owner/ACLと依存が未確定なら停止 |

0039のスナップショット/統合helper、本人canonical、連携申請/監査/通知の構造、管理権限判定、
参照FK/triggerが限定試験の主な前提。0054/0055では既存の通常/チーム/公式の基底表・列も参照する。
PGliteの0039+0054+0055共存試験は、この限定範囲に11不足表すべてが必須ではないことの根拠になるが、
本番の全関数/アプリと一致する保証にはならない。
**未知の意味差がある5関数や権限の修正SQLは、現物照合前には確定しない。**

## 3. 両DBの読取専用preflight

1. 接続サービス側でproject名とrefの組を照合。本番は `padel-hub` / `ntczrmvffmpjzilfebyi`。
   ステージングは `padel-hub-staging` のrefを管理接続から確定し、記録する。未確認のrefを推測しない。
   両方ともDB名postgresであるため、current_database()だけで識別しない。
2. [04_http_preflight.sql](04_http_preflight.sql)を各プロジェクトに**別々のREAD ONLY接続**で実行する。
   出力はMigrationのversion/name、表・列/ACL/RLS、FK/trigger/index、default ACL、関数の署名・owner・search_path・
   EXECUTE・DB内計算MD5、schema/role情報だけ。アプリ行、auth.users、秘密値、Migration本文、関数本文は取得しない。
3. 関数はschema+名前+identity argumentsで比較。MD5は差異検出用で、安全性の証明や署名ではない。
   同じPostgreSQLの表現差も考慮し、差があればDB内レビューで理由を特定する。
   grantは表ACLだけでなく列ACL、PUBLIC由来の実効権限、schema USAGE、role継承/BYPASSRLSも確認する。
4. 比較表を「一致/既知の追加/未確認の意味差/不足」に分け、取得時刻、project ref、SQL/PR SHAを記録。
   旧SELECTが狭いステージングの結果を本番の漏えい再現として扱わない。
   管理接続ではAuthメール/パスワード認証の有効性、API公開schema、PostgRESTのrole切替とschema cacheも
   設定値/状態だけを確認する。APIキーやJWT secretは取得/公開しない。内部schemaをHTTP公開する変更はしない。
5. ステージングだけで、承認された別の読取照会により既存行の件数・参照整合と利用中か否かを確認する。
   現存8名のデータが架空だとは仮定しない。名前/メール/画像キーはログへ出さない。

このSQLはローカルの架空PGliteで構文・READ ONLY・機密本文/アプリ行の非返却を試験する。
本工程では接続不足のため実DBへの実行を完了していない。既存01_preflight/read_catalog/workflowは変更しない。

## 4. 最小修正とデータ保護・復旧の計画

今後、別途適用許可が出た場合も、次の順で1件ずつ判定する。現時点で適用用の差分SQLは未作成。

- **基準保全**：既存ステージングの利用を確認し、作業窓と変更排他を合意する。スキーマ/ACLハッシュ、
  関連行の件数・DB内指紋、参照整合を固定する。データ保護が必要な変更前は、ステージング自身の
  データだけを暗号化して保全し、隔離復元を確認する。既存の本番固定バックアップ設定を流用して本番を取得しない。
  Authスキーマ・パスワードhash/refresh token・Secrets/keyは外部コピーに含めない。
  関数本文の外部保存は禁止なので、schema dumpを外部へ保存しない。必要な旧定義の復旧情報は、
  別途レビューされたDB内の管理者限定方式で保持する計画とし、未確立なら関数の確定変更をしない。
- **既存構造の不足**：限定連携/読取に直接必要な表・列・関数だけを特定する。追加列のdefault/NOT NULLや
  triggerが既存行/同意snapshotへ及ぼす影響、ロック、FK、未知参照を確認。既存行の一括補正・削除は禁止。
- **新取得の追加**：0054→0055の前提がそろい、衝突がない場合だけ将来の適用候補とする。
  既存表ACLを緩めて再現環境を作らない。広い旧SELECTの再現は引き続きPGlite内で行う。
- **旧連携詳細の候補**：`03_link_detail_candidate.sql`はそのまま保存し、末尾ROLLBACKを書き換えない。
  実環境への確定適用はこの計画に含めない。過去0039/0054/0055を書き換えない。
- **試験データ**：以下の専用run IDに属する新規データだけを、将来の明示承認後に作成する。
  既存グループ/選手/申請/試合には触れない。最初の作成前に復旧・回収対象をIDで確定する。
- **失敗時**：COMMIT前はROLLBACK。COMMIT後は新機能の試験を止め、既存行の指紋/FK/ACLを再確認。
  関数/ACLはレビュー済みのDB内復旧情報と正確な対象だけで復旧し、公開SELECTの一括復活はしない。
  プロジェクト全復元や既存データを巻き込むCASCADEは行わない。変更後に既存行が変わっていれば復旧も停止して調査する。
- **試験後の回収**：台帳に記録した新規fixtureだけを依存順に回収する別承認手順を用意する。
  Auth削除のCASCADEや統合監査FKを考慮し、利用中データや既存IDから参照されたfixtureは自動削除しない。

### ROLLBACK候補とHTTPの境界

未COMMITのCREATE OR REPLACEは別接続のPostgRESTからは確認できない。末尾ROLLBACK後にも修正は残らない。
したがって**候補SQLをそのまま実行してHTTP修正版の成功を検証した、とは報告できない**。
ステージングHTTPはまず現行状態の基準試験となる。修正版の実HTTP試験には、別途承認・前提照合・
復旧可能性を満たした確定適用の工程が必要。本工程ではその適用SQLも作成しない。
権限閉鎖後のHTTPはさらに別ゲートであり、未検証の権限切替Migrationを先行作成しない。

## 5. 将来の架空Auth・データ構成（未作成）

台帳prefix `TASK08-P0-<run-id>` を使用。メールは予約ドメインの例
`task08-p0-<run-id>-main-a@example.invalid`。実在メールへ招待/確認通知を送らない。
将来の準備時にはステージングの管理手段で試験ユーザーを作成し、メール確認済みの**試験アカウント**として
扱う。これは実メール確認フローの試験ではない。現在はAuthユーザー作成もログインも未実施。

| actor | グループA | グループB | 用途 |
| --- | --- | --- | --- |
| main-A | メイン | 未所属 | 対象管理/取消、他グループ拒否 |
| sub-A | サブ | 未所属 | 許可対象管理、メイン管理不可 |
| member-A | 一般 | 未所属 | 内部名簿可、管理/RPC申請詳細不可 |
| departed-A | 在籍解除済み | 未所属 | 公開最小情報のみ、内部/管理拒否 |
| main-B | 未所属 | メイン | Aの申請・内部名簿拒否 |
| member-B | 未所属 | 一般 | 別グループ境界 |
| recipient | 未所属 | 未所属 | 受取人本人の同意、正規プロフィール/統合 |
| outsider | 未所属 | 未所属 | ログイン済み外部閲覧者 |
| anon | JWTなし | JWTなし | 公開表/共有/関数ACL境界 |

スーパー管理者が必要な試験は、専用アカウントへの既存app_admins方式による付与と解除を別途承認する。
既存の特例メールを登録したり、JWTのemail/subを偽装したりしない。

- A/Bは専用の公開グループとして新規作成する計画。非公開切替試験もこの2件だけで行う。
  ownerとmain所属を整合させ、既存グループを再利用しない。
- authユーザーID、正規player_profile ID、club_member IDは別の識別子として台帳へ管理する。
  setupで別UUIDの正規プロフィールを用意する場合は、サーバー管理経路と既存identity triggerの整合を先に確認する。
  ブラウザへ識別子の書換え権限を付与しない。
- 仮プロフィールUをA/Bの両方に配置し、役職を変える。main-Aからrecipientへの連携申請Lを作り、
  管理者がBの役職/所属や本人統合先を取得できないか検査する。recipientが管理者も兼ねる別ケースも用意する。
- 専用の通常イベントE-A、BのE-B、終了済み共有E-Sを作る計画。手動/チーム/公式も必要な構造が
  そろった範囲で別fixtureを使う。未入力/得点済み、共有有効/停止、欠席者と過去参加者を分ける。
  承認・スコア等の変更を伴うケースごとに別申請/試合を使い、既存試合は更新しない。
- パスワード/JWT/refresh token/service_roleはログ/PR/台帳へ書かない。必要な試験時だけ専用の秘密保管を使う。
  同じステージングのanon/publishable keyと、実 `/auth/v1/token?grant_type=password` が発行したJWTでRESTを呼ぶ。
  service_roleやDB管理接続はfixture準備用のみで、ユーザー向け正例/負例には使わない。
- `NEXT_PUBLIC_SUPABASE_URL`をグローバルに変更しない。試験専用プロセスでステージングのref/URLを固定し、
  本番refが含まれるURLやリダイレクトは拒否する。Cloudflareプレビューが本番に向いていれば試験に使わない。

## 6. HTTP正例・負例の検証表（全件未実施）

段階B0＝現行ステージング基準、B1＝旧連携詳細だけの修正が**別承認で確定適用された後**、
B2＝将来の権限閉鎖後。B1では旧表/旧previewの漏えい経路は残り得る。B0と本番の同等性も未証明。
拒否はHTTP 401/403、またはRLSで0行等の**実際の契約**を記録する。200/空配列だけで安全と判断しない。
各試験にactor、run/project ref、段階、URL/入力ID、期待キー、status/SQLSTATE、実測結果を記録する。
応答本文を丸ごとログ保存せず、fixture ID・真偽・件数・キー検査結果だけを残す。

| ID/入口 | 正例 | 負例・検査内容 | 判定段階 |
| --- | --- | --- | --- |
| H01 Auth | 各専用アカウントが実ログインしuser IDと発行元を確認 | JWTなし/失効/別プロジェクトJWTで認可成功しない。sub/emailを改変して作らない | B0以降 |
| H02 `GET /rest/v1/club_members?select=*` / 内部列指定 | 将来も必要な本人行/管理更新返却を確認 | anon/外部/B/退会者がAのrole/profile_id/player_profile_idを得ない。現行で得られたら漏えいとして記録 | B0観測、B2受入 |
| H03 `player_profiles` / `profiles`の列SELECT | 本人プロフィールの既存項目を取得 | `select=*`、display_name、linked_auth_user_id、emailを個別検査。表ACLと列ACLの差/他人名の逆引きを確認 | B0観測、B2受入 |
| H04 REST埋込/HEAD/count | 実FK名を確認して`clubs→club_members→player_profiles`と逆方向を取得 | 未所属/B/退会/anonで埋込から内部列が漏れない。親取得可と子取得可を混同しない。schema cache不整合を検知 | B0観測、B2受入 |
| H05 `POST /rpc/get_player_profile_link_request` | recipientのsource/所属/件数/tokenと、main/subの対象A概要 | outsider/member/B/departed/anon、不明ID拒否。管理者にB、本人詳細、auth/統合先ID、件数、tokenなし。キーallowlist一致 | B0再現、B1受入 |
| H06 旧`preview_profile_join` / `submit_profile_join_request` | 現行認可内の加入同意と0055ラッパーが成立 | 内部ID指定/他グループ/anon、旧関数の直接EXECUTEから漏えい/迂回がないか確認。B1の成功を閉鎖完了にしない | B0/B1観測、B2受入 |
| H07 `preview_public_club_claim` / `submit_public_club_claim` | 公開参照と必要な件数で本人申請 | 元member ID/別clubの参照/連携済み/無効化グループ/anonを拒否。限定DTOに内部ID/他グループ情報なし | 0055適用後 |
| H08 本人同意/`review_player_profile_link` | recipientの最新tokenで1回承認、再試行で重複統合なし | 管理者/他人承認、古いtoken、同意後のB所属/履歴変更、失効/取消済みを拒否。管理者取消は既存通り可 | B1受入 |
| H09 `PATCH club_members`＋`Prefer: return=representation` | main/subの許可対象の役職/在籍更新・復帰 | 一般/B/退会/anon、サブのメイン操作、profile_id/player_profile_id変更を拒否。必要なRETURNING行/列が欠落しない | B0/B1互換、B2受入 |
| H10 `PATCH player_profiles`＋RETURNING | 本人の詳細/許可管理者の未連携名編集 | 他人の連携済み編集/linked_auth_user_id等の改変を拒否。新しい公開SELECTで補完しない | B0/B1互換、B2受入 |
| H11 新名簿/候補/戦績RPC | A在籍者の必要情報、イベント対象側だけの候補、退会者履歴 | outsider/B/departedの内部情報拒否、無関係club/event組、非公開グループ/無効profile拒否。式は変更しない | 0054/0055適用後 |
| H12 共有名RPC/実REST | anonがE-Sの有効トークンだけで名前・結果を閲覧 | tokenなし/停止/他イベントtoken/進行中/削除済みは拒否。既存共有ヘッダー条件も維持 | 0054適用後 |
| H13 グループ初期所属 | 新グループで本人owner→main所属INSERT→詳細取得 | 他人owner/ID組、ロール昇格、別グループINSERTを拒否。変更前後に同じ専用fixtureを比較 | B0/B1互換、B2受入 |
| H14 保存/統合不変性 | fixtureの通常/手動/チーム/公式、名前/出欠、スコア保存・再編集 | 申請/拒否/取消でスコア不変。承認は許可された参照統合だけで得点・試合・戦績が変わらない。未整合形式は未検証 | 構造整合後 |

## 7. 停止条件と報告区分

ref/対象の不一致、最新カタログ未取得、5関数の意味差未解明、既存行/ACLの想定外変化、
復旧不能、未知FK/trigger、試験に既存データを混ぜる必要がある場合は適用へ進まない。
実HTTPで漏えい/認可回帰があればその段階を停止する。旧表へのフォールバックや権限緩和で解消しない。

今回：**適用/試験計画とmetadata-only SQLを作成、SQLは合成DBで検証**。
未完了：両DBの最新実カタログ照合、確定したステージング差分SQL、復旧リハーサル、Authユーザー/fixture作成、
B0/B1/B2のHTTP全件。過去PGliteの49件等を今回のHTTP成功として数えない。
PR #265はDraft、Issue #264は未完了を維持。本番SQL・ステージングMigration/Auth作成・マージ・デプロイなし。

## 8. この準備工程で実行した確認

- `node --test tests/group-http-preflight.test.cjs`：1件成功。READ ONLYのメタデータ照会を架空PGliteで実行し、
  アプリ行・メール・Migration statements・関数本文のsentinelが返らないこと、列ACLと関数EXECUTEの区別、元データ不変を確認。
- `git diff --check`：成功。`03_link_detail_candidate.sql`は98598dfから変更なし、末尾ROLLBACKも維持。
  SHA-256：`a5d0890da7176dcedefac0279f54d3af4816b47dd8c698487501955ec2771062`。
- アプリ/依存/ビルド設定/過去Migrationは変更なし。TypeScript・Cloudflareビルドは98598dfの成功記録を参照し、
  今回は再実行していない。実Auth/HTTP試験や今回の実DB照合が成功したという意味ではない。
