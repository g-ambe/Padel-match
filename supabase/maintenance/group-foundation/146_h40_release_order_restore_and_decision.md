# TASK-08 / H40：本番移行の実行単位・失敗時の復旧・アプリ/DB引継ぎ

2026-11-21。対象は既存Draft PR #265 / #264。全体進捗の正本は `142_h39_task08_app_db_master_status_and_release_sequence.md`。**これは未承認のリリース手順であり、本番SQL・マージ・Cloudflare配信を行っていない。**

## 今回実際に確定・作成したもの

- `143_h40_prod_release_impact_readonly.sql`：Stage/Prodに同じSQLを**READ ONLY**実行し、実在公開名簿とオーナー引継ぎの利用者影響を集計（個人情報は取得しない）。
- `144_h40_prod_preservation_snapshot_readonly.sql`：**本番専用 READ ONLY**。本番の試合・結果・固定ペア・プロフィール画像・施設等の件数を移行前後で比較できる。
- `145_h40_prod_phase2_atomic_cutover_candidate.sql`：本番切替が必要な **11ファイルの原本**を元に、最初と最後のトランザクション境界を除いて**単一BEGIN/COMMIT**へまとめた候補。元ファイルのGitHub SHAを各節へ記録。**11節、約88KB、BEGIN=1/COMMIT=1、SQLドル引用の対応に欠落なし**を静的に確認。**本番連続DDLの実実行・Postgresコンパイルは未検証**。将来の正式適用可否は別途判断する。

## 現行Prodの影響（READ ONLY実測）

| 指標 | 本番 |
| --- | ---: |
| グループ全件 / 有効 | 13 / 3 |
| 有効公開グループ | 2 |
| 公開グループの有効所属 | 14 |
| うち本人アカウント連携済み / 未連携 | 4 / 10 |
| 今回の0056で初期値NULL・自動同意なしとなる既存公開名簿の連携済み行 | **4（本人確認までは公開一覧から省く）** |
| 有効なメイン管理者がいない有効グループ | 0 |
| `clubs.owner_id`が在籍・有効`main_admin`と対応しない有効グループ | **1（個別確認が必要、自動修正禁止）** |
| イベント / 通常試合 / 結果 | 91 / 521 / 351 |
| 公式イベント / 公式試合 | 4 / 15 |
| チーム試合 | 8 |
| 固定ペア状態 / ペア / ラウンド | 10 / 2 / 78 |
| プロフィール画像オブジェクト | 1 |
| 施設マスター | 24 |
| Migration履歴 | 22 |

公開名簿の4人は、**本人がグループごとの公開表示名を決めて承諾するまで名簿に表示されない**。非公開にするユーザーの意図を守り、過去名・本人プロフィールから無断で一括補完しない。人数RPC `0065` は正確な14人とし、名簿表示行数と一致するとは限らないことをUIで説明する。

`owner_id`の1件は役職欠損と**断定しない**（有効メイン管理者は存在する）。新しい引継ぎRPCは自動でownerを変更しない。ユーザー／管理者による既存状態の確認と、必要な場合に限る管理権限整合を、**別の明示された操作**で行う。

## 本番への適用候補（確定実行しない）

| ゲート | SQL・順序 | なぜ分割するか |
| --- | --- | --- |
| 0. 前提 | `132_h37_prod_rpc_release_readonly.sql`、`135_h37_group_read_prerequisites_readonly.sql`、`140_h38_prod_cutover_readonly.sql`、**今回の143/144** | 既存関数、権限、データ保全を比較・記録。既存変更があれば止める |
| 1. 先行追加 | `54_h12_prod_compatible_rpc_candidate.sql` → `133_h37_prod_video_click_additive_candidate.sql` → `0054_group_read_interfaces.sql` → `0055_group_read_consumer_support.sql` | 旧アプリの匿名基底表権限/旧クリックRPCを残しつつ、新しい共有・グループ取得を準備 |
| 2. Owner準備 | `136_h38_prod_last_main_status_bridge_candidate.sql` → `137_h38_prod_self_withdraw_candidate.sql` | 既存のProdガードを維持し、statusのみ補完。新Owner RPCの前提を先に成立 |
| 3. 同時切替 | **`145_h40_prod_phase2_atomic_cutover_candidate.sql`**（内部は138→0057→0058→0059→0060→139→0061→0062→0063→0064→0065） | 表示名の匿名SELECT停止からOwner・加入・連携・人数まで1トランザクション。**途中失敗なら全件ROLLBACK**。旧画面との契約が変わるのでリリース時間帯を合わせる |
| 4. アプリ公開 | Cloudflare Workers/OpenNextの既存作業を確認した上でPR #265から新アプリ配信 | 新しいRPC/画面が揃った後に。**GitHub mainマージとCloudflare自動配信の関係は未確認**なので、確認せずmergeしない |
| 5. 後処理 | `20261121131943_task08_h35_legacy_video_click_anon_close.sql` | 新共有UIの正例確認後、旧3クリックRPCの匿名実行だけ閉じ、認証済み互換性は維持 |
| 6. P0終了判定 | 必要なanon基底表アクセスについて画面依存を最終確認し、プロフィール・イベント等の**残った匿名基底SELECT**を対象限定で閉じる | 現計画では`club_members`以外のProd anon権限も残る。**Step5まででTASK-08全P0完了とはしない**。無差別REVOKEや利用者データ変更はしない |

