const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// 実Supabaseには接続せず、確認対象UUIDと架空の設定・履歴を一時PostgreSQL上で検証する。
const sql = name => readFileSync(join(__dirname, '../supabase/maintenance/player-profiles', name), 'utf8');
const planPattern = /-- 移行プラン開始\n([\s\S]*?)-- 移行プラン終了/;
const planSql = sql('03_repair_reviewed_plan.sql').match(planPattern)[1];
const reviewedPlan = [...planSql.matchAll(/\('([0-9a-f-]{36})', '([0-9a-f-]{36})'\)/g)].map(([, source, target]) => ({ source, target }));
const targetCounts = new Map([
  ['ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c', 51],
  ['2a843167-2875-4c8b-b2b2-98860a2f2517', 1],
  ['acce99ab-1bd7-47c3-bb8b-8c80e7d22466', 1],
]);
const excluded = ['3f787ec6-d6f4-48ee-934d-7f00bacda625', '71d12eaf-fcd3-4df2-a7d4-5319498f9643'];
const source = '050325e2-978f-407a-90ab-d020d6262467';
const target = 'ebb5ce50-a6f7-45ec-b7fa-92a49f3aab2c';
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

// 53行の本番向けプランをそのまま使い、ID以外は架空の3アカウントで再現する。
const accounts = new Map([...targetCounts.keys()].map((target, i) => [target, `20000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`]));
const profileRows = new Map();
for (const { source, target } of reviewedPlan) {
  profileRows.set(source, accounts.get(target));
  profileRows.set(target, accounts.get(target));
}
for (const profile of excluded) profileRows.set(profile, user);
const seedPlan = `insert into player_profiles (id, linked_auth_user_id, display_name) values ${[...profileRows].map(([profile, account]) => `('${profile}', '${account}', '検証用選手')`).join(',')} on conflict (id) do nothing;
insert into clubs(id,name) values ('${id(21)}','除外選手のグループ');
insert into club_members values ('${id(22)}','${id(21)}','${excluded[0]}','main_admin',true),('${id(23)}','${id(21)}','${excluded[1]}','member',true);
insert into event_participants values ('${id(24)}','${id(5)}','${user}','${excluded[0]}'),('${id(25)}','${id(6)}',null,'${excluded[1]}');
insert into official_matches values ('${id(26)}','${excluded[0]}','${excluded[1]}');`;
const repair = (commit = false, mapping = planSql) => sql('03_repair_reviewed_plan.sql')
  .replace(planPattern, () => `-- 移行プラン開始\n${mapping}-- 移行プラン終了`)
  .replace(/rollback;\s*$/, commit ? 'commit;' : 'rollback;');
