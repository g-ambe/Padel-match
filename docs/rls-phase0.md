# RLS Phase 0：影響調査と段階適用計画

調査日：2026-10-30（JST）。対象：g-ambe/Padel-match、main `0350eed479959989516c2b9bb11b44ebf323aebe`。
本番：padel-hub / `ntczrmvffmpjzilfebyi`。本番ではREAD ONLYトランザクションによるメタデータ参照と件数集計のみ実施。DDL・DML・権限変更・ユーザー偽装テストは未実施。ステージングは利用していない。

## 結論

`dev_all_*` の一括削除は行わない。対象8テーブルには RLS が有効だが、anon / authenticated 対象の PERMISSIVE ALL USING(true) WITH CHECK(true) が残る。authenticated は8テーブルすべてで SELECT/INSERT/UPDATE/DELETE のテーブル権限も持つ。別グループを拒否する行条件がなく、トリガー・制約を満たす操作は許可され得る。anon は8テーブルすべてでSELECT権限を持ち、書込み権限はない。したがって匿名の非公開データ閲覧も対策対象。

制限ポリシーの追加だけでは解決しない。PERMISSIVE は OR 合成されるため、無条件許可が残る操作は制限されない。

通常運営には一般メンバーの参加者編集・Round生成・結果保存・開催終了/再開が含まれる。既存の events UPDATE ポリシーは主に管理者・グループなし開催作成者向けであり、dev_all_events をそのまま削除すると通常運営を壊す。

## 調査根拠

本番定義を `rls-phase0-evidence.json` に保存した。ポリシー全件、対象テーブルの権限・カラム、対象テーブルのユーザートリガー、関連する既存権限関数、public の外部キーを収録。個人の行データ・認証キーは含めていない。実施直前に再取得して差分を確認する。

| テーブル | 実装上の利用と注意 |
|---|---|
| clubs | ホーム・公開グループ検索・作成・設定・論理削除。作成直後、所属登録前に `.select(id)` が必要。SELECTを所属だけにすると初回作成が失敗する。owner_idの変更禁止トリガーあり |
| events | 一覧・作成・終了/再開・名前/コート数・共有・論理削除。auto/manual/teamで運営者が異なる。論理削除はDELETEではなくUPDATE |
| event_participants | 定常/臨時参加者追加、休憩/復帰、ゲスト名変更、履歴/共有表示。選手参照トリガーあり |
| rounds | 生成・削除・番号再調整、共有で番号表示。UPDATEも必要 |
| matches | 生成・完了フラグ・動画URL・削除。event_idとround_idの親イベント一致を確認する必要あり |
| match_players | 組合せ登録、選手変更時にDELETE→INSERT、共有/ランキングの埋込み取得。participant_idのイベント一致も必要 |
| match_results | スコア保存はINSERTまたはUPDATE、その後matches.completedを更新。削除でも利用。単一操作変更でも一連の保存を確認する |
| player_stats | app/libに直接の読書き呼出しは検索上なし。0039の統合処理が参照する。現在1行。未使用として削除・再集計しない |
| padel_facilities | anon/authenticatedにSELECTだけのdevポリシー。施設マスタの公開閲覧は妥当な可能性が高い。グループデータと同じ制限を機械適用しない |

主なコード根拠：`app/events/[id]/page.tsx`（244行以降の権限読込、753/775行の終了・再開、803行以降の結果保存、859行以降のRound再採番、941行以降の削除、1116行以降の生成、1285行以降の選手変更、1303行の論理削除）、`lib/event-courts.ts`、`lib/event-participants.ts`、`lib/stats-history.ts:31`、`app/groups/new/page.tsx:36`、`app/groups/discover/page.tsx:35`、`app/share/events/[token]/page.tsx:46`。

クライアントは `lib/supabase.ts` の公開キーとログインセッションでDBに直接アクセスする。`app/api/rounds/generate/route.ts` は組合せ計算のみでDB更新しない。UIのボタン制限だけではAPI直接アクセスを防げない。

## 先に解決する境界条件

