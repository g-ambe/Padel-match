# TASK-08 / P0-H23：匿名閲覧遮断を壊さず本番へ移行するための互換性ゲート

作成日：2026-11-20。根拠は Issue #264、#215、既存 H20 監査 `96_h20_prod_cutover_readonly_gate.sql` と `97_h20_preproduction_security_readiness.md`、実Stage/Prodの匿名ACL・DBスキーマREAD ONLY結果、GitHubの既存Migration 0040～0065現物。

**本書は本番作業の許可ではない。** 既存Draft PR #265/既存ブランチ `codex/task-08-group-foundation`のみ更新。ProdのCREATE/ALTER/GRANT/REVOKE/UPDATE/DELETE、Cloudflare本番デプロイ、mainマージ、PRをReady for reviewに変更する操作は禁止。DB＝GPT、アプリ改修＝Codex、最終本番承認＝ユーザー。

## 1. 今日確認した再現可能な差分

**同じSQL** `103_p0_stage_prod_parity_readonly.sql` を StageとProdで`BEGIN READ ONLY ... ROLLBACK`実行。実データの名前・ID・メール・トークンは取得せず、オブジェクト有無、SELECT権限、集計件数のみ。

| 項目 | Stage | Prod |
| --- | --- | --- |
| 重要12表へのanon SELECT列権限 | すべてなし | すべてあり（行可視性はRLSと別途確認） |
| 新しい公開グループ名簿/人数・オーナーRPC | あり | なし |
| `0040`固定ペアのpublic 3表 | なし | あり |
| `0041`ラウンド処理のpublic 2表 | なし | あり |
| `0048`画像/非公開本人情報のpublic 4表 | なし | あり |
| `0047`チーム動画保存・`0049〜0051`本人画像/ホームコートRPC | なし | あり |
| `padel_facilities`の`0051`追加5列 | なし | あり |
| 施設マスター行数 | 9 | 24 |
| `user_preferences.tutorial_status` | 2026-11-20にStageへ適用 | あり |

実Prodの**匿名ロールでの行可視性**はH20にて本文を取得せず実測：`club_members`41、`player_profiles`26、`profiles`7、`official_events`1、`official_matches`12。今回のSQLはGRANTの有無が中心のため、全行が第三者に返却されると断言する用途には使わない。**P0は引き続き実在し、まだ修正されていない**。

**既存利用データを持つProd専用機能**も集計のみで実測：
- `event_fixed_pair_state`8行、`event_fixed_pairs`2行、`event_fixed_pair_rounds`64行。
- `friendly_match_operations`89行、`friendly_round_lineup_state`0行。
- `player_profile_private`1行、`profile_media_objects`1行、`profile_media_operations`1行、`profile_media_attempts`1行。
- 通常イベント89行、公式イベント4行。**既存データの移行・削除・再生成は許可されていない**。

### Migration履歴は別基準

Stageの`supabase_migrations.schema_migrations`は初期 `0001〜0039`復元＋`0054〜0065`Stage先行などにより、Prodの`0047〜0053`＋追加の既存RLSパッチとは履歴の構成が異なる。単にversion名が無いことだけで旧SQLを再適用してはならない。**オブジェクト有無、実関数定義、列、制約、RLS/GRANT、データ件数を現物確認**する。

## 2. 安全な実施順序：Stage（GPT主担当）

