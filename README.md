# Padel Club App (Phase1 MVP)

Cloudflare Pages + Next.js App Router + Supabase を前提にした、パデルクラブ向けリアルタイム運用アプリのMVPです。

## セットアップ

1. `.env.local` を作成
2. 以下を設定

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

3. インストールと起動

```bash
npm install
npm run dev
```

## 実装済みMVP要素

- 日本語UI（ログイン / ホーム / 開催詳細 / 試合詳細 / ランキング / プロフィール）
- Edge Runtime対応のRound生成API（`/api/rounds/generate`）
- 公平性重視の簡易ラウンド生成ロジック
- Supabase初期スキーマ（profiles, clubs, events, matches など）
- ダークテーマのモバイルファーストUI

## Cloudflare Pages対応

- Node.js専用API（`fs`, `child_process`）は未使用
- fetch / Supabase SDK前提


## Supabase SQL実行手順（初期スキーマ）

1. Supabaseダッシュボードを開く
2. `SQL Editor` → `New query`
3. `supabase/migrations/0001_init.sql` を貼り付けて実行
4. `supabase/migrations/0002_beta_match_ops.sql` を貼り付けて実行
5. `supabase/migrations/0003_schema_rls_setup.sql` を貼り付けて実行

これで以下テーブルが作成・更新されます。
- profiles
- clubs
- club_members
- events
- event_participants
- rounds
- matches
- match_players
- match_results
- player_stats


### 追加マイグレーション（イベント終了機能）

`events?select=court_count,status` で 400 が出る場合は、`events.status` が未作成の可能性があります。Supabase SQL Editor で `supabase/migrations/0005_events_status_backfill.sql` を実行してください。


### 追加マイグレーション（複数グループ/定常メンバー/臨時メンバー対応）

Supabase SQL Editor で `supabase/migrations/0006_group_member_guest_model.sql` を実行してください。

このSQLで以下を強化します。
- イベントは1グループ（club）に必ず所属
- 定常メンバーはグループ単位で一意
- 参加者を `member` / `guest` で明示
- 臨時メンバー（guest）はイベント単位
- 累積成績はグループ単位（club_id + profile_id）で一意


## テストユーザーでのログインとWytel部活紐づけ

### 1) Authユーザー作成（Supabaseダッシュボード）
1. Supabase Dashboard → Authentication → Users → Add user
2. 以下で作成
   - email: `testuser01@example.com`
   - password: `test0001`
3. 作成後、Users一覧で `id`（UUID）をコピー

### 2) SQL Editorで実行（プロフィール + グループ + 所属）
以下SQLの `YOUR_AUTH_USER_ID` を置換して実行してください。

```sql
insert into profiles (id, display_name)
values ('YOUR_AUTH_USER_ID', 'testuser01')
on conflict (id) do update set display_name = excluded.display_name;

insert into clubs (name)
values ('Wytel部活')
on conflict do nothing;

insert into club_members (club_id, profile_id, role)
select c.id, 'YOUR_AUTH_USER_ID', 'member'
from clubs c
where c.name = 'Wytel部活'
on conflict do nothing;
```

### 3) 動作確認
- ログイン画面で以下を入力してログイン
  - メール: `testuser01@example.com`
  - パスワード: `test0001`
- `/home` へ遷移できればOK

> 補足: Supabase Authユーザー作成とSQL実行は、GitHub→Cloudflare自動deployだけでは完結しないため、初回のみ手動作業が必要です。


### 追加マイグレーション（選手プロフィール分離）

以下の手順で手動実行してください（GitHub→Cloudflare自動deployではDB変更は反映されません）。

1. Supabase Dashboard → SQL Editor → New query
2. `supabase/migrations/0007_player_profiles.sql` の内容をコピーして貼り付け
3. 実行順: `0001` → `0002` → `0003` → `0005` → `0006` → `0007`
4. 実行後確認:
   - `player_profiles` テーブルが作成されている
   - `clubs` に `Wytel部活` がある
   - `player_profiles` に 青木/今野/神田/蓮見/赤木/安倍/瀧田/神原 がある
   - `club_members` に上記8名が `Wytel部活` のメンバーとして紐づいている


### 0007/0008実行時に `participant_type` / `player_profile_id` が無いエラーが出た場合

既存DBの適用順が前後している場合に発生します。以下の順で実行してください。

1. `supabase/migrations/0006_group_member_guest_model.sql`
2. `supabase/migrations/0008_fix_0007_participant_type_dependency.sql`
3. `supabase/migrations/0007_player_profiles.sql`（再実行）

確認ポイント:
- `event_participants.participant_type` が存在する
- `event_participants.player_profile_id` が存在する
- `participant_type` が `member` / `guest` のみ
- `event_participants_member_or_guest_check` 制約が存在する
- `player_profiles` テーブルが存在する


### 参加者名が「メンバー名未設定」になる場合の補正

Supabase SQL Editor で次を手動実行してください。

1. `supabase/migrations/0009_backfill_member_profile_links.sql`

推奨実行順（未適用がある場合）:
- `0006_group_member_guest_model.sql`
- `0008_fix_0007_participant_type_dependency.sql`
- `0007_player_profiles.sql`
- `0009_backfill_member_profile_links.sql`

確認ポイント:
- `club_members.player_profile_id` が Wytel部活メンバーで埋まっている
- `event_participants` の `participant_type='member'` 行で `player_profile_id` が埋まっている
- 開催詳細の参加者欄に 青木/今野/神田/蓮見/赤木/安倍/瀧田/神原 が表示される


### 参加者名が「メンバー名未設定」になる（player_profilesが空配列）場合

`player_profiles` にRLS policyが無いと、APIが `200` でも `[]` を返すことがあります。以下を Supabase SQL Editor で実行してください。

1. `supabase/migrations/0010_player_profiles_rls.sql`

確認ポイント:
- `pg_policies` に `player_profiles` の `dev_all_player_profiles` がある
- ブラウザNetworkの `/rest/v1/player_profiles?...` が `[]` ではなく名前データを返す
- 開催詳細の参加者欄で定常メンバー名が表示される


### グループなし開催を有効化する場合

Supabase SQL Editor で以下を手動実行してください。

1. `supabase/migrations/0011_events_club_id_nullable.sql`

確認ポイント:
- `events.club_id` が nullable になっている
- ホームの開催作成で「グループなし」を選択して作成できる

## グループ戦績設計メモ（次タスク向け）

- グループ累計戦績は終了済みイベントのみを集計対象にする。
- グループ累計戦績は定常メンバーのみを集計対象にする。
- ゲストはイベント内戦績には表示する。
- ゲストはグループ累計戦績には含めない。
- ペアランキングにゲストは含めない。
- 個人ランキングは最低10試合以上を基本条件にする。