1. 所属認定は club_members.is_active と本人IDを使用。player_profiles.linked_auth_user_id 経由と旧 club_members.profile_id 経由を維持する。選手IDやイベント参加者であることだけをログイン権限にしない。本人連携の再設計を混ぜない。
2. グループなし開催は18件、うち作成者なし6件。作成者なしの扱いが決まるまで、これらに影響するSELECT変更を適用しない。自動補完・一括移管は行わない。
3. teamモードはevent_team_sidesの両チーム所属を参照する既存関数がある。events.club_idだけに絞ると相手側の閲覧・運営を失う。auto/manualと分けて確認する。
4. 通常の一般メンバーに許可するevents UPDATEの列を明確化する。終了/再開を許可しても、club_id/created_by_auth_user_id/event_modeの付替えや管理専用の共有・削除を同時に許可してはならない。RLSは基本的に行単位なので、列間のOLD/NEW比較が必要な場合だけ最小のガードを検討する。一般メンバー向けの広いUPDATE条件を追加するだけで済ませない。
5. 共有ページはanonでevents・参加者・試合・結果・Round・選手名を直接取得する。現行の共有SELECT条件は「終了＋共有有効＋token非NULL」で、tokenを知る人だけに限定する認可ではない。フロントのeq(share_token)は列挙防止にならない。「共有対象は公開情報」か「リンク所持者限定」かをSELECT改修前に決める。後者なら限定された取得経路が必要になるため別段階で設計する。ログイン状態の共有リンクも検証する。
6. 本番のmatches→roundsのイベント不一致、match_players→参加者のイベント不一致は現時点で各0件。将来の不正参照を防ぐWITH CHECKは必要。親IDのNULLも不用意に許可しない。
7. clubs/events/rounds/matchesにはON DELETE CASCADEがある。親DELETEを許すと子の個別RLSだけでは保護できない。物理DELETEは特に慎重に扱う。許可済み操作で他グループへ親を移せないことも確認する。
8. club_members/player_profiles/profiles、team関連・動画関連ポリシーやRPCも閲覧経路になる。対象8テーブルだけでアプリ全体の隔離完了とは宣言しない。publicの通常ビュー・マテリアライズドビューは今回0件。既存SECURITY DEFINER関数の全経路監査は未完了。

## 段階計画

以下は順番の提案で、適用承認ではない。各段階の内部も1テーブル・1操作ずつ結果を確認する。

| 段階 | 内容 | 次へ進む条件 |
|---|---|---|
| 0 | 現状定義・コード依存・例外・権限表の整理 | 作成者なし開催、共有の公開範囲、一般メンバーの運営範囲を確認 |
| 1 | 最初の候補：clubs UPDATEを自グループ管理者・スーパー管理者に限定。所有者の扱いを既存UIと照合 | 同グループ管理者の設定/論理削除が可能、一般/他グループからの変更を拒否。所属権限への波及を点検 |
| 2 | clubs INSERT/DELETE、events INSERT/DELETEを個別に整理 | 作成→戻り値取得→所属登録、公開検索、物理削除経路に回帰なし |
| 3 | 通常運営の書込みを event_participants → rounds → matches → match_players → match_results の順を基本に個別制限。各表内の操作順はSQL提示時に確定 | 一般メンバーの生成・選手変更・スコア保存・削除が一連で成功。他グループ・無効所属・親付替えを拒否 |
| 4 | events UPDATE：一般メンバーの終了/再開を維持し、管理専用列と所属先付替えを保護 | 名前/コート数/共有/論理削除の既存管理権限も確認 |
| 5 | player_statsの書込み権限を1操作ずつ整理 | 外部利用・統合処理への影響を確認 |
| 6 | SELECTをeventsと子表、clubs、player_stats等で個別制限 | 全参照経路・共有・ランキング・公開グループ検索を確認。作成者なし開催の扱い確定 |
| 7 | padel_facilitiesの公開仕様確認と開発名称の整理、残存の直接/RPC経路確認 | 公開する情報と非公開情報の境界が説明できる |

最初にclubs UPDATEを選ぶ理由は、試合の連続保存より影響を限定しやすく、他グループ設定の改変を防げるため。最終順序は権限表と適用SQLをレビューして確定する。SELECTは読取り漏えいを防ぐため必須であり、後回しのまま完了にしない。依存する親のSELECTを先に変える場合は子ポリシーのサブクエリへの影響も再確認する。

