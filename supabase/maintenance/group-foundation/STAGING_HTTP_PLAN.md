# TASK-08-03 / P0：既存ステージングの実Auth・HTTP試験準備

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
