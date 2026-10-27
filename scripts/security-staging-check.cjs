// 値は安全な環境変数からだけ読む。秘密情報・エラー本文・レスポンス本文を出力しない。
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('node:crypto');
const required = ['PADEL_STAGING_URL','PADEL_STAGING_ANON_KEY','PADEL_STAGING_MEMBER_JWT','PADEL_STAGING_OTHER_JWT','PADEL_STAGING_EVENT_ID'];
const report = (name,result) => process.stdout.write(`${name}: ${result}\n`);
if (required.some(name=>!process.env[name])) {
  report('STAGING','未実施（専用環境変数が未設定）'); process.exit(0);
}
let url;
try { url=new URL(process.env.PADEL_STAGING_URL); } catch { report('STAGING','FAIL（接続先の形式）');process.exit(1); }
if (url.hostname==='ntczrmvffmpjzilfebyi.supabase.co' || process.env.PADEL_STAGING_CONFIRM_NON_PRODUCTION!=='true' || url.protocol!=='https:') {
  report('STAGING','拒否（本番禁止・非本番確認が必要）');process.exit(1);
}
const client = jwt => createClient(url.origin,process.env.PADEL_STAGING_ANON_KEY,{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:jwt?{headers:{Authorization:`Bearer ${jwt}`}}:{}
});
const anon=client(),member=client(process.env.PADEL_STAGING_MEMBER_JWT),other=client(process.env.PADEL_STAGING_OTHER_JWT);
const event=process.env.PADEL_STAGING_EVENT_ID;
const denied=r=>(!r.error&&Array.isArray(r.data)&&r.data.length===0)||r.error?.code==='42501';
let failures=0;
async function check(name,run) { try { if(!await run())throw new Error();report(name,'PASS'); } catch { failures++;report(name,'FAIL'); } }
async function counts() {
  const values=await Promise.all(['rounds','matches','match_players'].map(async table=>{
    // 参加枠は見える全件を数える。専用fixtureを他の試験と同時変更しないこと。
    let q=member.from(table).select('id',{count:'exact',head:true});
    if(table!=='match_players')q=q.eq('event_id',event);
    const r=await q;if(r.error||!Number.isInteger(r.count))throw new Error();return r.count;
  }));return JSON.stringify(values);
}
(async()=>{
  await check('JWT_MEMBER',async()=>!(await member.auth.getUser(process.env.PADEL_STAGING_MEMBER_JWT)).error);
  await check('JWT_OTHER',async()=>!(await other.auth.getUser(process.env.PADEL_STAGING_OTHER_JWT)).error);
  if(failures) { process.exitCode=1;return; }
  await check('MEMBER_PRIVATE_READ',async()=>{const r=await member.from('events').select('id,status').eq('id',event);return !r.error&&r.data.length===1&&r.data[0].status==='active';});
  await check('ANON_PRIVATE_DENIED',async()=>denied(await anon.from('events').select('id').eq('id',event)));
  await check('OTHER_PRIVATE_DENIED',async()=>denied(await other.from('events').select('id').eq('id',event)));
  if(process.env.PADEL_STAGING_STAT_ID) await check('DIRECT_STATS_DENIED',async()=>{
    const own=await member.from('player_stats').select('id').eq('id',process.env.PADEL_STAGING_STAT_ID);
    if(own.error||own.data.length!==1)return false;
    return denied(await member.from('player_stats').update({match_count:999999}).eq('id',process.env.PADEL_STAGING_STAT_ID).select('id'));
  }); else report('DIRECT_STATS_DENIED','未実施（fixture戦績IDが未設定）');
  await check('ROUND_FAILURE_ATOMIC',async()=>{
    const before=await counts();const rounds=await member.from('rounds').select('round_number').eq('event_id',event);
    if(rounds.error) return false;
    const expected=Math.max(0,...rounds.data.map(r=>r.round_number));
    const missing=Array.from({length:4},()=>randomUUID());
    const result=await member.rpc('create_friendly_round',{p_event:event,p_expected:expected,p_matches:[{court:1,teamA:missing.slice(0,2),teamB:missing.slice(2)}],p_request:randomUUID()});
    return !!result.error&&result.error.code==='P0001'&&before===await counts();
  });
  if(process.env.PADEL_STAGING_EMAIL&&process.env.PADEL_STAGING_PASSWORD) await check('EMAIL_PASSWORD_LOGIN',async()=>{
    const login=client();const r=await login.auth.signInWithPassword({email:process.env.PADEL_STAGING_EMAIL,password:process.env.PADEL_STAGING_PASSWORD});
    return !r.error&&!!r.data.session&&!!r.data.user?.email_confirmed_at;
  });else report('EMAIL_PASSWORD_LOGIN','未実施（専用認証シークレットが未設定）');
  report('BROWSER_SIGNUP_CONFIRM_LINK','未実施（手動手順で確認）');
  process.exitCode=failures?1:0;
})().catch(()=>{report('STAGING','FAIL（通信・実行失敗）');process.exitCode=1;});
