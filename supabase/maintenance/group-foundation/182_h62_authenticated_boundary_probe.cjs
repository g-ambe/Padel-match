// H62 review counterexample. Synthetic PGlite ONLY; no hosted credentials or HTTP.
// Exit 0 means the privacy counterexample was REPRODUCED, not authorization PASS.
// Scope: actual 0001-0039 + 0054/0055 + the H38 alias segment, not full H61.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../../..');
const fixturePath = path.join(root, 'tests/profile-linking-db.test.cjs');
const fixtureModule = new Module(fixturePath, module);
fixtureModule.filename = fixturePath;
fixtureModule.paths = Module._nodeModulePaths(path.dirname(fixturePath));
const source = fs.readFileSync(fixturePath, 'utf8');
const registration = "const { test } = require('node:test');";
assert.equal(source.split(registration).length, 2, 'Fixture registration changed; review before running');
// Load the unchanged fixture without registering/rerunning its unrelated tests.
fixtureModule._compile(source.replace(registration, 'const test = () => {};') +
  '\nmodule.exports = { fixture, asUser, id, other, clubA, sourceA, dir };', fixturePath);
const { fixture, asUser, id, other, clubA, sourceA, dir } = fixtureModule.exports;

async function main() {
  await fixture(async db => {
    for (const name of ['0054_group_read_interfaces.sql', '0055_group_read_consumer_support.sql']) {
      await db.exec(fs.readFileSync(path.join(dir, name), 'utf8'));
    }
    await db.exec(fs.readFileSync(path.join(__dirname,
      '138_h38_prod_alias_atomic_cutover_candidate.sql'), 'utf8'));

    // Synthetic setup: a linked member saves a private alias, then the manager
    // changes visibility using the existing authenticated UPDATE path.
    await db.query("update clubs set visibility='private' where id=$1", [clubA]);
    await asUser(db, id(2), () => db.query(
      'select save_club_member_display_name($1,$2,$3,$4,$5)',
      [clubA, id(210), 'H62 synthetic private alias', null, false]));
    await asUser(db, id(2), () => db.query(
      "update clubs set visibility='public' where id=$1", [clubA]));

    const observed = await asUser(db, other, async () => {
      const raw = await db.query(`select role, profile_id, player_profile_id,
        club_display_name, club_display_name_public_confirmed_at
        from public.club_members where id=$1`, [id(210)]);
      const profile = await db.query(
        'select display_name,bio,linked_auth_user_id from public.player_profiles where id=$1', [sourceA]);
      const directory = await db.query('select * from get_public_club_directory($1)', [clubA]);
      return {
        public_directory_hides_unconfirmed_alias:
          !directory.rows.some(row => row.display_name === 'H62 synthetic private alias'),
        raw_member_visible: raw.rows.length === 1,
        unconfirmed_alias_visible: raw.rows[0]?.club_display_name === 'H62 synthetic private alias'
          && raw.rows[0]?.club_display_name_public_confirmed_at === null,
        internal_profile_id_visible: Boolean(raw.rows[0]?.player_profile_id),
        role_visible: raw.rows[0]?.role === 'main_admin',
        other_profile_bio_visible: profile.rows[0]?.bio === '仮の自己紹介',
      };
    });
    assert(Object.values(observed).every(Boolean), 'Counterexample changed; independently review the new boundary');
    await asUser(db, null, () => assert.rejects(db.query('select * from public.club_members')), 'anon');
    const anonProfile = await asUser(db, null, async () => {
      const result = await db.query('select bio from public.player_profiles where id=$1', [sourceA]);
      return result.rows[0]?.bio === '仮の自己紹介';
    }, 'anon');
    assert.equal(anonProfile, true);
    console.log(JSON.stringify({
      finding: 'H62_C1_COUNTEREXAMPLE_REPRODUCED',
      environment: 'synthetic PGlite; not full H61, real Auth/HTTP or production',
      authenticated_nonmember: observed,
      anon_club_members_denied: true,
      anon_other_profile_bio_visible: anonProfile,
    }));
  }, '', true, false);
}

main().catch(error => {
  console.error('H62_PROBE_FAILED', error.code || error.name);
  process.exitCode = 1;
});
