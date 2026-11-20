const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const sql=fs.readFileSync('supabase/maintenance/group-foundation/120_p0_h31_stage_token_click_additive_apply.sql','utf8');
const friendly=fs.readFileSync('app/share/events/[token]/page.tsx','utf8');
const official=fs.readFileSync('app/share/official-events/[token]/page.tsx','utf8');

const names=[
  ['record_event_video_click_by_token','p_match_id','event_video_clicks'],
  ['record_event_video_link_click_by_token','p_video_link_id','event_video_link_clicks'],
  ['record_official_video_click_by_token','p_match_id','official_video_clicks'],
];

test('H31: add only the three token-bound write RPCs; keep all legacy APIs intact',()=>{
  const created=[...sql.matchAll(/CREATE FUNCTION public\.([a-z_]+)\(/g)].map(x=>x[1]);
  assert.deepEqual(created,names.map(x=>x[0]));
  assert.match(sql,/to_regprocedure\('public\.record_event_video_click\(uuid,text,text\)'\)/);
  assert.match(sql,/to_regprocedure\('public\.record_official_video_click\(uuid,text,text\)'\)/);
  assert.doesNotMatch(sql,/DROP\s+(?:TABLE|POLICY|FUNCTION)/i);
  assert.doesNotMatch(sql,/REVOKE\s+SELECT\s+ON\s+TABLE/i);
});

test('H31: each new RPC checks the same parent share token, valid state, and video before INSERT',()=>{
  for(const [name,idArg,clickTable] of names){
    const after=sql.split('CREATE FUNCTION public.'+name+'(');
    assert.equal(after.length,2,name+' defined exactly once');
    const body=after[1].split('END $fn$;')[0];
    assert.match(body,new RegExp(idArg+' uuid'),name);
    assert.match(body,/p_share_token text/,name);
    assert.match(body,/e\.share_token\s*=\s*p_share_token/,name);
    assert.match(body,/e\.share_token\s*<>\s*''/,name);
    assert.match(body,/e\.status\s*=\s*'closed'/,name);
    assert.match(body,/e\.share_enabled/,name);
    assert.match(body,/NOT coalesce\(e\.is_deleted,false\)/,name);
    assert.match(body,/youtube_url IS NOT NULL|video_url IS NOT NULL/,name);
    assert.match(body,new RegExp('INSERT INTO public\\.'+clickTable+'\\('),name);
    assert.doesNotMatch(body,/(?:INSERT|VALUES)\s*\([^)]*p_share_token/mi,'token must not be stored');
    assert.match(after[1],new RegExp('REVOKE ALL ON FUNCTION public\\.'+name+'\\(uuid,text,text,text\\) FROM PUBLIC,anon,authenticated;'));
    assert.match(after[1],new RegExp('GRANT EXECUTE ON FUNCTION public\\.'+name+'\\(uuid,text,text,text\\) TO anon,authenticated;'));
    assert.match(after[1],/SECURITY DEFINER SET search_path=''/);
  }
});

test('H31: shared friendly page records with the shared anonymous client and correct token-bound RPCs',()=>{
  assert.doesNotMatch(friendly,/getSupabaseClient/);
  assert.match(friendly,/\.rpc\("record_event_video_click_by_token",\s*\{/);
  assert.match(friendly,/\.rpc\("record_event_video_link_click_by_token",\s*\{/);
  assert.match(friendly,/p_match_id:\s*matchId/);
  assert.match(friendly,/p_video_link_id:\s*videoLinkId/);
  assert.equal((friendly.match(/p_share_token:\s*token/g)||[]).length,2);
  assert.equal((friendly.match(/getSharedEventClient\(token\)/g)||[]).length,3);
  assert.doesNotMatch(friendly,/\.rpc\("record_event_video_(?:link_)?click",/);
});

test('H31: official shared page records only through token-bound RPC',()=>{
  assert.doesNotMatch(official,/getSupabaseClient/);
  assert.match(official,/\.rpc\("record_official_video_click_by_token",\s*\{/);
  assert.match(official,/p_match_id:\s*matchId/);
  assert.match(official,/p_share_token:\s*token/);
  assert.equal((official.match(/getSharedEventClient\(token\)/g)||[]).length,2);
  assert.doesNotMatch(official,/\.rpc\("record_official_video_click",/);
});

test('H31: no raw error details or token in click-recording console logs',()=>{
  const loggerText=[friendly.slice(friendly.indexOf('const logClickError'),friendly.indexOf('const recordVideoClick')),
    friendly.slice(friendly.indexOf('const logEventVideoLinkClickError'),friendly.indexOf('const recordEventVideoLinkClick')),
    official.slice(official.indexOf('const logClickError'),official.indexOf('const recordVideoClick'))];
  for(const logger of loggerText){
    assert.match(logger,/error\?\.code/);
    assert.doesNotMatch(logger,/error\?\.(?:message|details|hint)/);
    assert.doesNotMatch(logger,/console\.[a-z]+\(.*token/);
  }
});
