const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// 実Supabaseには接続せず、一時PostgreSQL上の架空データだけで手動SQLを検証する。
const sql = name => readFileSync(join(__dirname, '../supabase/maintenance/player-profiles', name), 'utf8');
const source = '10000000-0000-4000-8000-000000000001';
const target = '10000000-0000-4000-8000-000000000002';
const other = '10000000-0000-4000-8000-000000000003';
const user = '20000000-0000-4000-8000-000000000001';
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const schema = `
create role anon; create role authenticated;
create table profiles (id uuid primary key, display_name text);
create table player_profiles (id uuid primary key, linked_auth_user_id uuid, display_name text not null, bio text, play_level text, dominant_hand text, preferred_position text, activity_area text, is_active boolean default true, created_at timestamptz default now());
create table clubs (id uuid primary key, name text, is_active boolean default true);
create table club_members (id uuid primary key, club_id uuid references clubs(id), player_profile_id uuid references player_profiles(id) on delete cascade, role text, is_active boolean default true, unique(club_id,player_profile_id));
create table events (id uuid primary key, status text, is_deleted boolean, stats_mode text);
create table event_participants (id uuid primary key, event_id uuid references events(id), profile_id uuid references profiles(id), player_profile_id uuid references player_profiles(id));
create table matches (id uuid primary key, event_id uuid references events(id));
create table match_players (id uuid primary key, participant_id uuid references event_participants(id), match_id uuid references matches(id), team text);
create table match_results (id uuid primary key, match_id uuid references matches(id), score_a int, score_b int);
create table event_team_matches (id uuid primary key, team_a_player1_profile_id uuid references player_profiles(id), team_a_player2_profile_id uuid references player_profiles(id), team_b_player1_profile_id uuid references player_profiles(id), team_b_player2_profile_id uuid references player_profiles(id));
create table official_matches (id uuid primary key, our_player1_profile_id uuid, our_player2_profile_id uuid);
create table join_requests (id uuid primary key, requester_player_profile_id uuid references player_profiles(id));
create table player_stats (id uuid primary key, profile_id uuid references profiles(id), match_count int);
create table app_admins (id uuid primary key, profile_id uuid, is_active boolean);
insert into profiles values ('${user}', '認証側の名前');
insert into player_profiles(id, linked_auth_user_id, display_name, bio, play_level, dominant_hand, preferred_position, activity_area) values
('${source}', '${user}', '保存済みの本人名', E'以前の自己紹介\\n改行', '中級', '左', 'バック', '東京都'),
('${target}', '${user}', 'グループ内の選手名', null, null, null, null, null),
('${other}', '${other}', '別のアカウント', null, null, null, null, null);
insert into clubs(id,name) values ('${id(1)}','グループA'),('${id(2)}','グループB');
insert into club_members values ('${id(3)}','${id(1)}','${source}','main_admin',true),('${id(4)}','${id(2)}','${target}','member',true);
insert into events values ('${id(5)}','closed',false,'official'),('${id(6)}','closed',false,'official');
insert into event_participants values ('${id(7)}','${id(5)}','${user}','${source}'),('${id(8)}','${id(6)}',null,'${target}');
insert into matches values ('${id(9)}','${id(5)}');
insert into match_players values ('${id(10)}','${id(7)}','${id(9)}','A');
insert into match_results values ('${id(11)}','${id(9)}',6,4);
insert into event_team_matches values ('${id(12)}','${source}',null,null,null),('${id(13)}',null,'${source}',null,null),('${id(14)}',null,null,'${source}',null),('${id(15)}',null,null,null,'${source}');
insert into official_matches values ('${id(16)}','${source}',null),('${id(17)}',null,'${source}');
insert into join_requests values ('${id(18)}','${source}');
insert into player_stats values ('${id(19)}','${user}',42);
insert into app_admins values ('${id(20)}','${user}',true);
`;

const plan = `insert into approved_profile_map values ('${source}', '${target}');`;
const repair = (commit = false, mapping = plan) => sql('03_repair_reviewed_plan.sql').replace('-- 検証用プラン挿入位置', mapping).replace(/rollback;\s*$/, commit ? 'commit;' : 'rollback;');
const restore = commit => sql('05_restore_previous_rows.sql').replace(/rollback;\s*$/, commit ? 'commit;' : 'rollback;');
async function fixture(run, extra = '') {
  const db = new PGlite();
  try {
    await db.exec(schema);
    if (extra) await db.exec(extra);
    await db.exec(sql('02_backup.sql'));
    await run(db);
  } finally { await db.close(); }
}
async function assertUnchanged(db) {
  const manifest = (await db.query('select * from player_profile_backup_20261022.manifest')).rows;
  for (const row of manifest) {
    const result = await db.query(`select exists ((select to_jsonb(t) from public.${row.source_table} t except all select to_jsonb(b) from player_profile_backup_20261022.${row.backup_table} b) union all (select to_jsonb(b) from player_profile_backup_20261022.${row.backup_table} b except all select to_jsonb(t) from public.${row.source_table} t)) as changed`);
    assert.equal(result.rows[0].changed, false, row.source_table);
  }
}