const restore = commit => sql('05_restore_previous_rows.sql').replace(/rollback;\s*$/, commit ? 'commit;' : 'rollback;');
async function fixture(run, extra = '') {
  const db = new PGlite();
  try {
    await db.exec(schema);
    await db.exec(seedPlan);
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

test('確認対象プランは提示された53行・保持先3名で、対象外IDと連鎖を含まない', () => {
  assert.equal(reviewedPlan.length, 53);
  const sources = new Set(reviewedPlan.map(row => row.source));
  assert.equal(sources.size, 53);
  assert.deepEqual(new Map([...targetCounts.keys()].map(target => [target, reviewedPlan.filter(row => row.target === target).length])), targetCounts);
  for (const { source, target } of reviewedPlan) {
    assert(!excluded.includes(source));
    assert(!excluded.includes(target));
    assert(!sources.has(target));
  }
  assert(reviewedPlan.some(row => row.source === 'de28fa8d-4f04-4ed5-88d6-7b5b10cb6081' && row.target === '2a843167-2875-4c8b-b2b2-98860a2f2517'));
  assert(reviewedPlan.some(row => row.source === '78f3fc0c-fe89-47eb-b9a8-fbdf541edcb1' && row.target === 'acce99ab-1bd7-47c3-bb8b-8c80e7d22466'));
  assert.match(sql('03_repair_reviewed_plan.sql'), /rollback;\s*$/);
});

test('調査SQLが実行でき、バックアップを一般ユーザーに公開せず、再作成も拒否する', async () => fixture(async db => {
  await db.exec(sql('01_inspect.sql'));
  assert.equal((await db.query("select has_schema_privilege('anon','player_profile_backup_20261022','USAGE') as allowed")).rows[0].allowed, false);
  await assert.rejects(db.exec(sql('02_backup.sql')), /already exists/);
  await db.exec('rollback');
  await assertUnchanged(db);
}));

test('修復SQLは承認済みプラン無しでは変更しない', async () => fixture(async db => {
  await assert.rejects(db.exec(repair(true, '')), /プランが未設定/);
  await db.exec('rollback');
  await assertUnchanged(db);
}));

test('修復SQLの既定ROLLBACKで全行・全設定が元のまま残る', async () => fixture(async db => {
  await db.exec(sql('03_repair_reviewed_plan.sql'));
  await assertUnchanged(db);
  assert.equal((await db.query('select count(*)::int as n from player_profile_backup_20261022.repair_changes')).rows[0].n, 0);
}));

test('承認した修復で全参照と設定を保ち、削除せず、復旧SQLで元どおりに戻せる', async () => fixture(async db => {
  await db.exec(repair(true));
  const profiles = (await db.query('select * from player_profiles order by id')).rows;
  assert.equal(profiles.length, 59);
  for (const { source } of reviewedPlan) {
    const profile = profiles.find(row => row.id === source);
    assert.equal(profile.linked_auth_user_id, null);
    assert.equal(profile.is_active, false);
  }
  const saved = profiles.find(row => row.id === source);
  const kept = profiles.find(row => row.id === target);
  assert.equal(saved.bio, '以前の自己紹介\n改行');
  for (const field of ['bio', 'play_level', 'dominant_hand', 'preferred_position', 'activity_area']) assert.equal(kept[field], saved[field]);
  assert.equal(kept.display_name, 'グループ内の選手名');
  for (const [target, account] of accounts) {
    const kept = profiles.find(row => row.id === target);
    assert.equal(kept.linked_auth_user_id, account);
    assert.equal(kept.is_active, true);
  }
  for (const profile of excluded) {
    const kept = profiles.find(row => row.id === profile);
    assert.equal(kept.linked_auth_user_id, user);
    assert.equal(kept.is_active, true);
  }
  const unexpected = (await db.query(`select * from player_profile_backup_20261022.repair_changes where row_id = any($1::uuid[])`, [[...excluded, id(22), id(23), id(24), id(25), id(26)]])).rows;
  assert.equal(unexpected.length, 0, '除外した選手・所属・参加・公式戦は変更しない');
  const memberships = (await db.query(`select * from club_members where id in ('${id(3)}','${id(4)}') order by id`)).rows;
  assert.deepEqual(memberships.map(row => row.id), [id(3), id(4)]);
  assert.deepEqual(memberships.map(row => row.role), ['main_admin', 'member']);
  assert(memberships.every(row => row.player_profile_id === target));
  assert.equal((await db.query('select participant_id from match_players')).rows[0].participant_id, id(7));
  assert.equal((await db.query('select score_a from match_results')).rows[0].score_a, 6);
  assert.equal((await db.query('select profile_id from player_stats')).rows[0].profile_id, user);
  assert.equal((await db.query('select profile_id from app_admins')).rows[0].profile_id, user);
  assert.equal((await db.query("select count(*)::int as n from player_profile_backup_20261022.repair_changes where source_table in ('profiles','matches','match_players','match_results','player_stats','app_admins')")).rows[0].n, 0);
  assert.equal((await db.query('select our_player2_profile_id as id from official_matches where id=$1', [id(17)])).rows[0].id, target);
  const checks = await db.exec(sql('04_verify.sql'));
  assert.equal(checks.at(-2).rows.length, 0);
  await db.exec(restore(false));
  assert.equal((await db.query('select linked_auth_user_id as uid from player_profiles where id=$1', [source])).rows[0].uid, null);
  await db.exec(restore(true));
  await assertUnchanged(db);
}));

test('保持先に保存済みの設定がある場合は53行を修復しても全設定を維持する', async () => fixture(async db => {
  const before = (await db.query('select * from player_profiles where id = any($1::uuid[]) order by id', [[...targetCounts.keys(), ...excluded]])).rows;
  await db.exec(repair(true));
  const after = (await db.query('select * from player_profiles where id = any($1::uuid[]) order by id', [[...targetCounts.keys(), ...excluded]])).rows;
  assert.deepEqual(after, before);
  await db.exec(restore(true));
  await assertUnchanged(db);
}, `update player_profiles set bio=null, play_level=null, dominant_hand=null, preferred_position=null, activity_area=null where id='${source}';
update player_profiles set bio='保持する自己紹介', play_level='上級', dominant_hand='右', preferred_position='フォア', activity_area='千葉県' where id='${target}';`));

const invalidPlans = [
  ['53行からの欠落', planSql.replace(`('${source}', '${target}'),`, ''), /件数または移行先の人数/],
  ['保持先IDの入れ替わり', planSql.replaceAll('2a843167-2875-4c8b-b2b2-98860a2f2517', other), /保持先IDまたは移行元の内訳/],
  ['51・1・1の内訳変更', planSql.replace(`('${source}', '${target}')`, `('${source}', '2a843167-2875-4c8b-b2b2-98860a2f2517')`), /保持先IDまたは移行元の内訳/],
];
for (const [index, profile] of excluded.entries()) {
  invalidPlans.push([`対象外${index + 1}の移行元混入`, planSql.replace(source, profile), /対象外の安倍・テスト01/]);
  invalidPlans.push([`対象外${index + 1}の移行先混入`, planSql.replaceAll(target, profile), /対象外の安倍・テスト01/]);
}
for (const [name, mapping, expected] of invalidPlans) test(`${name}は更新前に中止する`, async () => fixture(async db => {
  await assert.rejects(db.exec(repair(true, mapping)), expected);
  await db.exec('rollback');
  await assertUnchanged(db);
}));

const blockedCases = [
  ['設定の衝突', `update player_profiles set bio='異なる自己紹介' where id='${target}'`, /内容の衝突/],
  ['複数の移行元の設定衝突', `update player_profiles set bio='別の補完候補' where id='05bf1c3a-a20a-4ce2-9623-484650725ede'`, /内容の衝突/],
  ['同一グループの所属衝突', `update club_members set club_id='${id(1)}' where id='${id(4)}'`, /同じグループ/],
  ['同一イベントの参加者衝突', `update event_participants set event_id='${id(5)}' where id='${id(8)}'`, /同じイベント/],
  ['チーム戦の同一選手二重出場', `update event_team_matches set team_b_player2_profile_id='${target}' where id='${id(12)}'`, /フレンドリーチーム戦/],
  ['公式戦の同一選手二重出場', `update official_matches set our_player2_profile_id='${target}' where id='${id(16)}'`, /公式戦/],
  ['別アカウントへの移行', `update player_profiles set linked_auth_user_id='${other}' where id='${target}'`, /同一アカウント/],
  ['対象3組が同じアカウントになる変更', `update player_profiles set linked_auth_user_id='${user}' where linked_auth_user_id='${accounts.get('2a843167-2875-4c8b-b2b2-98860a2f2517')}'`, /異なる3アカウント/],
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
