# TASK-08-03／H16：Codex引継ぎ（グループ別表示名・公開名簿）

**2026-11-20。正本：Issue #264、既存Draft PR #265 / `codex/task-08-group-foundation`。DB担当：ChatGPT。アプリ実装担当：Codex。**

## 前提・DB完了状況

- `supabase/migrations/0056_club_scoped_display_names.sql` を同PRに追加し、**STAGINGのみ** `task08_stage_0056_club_scoped_display_names` で適用済み。Prod未適用、Cloudflare配信・mainマージは禁止。
- Stageの現物は `club_members.club_display_name text NULL` と `club_display_name_public_confirmed_at timestamptz NULL` を持つ。**旧名は一括バックフィルせず全12行NULL**のまま。
- 新RPC `public.save_club_member_display_name(p_club_id uuid,p_member_id uuid,p_display_name text,p_expected_club_display_name text DEFAULT NULL,p_public_confirmation boolean DEFAULT false)` は `authenticated` のみ呼び出し可。`anon`/他人/非active/別グループは拒否。成功時 `{ member_id, club_display_name, public_name_confirmed }` JSONを返す。更新内容は当該 `club_members` 行の表示名・公開確認時刻だけ。
- 連携済み選手は本人だけが編集可能。publicグループでlinked本人が保存する場合 `p_public_confirmation=true` が**必須**。privateグループで保存した場合は表示名のみで、公開確認は登録されない。既存の未連携選手はメイン/サブ管理者が既存対象役職制限内のみ編集可（サブ管理者→メイン管理者不可）。
- `p_expected_club_display_name` は保存前の **raw `club_display_name`** を渡す。NULLの初回保存では `null`、競合/古い状態は `40001` で拒否。本人プロフィール名をCAS値として送らない。
- `get_club_roster(uuid)` のシグネチャは変更していない。各行の既存 `player_profiles` JSON内に **`club_display_name`（string|null）** と **`public_name_confirmed`（boolean）** が追加。元の `player_profiles.display_name` は本人プロフィール名であり変更されていない。
- `get_public_club_directory(uuid)` は以前どおり `reference,display_name,is_unlinked` **3列だけ**。未連携者は `club_display_name ?? player_profiles.display_name`、連携済み者は**本人がpublic公開確認済みの`club_display_name`だけ**を返す。旧linked+NULL/未確認の行は公開DTOから省き、本人プロフィール名や一律「メンバー」仮名は公開しない。役職、UUID/auth ID、メール、画像、個人戦績は出さない。

## Codexに依頼するアプリ実装（この範囲だけ）

1. `AGENTS.md` を守り、**既存ブランチ・既存Draft PR #265だけを更新**。新規PR/新規main派生ブランチ・DBの本番適用・本番デプロイ・mainマージ禁止。PR #265で先にGPTが追加した`0056`とSQL `64_h16_club_display_names_rollback_probe.sql`は書き換えない。
2. `lib/group-read.ts` の `RosterMember.player_profiles` の型へ `club_display_name: string|null`、`public_name_confirmed: boolean` を追加。現在の `app/groups/[id]/page.tsx` のメンバー表示/編集のみに必要な変更をする。**`player_profiles.display_name`（本人プロフィール名）は別のまま保持**し、連携済みはグループ名と併せて **「グループ内表示名（本人プロフィール名）」** を在籍者に表示。alias NULLなら本人が設定できる入口を示し、グローバル名を勝手にaliasへ保存しない。
3. 編集権限：連携済みメンバーの編集UIは**本人だけ**。メイン・サブ・アプリ管理者が他人の連携済み名を編集できる導線は作らない。未連携者は現行の`canManageTargetMember`権限を維持。既存 `saveUnlinkedClubMemberName` は `player_profiles.display_name` を書き換えるため、**グループ内改名操作からは呼ばず、新RPCのみ使用**。他の画面・プロフィール本人編集・所属/ID/過去戦績に触れない。
4. 編集POPは既存 `AppDialog` 等の共通POPを再利用。publicグループでlinked本人が保存する前に、**「公開グループでは、この表示名がメンバー一覧に表示されます」** と明示して本人確認チェックを受ける（falseならRPCは保存拒否）。privateグループでは公開済み扱いにしない。キャンセルで破棄、保存失敗/競合(40001)ならPOP・入力を保持。読み取りは新RPCまたはロスターのみ。グループ間のalias隔離、退会/復帰時の扱いを維持。
5. 未所属者向け公開名簿は既存3列だけを使用。未確認の連携済み名前が**結果集合に存在しない**ことを前提に空欄・共通名への勝手な補完/他RPCへのfallbackをしない。未連携は従来の本人同意付き紐付け候補のまま。公開未所属へ役職/本人名/メール/写真/戦績を漏らさない。
6. 試合結果の旧不一致6件、既存GP、勝率/ランキング計算式、チーム戦/フレンドリーの確定仕様、既存本人退会/H15は変更しない。**今段階で全面的な新3タブ化や招待#262・10文字ID#263は混ぜない。**
7. 関連チュートリアル/使い方・ヘルプを実装状態に合わせて同PRで同期。TypeScript、関連軽量テスト、モバイル画面・ライト/ダーク表示、Cloudflare互換を確認。新UI/型の正負例、本人/他人/公開未所属/プライベート/NULL旧linked/各グループの独立性をテスト。
8. **重要な未完了依存**：#264で確定した「新規加入時の名前確認」「旧仮メンバー本人連携時のalias引継ぎ＋明示同意」「公開名簿の旧linked未確認者をどう完全移行するか」は、まだ既存の `join_requests`/profile_link同意snapshotとDB統合が完了していない。**仮の自動バックフィル・プロフィール名公開・マイグレーション推測追加で回避しない**。まず今回の既存所属メンバーの改名UIだけを実装し、加入・紐付けDBが必要な差分は具体的に記録してGPTへ返す。

## DB側で確認済み／残るゲート

- `64_h16_club_display_names_rollback_probe.sql` をStageロール切替で実行し、本人のpublic同意必須、他人linked編集拒否、サブのmain編集拒否、サブの仮一般編集可、一般の仮メンバー編集拒否、CAS競合、private非公開、同一選手の別グループ独立、`player_profiles.display_name`不変、旧linked匿名名簿へ未表示をPASS。全行ROLLBACK。
- 本番では現時点で `club_members` の匿名SELECT権限が残る。**0056に匿名SELECT未遮断の本番DBを拒否する事前ガードを入れてある。** 他P0・新RPC配信・7表匿名ACL切替とは別の正式順序が必要。本番適用は禁止。
- 実ブラウザでの表示/連携同意・過去データ移行、Stage実HTTPでの新RPC検証、合成テスト受入は残る。**PR #265はDraftのまま。**

**Codex実行後、変更ファイル、テスト/エラー、未対応のDB依存、既存PRのSHAを報告してください。**