test('調査SQLが実行でき、バックアップを一般ユーザーに公開せず、再作成も拒否する', async () => fixture(async db => {
  await db.exec(sql('01_inspect.sql'));
  assert.equal((await db.query("select has_schema_privilege('anon','player_profile_backup_20261022','USAGE') as allowed")).rows[0].allowed, false);
  await assert.rejects(db.exec(sql('02_backup.sql')), /already exists/);
  await db.exec('rollback');
  await assertUnchanged(db);
}));

test('修復SQLは承認済みプラン無しでは変更しない', async () => fixture(async db => {
  await assert.rejects(db.exec(sql('03_repair_reviewed_plan.sql')), /プランが未設定/);
  await db.exec('rollback');
  await assertUnchanged(db);
}));

test('修復SQLの既定ROLLBACKで全行・全設定が元のまま残る', async () => fixture(async db => {
  await db.exec(repair(false));
  await assertUnchanged(db);
  assert.equal((await db.query('select count(*)::int as n from player_profile_backup_20261022.repair_changes')).rows[0].n, 0);
}));

test('承認した修復で全参照と設定を保ち、削除せず、復旧SQLで元どおりに戻せる', async () => fixture(async db => {
  await db.exec(repair(true));
  const profiles = (await db.query('select * from player_profiles order by id')).rows;
  assert.equal(profiles.length, 3);
  assert.equal(profiles[0].linked_auth_user_id, null);
  assert.equal(profiles[0].is_active, false);
  assert.equal(profiles[0].bio, '以前の自己紹介\n改行');
  assert.equal(profiles[1].bio, profiles[0].bio);
  assert.equal(profiles[1].dominant_hand, '左');
  assert.equal(profiles[1].display_name, 'グループ内の選手名');
  const memberships = (await db.query('select * from club_members order by id')).rows;
  assert.deepEqual(memberships.map(row => row.id), [id(3), id(4)]);
  assert.deepEqual(memberships.map(row => row.role), ['main_admin', 'member']);
  assert(memberships.every(row => row.player_profile_id === target));
  assert.equal((await db.query('select participant_id from match_players')).rows[0].participant_id, id(7));
  assert.equal((await db.query('select score_a from match_results')).rows[0].score_a, 6);
  assert.equal((await db.query('select profile_id from player_stats')).rows[0].profile_id, user);
  assert.equal((await db.query('select profile_id from app_admins')).rows[0].profile_id, user);
  assert.equal((await db.query('select our_player2_profile_id as id from official_matches where id=$1', [id(17)])).rows[0].id, target);
  const checks = await db.exec(sql('04_verify.sql'));
  assert.equal(checks.at(-2).rows.length, 0);
  await db.exec(restore(false));
  assert.equal((await db.query('select linked_auth_user_id as uid from player_profiles where id=$1', [source])).rows[0].uid, null);
  await db.exec(restore(true));
  await assertUnchanged(db);
}));

const blockedCases = [
  ['設定の衝突', `update player_profiles set bio='異なる自己紹介' where id='${target}'`, /内容の衝突/],
  ['同一グループの所属衝突', `update club_members set club_id='${id(1)}' where id='${id(4)}'`, /同じグループ/],
  ['同一イベントの参加者衝突', `update event_participants set event_id='${id(5)}' where id='${id(8)}'`, /同じイベント/],
  ['チーム戦の同一選手二重出場', `update event_team_matches set team_b_player2_profile_id='${target}' where id='${id(12)}'`, /フレンドリーチーム戦/],
  ['公式戦の同一選手二重出場', `update official_matches set our_player2_profile_id='${target}' where id='${id(16)}'`, /公式戦/],
  ['別アカウントへの移行', `update player_profiles set linked_auth_user_id='${other}' where id='${target}'`, /同一アカウント/],
  ['未知の外部キー', 'create table unexpected_refs (id uuid primary key, player_id uuid references player_profiles(id))', /未確認の外部キー/],
];
for (const [name, extra, expected] of blockedCases) test(`${name}は修復せず全行を保護する`, async () => fixture(async db => {
  await assert.rejects(db.exec(repair(true)), expected);
  await db.exec('rollback');
  await assertUnchanged(db);
}, extra));

test('バックアップ後にデータが変更されたら修復を中止する', async () => fixture(async db => {
  await db.exec(`update player_profiles set activity_area='後からの変更' where id='${target}'`);
  await assert.rejects(db.exec(repair(true)), /バックアップ後に/);
  await db.exec('rollback');
  assert.equal((await db.query('select activity_area from player_profiles where id=$1', [target])).rows[0].activity_area, '後からの変更');
}));

test('修復後の編集があれば復旧SQLで上書きしない', async () => fixture(async db => {
  await db.exec(repair(true));
  await db.exec(`update player_profiles set bio='修復後の新しい自己紹介' where id='${target}'`);
  await assert.rejects(db.exec(restore(true)), /修復後に編集/);
  await db.exec('rollback');
  assert.equal((await db.query('select bio from player_profiles where id=$1', [target])).rows[0].bio, '修復後の新しい自己紹介');
}));
