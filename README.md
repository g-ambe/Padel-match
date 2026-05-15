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