1. **現状のREAD ONLYゲートを保存・再実行**：`103`と`96`で非公開情報のanon拒否、グループRPCの存在、既存機能パリティ不足を確認。Stage/Prodそれぞれの行数のみをバックアップ計画に採用。
2. **今回すでに実施した小規模補完**：既存 `0046_user_preferences_tutorial_status.sql` の`ALTER TABLE`をStageで`BEGIN/ROLLBACK`検証後、Stageにのみ`task08_stage_0046_tutorial_status_parity`として適用。事後READ ONLYで`tutorial_status DEFAULT unseen`とCHECK制約、Stage clubs3/members12/profiles12/events0を確認。Prod未変更。
3. **固定ペア・ラウンド操作（0040→0041→0042→0043）を別ゲートにする**。原本`0040`と`0041`は`SHARE ROW EXCLUSIVE`のテーブルロック、既存ACL/RLS/Trigger差分の整合検査を含み、手動バックアップ・復元確認を要求。`0042`は`lineup_private.release_control.editing_enabled=false`条件、`0043`は一試合複数結果が0件である条件。**この順序を変えず、DB外バックアップと事前ROLLBACK受入後にStageのみ適用を判断**。Prodで存在する実プレイヤー・実履歴をStageに無断コピーせず、合成fixtureで試す。
4. **プロフィール非公開・画像関連（0048→0049→0050→0051）は別ゲート**。`0048`の`profile_media_private.settings.commit_secret_sha256`、公開/非公開画像操作のR2認可・GCはアプリとsecret連携が必要。Stageに実シークレットや本番画像をコピーしない。Stage専用の値とR2テスト設定、画像削除の安全性を確認してから順次適用する。`0047`動画保存関数も既存イベントの役職判定・API動作を検証。
5. **施設データ（0052→0053）は本番の実データを無断上書きしない**。Stageの施設9件、Prodは24件。`0052`既存9件の名前・住所・元データ検査、`0053`移行履歴と追加15件の一意性検査があり、`0051`のDDL整合・施設マスターの事前スナップショットが前提。元資料との差異があれば止め、推測補完しない。
6. **既存アプリ機能回帰**：匿名トークン共有正常/不正・公式/通常/チーム戦・在籍/ゲスト・固定ペア・ラウンド・ScoreInput/GP・匿名によるbase table拒否、本人画像/R2専用操作、ユーザー設定、グループ3タブ・H15〜H22、メール/プロフィールリンク権限を**Stage実Auth/API、合成ブラウザおよび実プレビューの別項目**で確認。既知プロフィール回帰12失敗は全PASSの妨げとして別管理し、勝手に「問題なし」としない。

## 3. アプリ消費者を固定し、Prodでは順序を守って切り替える

**Codex担当**：`app/share/events/[token]`／`app/share/official-events/[token]`、`app/groups/discover`、`app/groups/[id]`、`lib/group-read.ts`、`lib/player-profiles.ts`、`app/events/[id]`、`app/official-matches/[id]`、固定ペア・R2画像の既存API/コンポーネントを調べ、**匿名 vs 認証済みの各読取/書込入口ごとに依存テーブル・RPC・返却データを行番号つきで列挙**。実装済RPCがあれば必ず再利用。改修が不要な場合は不要理由を書き、勝手なRLS変更・広域RPC新設はしない。既存の3タブ/スコア/戦績・画像は無断変更しない。

**GPT担当**：Codexの消費者一覧とStage本物のSQLを照合。匿名で見せてよいのは、明示共有されたtokenの最小DTOや、本人が承諾した公開グループ別名など**確定仕様内**のみ。ユーザーアカウント・プロフィール名・参加者ID/役職・戦績・画像キー・token原文は公開しない。匿名base tableアクセスをなくしても認証済みの編集/運営を維持するため、必要な認証済み列GRANT/既存RPCを切り分ける。

**ユーザーによる明示承認後に初めてProd変更可能**：
- 影響範囲とDB外バックアップ/復元手段を確認。
- 先に本番へ互換RPC/必要な列を追加する段階と、アプリがそのRPCを使う段階を分離。
- 実アプリが新しい経路へ切り替わってから、最後に旧匿名SELECTを最小限でREVOKE/Policy閉鎖。**単独REVOKEは既存画面の機能停止につながる**。
- 各段階で元の認証済み運営が使えることと匿名base tableが拒否されることを検証し、失敗時は新アプリとDB権限の依存関係に沿って復旧する。以前のアプリへ戻すだけでは新RLS下で動かない可能性がある。

## 4. 正式な現時点のゲート判定

- Stage：**匿名アクセス保護は成立／Prodの固定ペア・画像・施設マスターの互換性が未再現**。
- Prod：**実運用の固定ペア・画像は存在／安全なグループRPCと匿名SELECT遮断が未導入（P0継続）**。
- したがって**PR #265はDraft維持・mainマージ不可・Prod DB適用不可・Cloudflare本番公開不可**。
- 既存固定ペアと画像の使用行が本番に存在するため、StageのDDL差分を直ちに本番のテーブルDROP/初期化で「一致させる」案は禁止。

次にGPTが着手するのは`0040〜0043`のStageバックアップ・差分・適用前チェックと`0048`のStage-only secret/R2テスト依存の切り分け。**Codexへは今はアプリ改修ではなく、匿名/ログイン済のデータ消費者棚卸しだけを依頼**する。ユーザーが指示した優先順位1（P0）に専念し、H21/H22実機、公開開催DTO、R2の新規拡張はその後。