**注意：StageとProdの `supabase_migrations.schema_migrations` が非対称**（Stage74、Prod22）。既存 `supabase/migrations/0054〜0065` と本番専用 `maintenance` のまとめSQLをどのバージョンとして登録するか、**正式Migration台帳の整合方法が未確定**。まとめSQLを無登録で実行したり、あとで`supabase db push`して二重適用したりしない。**この点は実適用前のSTOP条件**。新しいPR/ブランチは作らない。

## 復旧の実際

| 失敗位置 | まず行うこと | 戻せる範囲 |
| --- | --- | --- |
| ゲート0で前提が違う | 何も適用せず中止 | Prod無変更 |
| ゲート1・2の追加SQLで失敗 | 該当トランザクションをROLLBACKし、旧アプリを配信したまま原因確認。既に確定した追加RPCは使わずに残すことも可能 | 旧RPC・旧匿名権限を変更しない。**関数DROPの無条件実行はしない** |
| ゲート3の11節の途中でエラー（COMMIT前） | **同一トランザクションをROLLBACK**。旧アプリのまま中止 | 未コミットの`club_members` ACL変更、表示名列、owner表/トリガー、RPC置換が同時に戻る |
| ゲート3がCOMMIT成功、Cloudflare公開前に異常 | **新旧アプリの契約差を確認。新アプリを無条件公開せず、復旧方針を選ぶ** | ここからはSQLをROLLBACKするだけでは元に戻らない。旧のリンク詳細RPC定義、anon権限、alias列、本人同意/owner表の扱いが必要 |
| 新アプリ公開後に不具合 | まず影響画面/契約を限定して修正か配信の切替を判断。単純な旧アプリへのロールバックがDB権限と不整合になる可能性を確認 | スコア・画像・他グループ・本人同意のデータを削除/上書きしない。**以前の匿名table-level SELECTを新しいalias列付き表にそのまま再GRANTすると新情報が漏れる**ため禁止 |

**重要：ゲート3の「単一トランザクション」はCOMMIT前の一部失敗防止。COMMIT後の旧アプリ復帰を保証しない。** 本番GO前に、旧アプリを動かせる互換性・限定した復旧SQLと切替手順を、実際の本番DB定義/Cloudflare配信動線で確認してからユーザーの本番承認を得る。リリース窓で一定時間のグループ画面停止があり得ることも先に明記する。

## リリース判定に必要な最小検証

- StageのH34共有実HTTP/375px Chromium + H15/H19正負例は既にPASS。**今は専用fixture回収済み**。
- 本番に存在する固定ペア/プロフィール画像/公式戦/施設マスターはStageに同じ形でないため、**Stage全PASSという主張はしない**。本番反映の直前/直後、144で件数を比較し、認証済み試合管理・得点・GP、固定ペア、公式/チーム戦、プロフィール本人画像、グループ加入/本人退会/オーナー・共有リンクの少数代表操作だけ確認する。
- 公開2グループのlinked4人の一時非表示は承認なし公開しない現仕様によるもの。公開の表示名を入力/同意する導線の告知が必要。
- 未解決：Owner条件1件、Migration履歴、Cloudflare配信/戻し方、ゲート3全DDLをProd互換スキーマで試したことの証拠、P0中核の残余anon表権限。**この状態でPR #265をReady化/マージ・本番適用しない**。

## TASK-08全体は別管理

- #264のアプリ主要機能は既存PRに実装済み。ただし同グループ在籍者に限定したプロフィール画像表示、公開未所属者の直近開催は未実装/仕様未確定。
- #262のメール招待は別子タスクで未実装。
- #263の10文字ユーザーIDはTASK-07-04であり、TASK-08の出荷条件に含めない。
- Codexは今のSQL/台帳整備には不要。アプリの新規画像機能や本番切替で判明した実装不整合のみ既存PRに対象限定で対応。

## 今回の変更範囲

GitHubの既存PR #265に`143`、`144`、`145`、本書を追加。Prod / StageデータはREAD ONLYのみ。main/Cloudflare/PRのDraft状態変更・本番SQL適用なし。

## Cloudflare Worker 自動デプロイの実設定確認（READ ONLY追記）

Cloudflare WorkerのBuilds Trigger APIを**GETだけ**で実確認（対象Worker `padel-match`、`padel-match-staging`。build token等は記録しない）。

- **Prod `padel-match`**：Trigger `Deploy default branch`、GitHub `branch_includes=[main]`、`build_command=npm run cf:build`、`deploy_command=npx wrangler deploy`、有効。**PR #265をmainにマージすると本番自動デプロイが起動し得る**。そのため、DB契約が整う前にマージしない。
- **Stage `padel-match-staging`**：GitHub `branch_includes=[codex/minimal-security-replacement]`、`build_command=npm run cf:build:staging`、`deploy_command=npx opennextjs-cloudflare deploy --config wrangler.staging.jsonc`、有効。**現TASK-08ブランチ `codex/task-08-group-foundation` はStage自動ビルド対象ではない**。Stageの最新デプロイがPR #265の現HEADであると仮定しない。
- **復旧の追加条件**：Workerのコード版を戻せても、Supabase DBの適用済みDDL/RLSは自動で戻らない。復旧前に旧Workerが現在のDB契約で動くか確認する。旧匿名 `club_members` SELECTを単純再付与すると、追加後の`club_display_name`まで直接公開されるため**単純GRANTによる復旧は禁止**。
- 本確認はGETのみ。Cloudflare Trigger変更・ビルド起動・Worker deploy/rollbackは**一切行っていない**。Branch/Build設定の変更も本番適用のユーザー承認後に検討。
