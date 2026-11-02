const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {createClient}=require('@supabase/supabase-js');
const source=fs.readFileSync(require('node:path').join(__dirname,'../lib/shared-event-client.ts'),'utf8');
function setup(env={NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon-test-key'},browser=true){
 const requests=[],storageReads=[];const module={exports:{}};
 const session={access_token:'cached-user-token',refresh_token:'cached-refresh',expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:{id:'cached-account'}};
 const storage={getItem:async key=>{storageReads.push(key);return JSON.stringify(session);},setItem:async()=>{},removeItem:async()=>{}};
 const mockFetch=async(input,init)=>{const request=new Request(input,init);requests.push(request);return new Response('[]',{status:200,headers:{'content-type':'application/json'}});};
 const realFactory=(url,key,options)=>createClient(url,key,{...options,global:{...options.global,fetch:mockFetch},auth:{...options.auth,storage}});
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const context={module,exports:module.exports,require:name=>{assert.equal(name,'@supabase/supabase-js');return{createClient:realFactory};},process:{env},...(browser?{window:{}}:{})};
 vm.runInNewContext(js,context);
 return{client:module.exports.getSharedEventClient,requests,storageReads};
}
test('actual Supabase requests carry the link token for the event and embedded result reads',async()=>{
 const f=setup(),s=f.client('link-A_123');
 await s.from('events').select('id,name').eq('share_token','link-A_123');
 await s.from('matches').select('id,rounds(round_number),match_players(participant_id,team),match_results(score_a,score_b)');
 assert.equal(f.requests.length,2);
 for(const req of f.requests){assert.equal(req.headers.get('x-padel-share-token'),'link-A_123');assert.equal(req.headers.get('authorization'),'Bearer anon-test-key');assert.equal(req.headers.get('apikey'),'anon-test-key');}
});
test('a persisted logged-in session is never read or sent by shared-page requests',async()=>{
 const f=setup();await f.client('shared-token').from('event_participants').select('id,guest_name');
 assert.deepEqual(f.storageReads,[]);
 assert.equal(f.requests[0].headers.get('authorization'),'Bearer anon-test-key');
 assert.equal(f.requests[0].headers.get('cookie'),null);
});
test('different links keep separate token headers across interleaved requests',async()=>{
 const f=setup(),a=f.client('token-A'),b=f.client('token-B');
 await a.from('events').select('id');await b.from('events').select('id');await a.from('matches').select('id');
 assert.deepEqual(f.requests.map(r=>r.headers.get('x-padel-share-token')),['token-A','token-B','token-A']);
});
test('invalid or empty links do not create a requesting client',()=>{
 const f=setup();
 for(const token of [undefined, null, 123, '', ' ', 'bad/token', 'bad\nheader', 'bad%0Atoken'])assert.equal(f.client(token),null);
 assert.deepEqual(f.requests,[]);
});
test('SSR and missing environment return null without requests',()=>{
 for(const f of [setup(undefined,false),setup({}),setup({NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co'}),setup({NEXT_PUBLIC_SUPABASE_ANON_KEY:'key'})]){
  assert.equal(f.client('valid-token'),null);assert.deepEqual(f.requests,[]);
 }
});