## 1操作ずつ変更する方法

各表で初回だけ、既存ALLをSELECT/INSERT/UPDATE/DELETEの4本へ等価分割する準備が必要。対象操作は制限付きへ置換し、残り3操作は元と同じ許可を一時維持する方法を基本案とする。DROPとCREATEは同一トランザクションで行い、無保護期間や途中コミットを作らない。等価分割だけを別工程にする場合も本番変更として承認を得る。

既存の他のPERMISSIVEポリシーが広ければ、対象操作のdevポリシーだけを狭めても制限できない。操作ごとに全適用ポリシーとGRANTを確認する。既存条件・role・WITH CHECKを省略せず取り扱う。長期のRESTRICTIVE上乗せで複雑化する方法は現段階の基本案にしない。

各変更の成果物を必ずセットにする：

- `apply.sql`：対象プロジェクト・テーブル・操作・事前定義チェック・短いlock_timeout・BEGIN/COMMIT・期待する差分。
- `rollback.sql`：適用直前のポリシーを正確に再現し、その変更で作った定義だけ戻す。他段階を巻き戻さない。切り戻すと既知の許可範囲も戻ることを明記。
- `verify.sql`：変更前後の定義・権限・想定アクセス範囲を読取り確認。
- 検証表：一般/管理者/他グループ/無効所属/anon/グループなし作成者/スーパー管理者、正常/拒否、結果、未検証事項。

Phase 0では適用候補SQLをまだ確定していないため、変更SQL・切り戻しSQLを本番投入可能として配布しない。次の1操作の準備時点で両方を具体化し、レビュー後に承認を求める。新しいマイグレーションを自動適用する仕組みも追加しない。

## 本番を壊さない検証と停止条件

まず読み取りで候補条件が返す許可/拒否の件数、RLS再帰、参照関係、EXPLAIN（ANALYZEなし）を確認する。ただし条件のSELECT確認だけでは実際のDML拒否を実証できない。

書込みの許可/拒否テストはローカルの最小スキーマ・合成データで行う案を基本とし、本番データを複製しない。ローカル環境の可否は未確認。準備できない場合は本番の既存行を変更するテストで代替せず、未検証として明示し、専用検証データの利用可否を別途確認する。本番データに対するUPDATE→ROLLBACKや無変更UPDATEも破壊的テスト回避の代替にはしない。

本番適用はSQL・切り戻し・検証結果を提示した後、対象1操作について明示的承認を得て実施。通常運用の保存結果は、UI表示だけでなく再読込と対象ID/件数で確認する。0行更新・0行削除・空配列・埋込み子データの欠落も失敗として判定する。SQL Editorの管理者接続成功やservice_role成功を一般ユーザーRLS成功とみなさない。

一般メンバーの正常運営不能、他グループ許可、共有/ランキングの欠落、定義ドリフト、予期しないロック・遅延があれば次の変更を止める。適用承認時に障害時の当該rollback.sql実行権限も確認しておき、復旧後に原因を調査する。

## 開発経緯と未検証事項

過去チャット「セキュリティレビュー確認」によると、PR #160はRLS・本人連携・戦績保存など範囲拡大、実環境確認不足、DBとコードの切り戻しの難しさからマージせず終了した。過去報告の91試合/122行の重複は今回再検証しておらず、この改修で削除・修復しない。現在のmainと本番定義を基準とし、古いPRの一括移植は行わない。

Security Advisorには関数のsearch_path、SECURITY DEFINERの実行権限等の指摘あり。これだけで全関数が脆弱と断定しない。関連する権限迂回経路は別途確認する。参考：[関数実行権限](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)、[search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)。

今回は文書・定義スナップショットのみ。アプリ実装・マイグレーション・本番設定は変更していない。TypeScript/Cloudflareビルド、ブラウザ操作、実ユーザーのAPIによる許可/拒否確認、性能試験、公開API設定と全関数経路の監査は未実施。現在のmainが本番配備コードと一致するかも未確認。

公式根拠：[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[PERMISSIVEのOR合成](https://supabase.com/docs/guides/observability/advisors?queryGroups=lint&lint=0006_multiple_permissive_policies)。changelog.mdの取得はWebツールのContent-Type制約で未完了。実装段階で再確認する。
