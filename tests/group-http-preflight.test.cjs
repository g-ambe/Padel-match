const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

test('HTTP準備用カタログSQLはREAD ONLYで実行し、アプリ行・移行SQL・関数本文を返さない',async()=>{
  const sql=fs.readFileSync('supabase/maintenance/group-foundation/04_http_preflight.sql','utf8');
  assert.match(sql,/BEGIN READ ONLY;/);assert.match(sql,/ROLLBACK;\s*$/);
  assert(!/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)\s+(?:INTO|TABLE|FUNCTION|SCHEMA|ON)\b/i.test(sql));
  const db=new PGlite();
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE authenticator;
      CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text,name text,statements text[]);
      INSERT INTO supabase_migrations.schema_migrations VALUES('0039','test',ARRAY['MIGRATION_STATEMENT_SENTINEL']);
      CREATE TABLE profiles(id uuid,display_name text,email text);CREATE TABLE club_members(id uuid,role text);
      INSERT INTO profiles VALUES(gen_random_uuid(),'APPLICATION_ROW_SENTINEL','PRIVATE_EMAIL_SENTINEL');
      ALTER TABLE club_members ENABLE ROW LEVEL SECURITY;
      CREATE POLICY old_read ON club_members FOR SELECT TO anon,authenticated USING(true);
      GRANT SELECT ON club_members TO anon,authenticated;GRANT SELECT(id,display_name) ON profiles TO anon,authenticated;
      CREATE FUNCTION public.get_player_profile_link_request(uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$SELECT '"FUNCTION_BODY_SENTINEL"'::jsonb$$;
      REVOKE ALL ON FUNCTION public.get_player_profile_link_request(uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.get_player_profile_link_request(uuid) TO authenticated;`);
    const before=(await db.query('SELECT * FROM profiles')).rows;
    const results=await db.exec(sql);
    const data=results.find(r=>r.rows?.[0]?.jsonb_build_object)?.rows[0].jsonb_build_object;
    assert(data);assert.equal(data.read_only,'on');
    for(const sentinel of ['APPLICATION_ROW_SENTINEL','PRIVATE_EMAIL_SENTINEL','FUNCTION_BODY_SENTINEL','MIGRATION_STATEMENT_SENTINEL']) assert(!JSON.stringify(data).includes(sentinel));
    const fn=data.functions.find(f=>f.name==='get_player_profile_link_request');
    assert.match(fn.definition_md5,/^[a-f0-9]{32}$/);assert(!('definition' in fn));
    assert.equal(fn.anon_execute,false);assert.equal(fn.authenticated_execute,true);
    assert.equal(data.relations.find(r=>r.name==='profiles').authenticated_select,false);
    assert.equal(data.columns.find(c=>c.table==='profiles'&&c.column==='display_name').authenticated_select,true);
    assert.equal(data.columns.find(c=>c.table==='profiles'&&c.column==='email').authenticated_select,false);
    assert.deepEqual((await db.query('SELECT * FROM profiles')).rows,before);
  }finally{await db.close();}
});
