const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('supabase/maintenance/group-foundation/125_p0_h33_stage_click_referrer_minimization_apply.sql','utf8');
const version='20261120094347';
const name='task08_h33_stage_token_click_referrer_minimization';
const target=`supabase/migrations/${version}_${name}.sql`;
const registered=fs.readFileSync(target,'utf8');
const friendly=fs.readFileSync('app/share/events/[token]/page.tsx','utf8');
const official=fs.readFileSync('app/share/official-events/[token]/page.tsx','utf8');
const probe=fs.readFileSync('supabase/maintenance/group-foundation/126_p0_h33_token_click_referrer_rollback_probe.sql','utf8');
const rpcNames=[
'record_event_video_click_by_token',
'record_event_video_link_click_by_token',
'record_official_video_click_by_token'
];

test('H33 migration exactly matches applied Stage source and version is unique',()=>{
  assert.equal(registered,source);
  const names=fs.readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql'));
  assert.deepEqual(names.filter(x=>x.startsWith(version+'_')),[`${version}_${name}.sql`]);
  assert.deepEqual(names.filter(x=>x.includes(name)),[`${version}_${name}.sql`]);
});

test('H33 all three token-RPC replacements persist NULL referrer and preserve token gate',()=>{
 const found=[...registered.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(/g)].map(m=>m[1]);
 assert.deepEqual(found,rpcNames);
 assert.equal((registered.match(/NULL \/\* H33: never persist untrusted referrer URL \*\//g)||[]).length,3);
 assert.equal((registered.match(/e\.share_token=p_share_token/g)||[]).length,3);
 for(const name of rpcNames){
  const body=registered.split('CREATE OR REPLACE FUNCTION public.'+name+'(')[1]?.split('END $fn$;')[0];
  assert.ok(body,name);
  assert.match(body,/SECURITY DEFINER SET search_path=''/);
  assert.match(body,/e\.status='closed' AND e\.share_enabled AND NOT coalesce\(e\.is_deleted,false\)/);
  assert.match(body,/NULL \/\* H33: never persist untrusted referrer URL \*\//);
  assert.doesNotMatch(body,/nullif\(left\(p_referrer,500\)/);
  assert.match(body,/nullif\(left\(p_user_agent,500\)/);
 }
 assert.doesNotMatch(registered,/\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+(?:FUNCTION|TABLE|POLICY)\b/i);
 assert.doesNotMatch(registered,/\bREVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.record_(?:event|official)_video_(?:link_)?click\(/i);
});

test('H33 shared UI never sends document.referrer and passes null in all three click RPC calls',()=>{
 for(const text of [friendly,official])assert.doesNotMatch(text,/document\.referrer/);
 assert.equal((friendly.match(/p_referrer:\s*null/g)||[]).length,2);
 assert.equal((official.match(/p_referrer:\s*null/g)||[]).length,1);
 assert.match(friendly,/\.rpc\("record_event_video_click_by_token"/);
 assert.match(friendly,/\.rpc\("record_event_video_link_click_by_token"/);
 assert.match(official,/\.rpc\("record_official_video_click_by_token"/);
 assert.equal((friendly.match(/p_share_token:\s*token/g)||[]).length,2);
 assert.equal((official.match(/p_share_token:\s*token/g)||[]).length,1);
});

test('H33 rollback integration verifies null referrer across all three click tables',()=>{
 assert.match(probe,/https:\/\/staging\.example\/share\/events\/TASK08H30CLICKFRIENDLY/);
 for(const name of ['event_video_clicks','event_video_link_clicks','official_video_clicks']){
  assert.match(probe,new RegExp('FROM public\\.'+name+'\\s+WHERE user_agent IS DISTINCT FROM'));
 }
 assert.equal((probe.match(/OR referrer IS NOT NULL/g)||[]).length,3);
 assert.match(probe,/^ROLLBACK;\s*$/m);
 assert.doesNotMatch(probe,/\bCOMMIT\s*;/);
});
