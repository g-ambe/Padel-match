/**
 * H19 Stage ONLY one-shot real 2-connection race acceptance.
 * Fixture: 88_h19_real_http_fixture_setup.sql.
 * Cleanup: 95_h19_real_race_fixture_cleanup.sql, not cleanup 89.
 * This test MAY ACCEPT ownership for its synthetic club; it MUST BE CLEANED.
 * Do not log IDs, JWT, users, names, request payloads or tokens.
 */
const {createClient}=require('@supabase/supabase-js');
const {readOwnerCandidates,readMyOwnerTransfers,requestOwnerTransfer,decideOwnerTransfer}=require('../../../lib/club-owner-transfer.ts');
const {readMyMemberships}=require('../../../lib/group-read.ts');
const host='https://zzjwpresqkefnyjyisgd.supabase.co';
const acct={owner:['main-A@example.com','TASK08_STAGING_MAIN_A_PASSWORD'],recipient:['recipient@example.com','TASK08_STAGING_RECIPIENT_PASSWORD']};
const db={},checks=[];
const create=(key)=>createClient(host,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const record=(label,ok,more={})=>checks.push({label,outcome:ok?'PASS':'FAIL',...more});
const settled=async action=>{try{return{ok:true,data:await action()}}catch(e){return{ok:false,code:e?.code??null}}};
(async()=>{
 try{
 if(process.env.TASK08_H19_RACE_ONCE!=='1')throw Error('race_not_enabled');
 const key=process.env.TASK08_STAGING_PUBLISHABLE_KEY;
 if(!key?.startsWith('sb_publishable_'))throw Error('staging_key_required');
 for(const label of ['ownerA','ownerB','recipient']){
  const [email,secret]=acct[label==='recipient'?'recipient':'owner'];
  const c=create(key),r=await c.auth.signInWithPassword({email,password:process.env[secret]});
  if(r.error||r.data.user?.email?.toLowerCase()!==email.toLowerCase()||!r.data.session?.access_token)throw Error('auth_login_failed');
  db[label]=c;
 }
 const clubResult=await db.ownerA.from('clubs').select('id').eq('name','TASK08-H19-HTTP-20261120');
 const club=clubResult.data?.length===1?clubResult.data[0]:null;
 if(!club||clubResult.error)throw Error('synthetic_group_missing');
 const candidates=await readOwnerCandidates(db.ownerA,club.id);
 if(candidates?.length!==1)throw Error('unexpected_candidate_count');
 const candidate=candidates[0];
 const preOwner=await readMyOwnerTransfers(db.ownerA);
 if(preOwner.length!==0)throw Error('fixture_has_existing_requests');
 const double=await Promise.all([
  settled(()=>requestOwnerTransfer(db.ownerA,club.id,candidate.member_id,candidates,preOwner,true)),
  settled(()=>requestOwnerTransfer(db.ownerB,club.id,candidate.member_id,candidates,preOwner,true))
 ]);
 const winners=double.filter(x=>x.ok),losers=double.filter(x=>!x.ok);
 record('H19_RACE_TWO_OWNER_CLIENTS_ONE_REQUEST',winners.length===1&&losers.length===1,
   {success_count:winners.length,error_count:losers.length});
 record('H19_RACE_SECOND_DUPLICATE_CONFLICT',losers.length===1&&losers[0].code==='PT409',{code:losers[0]?.code??null});
 if(winners.length!==1||losers.length!==1)throw Error('request_race_inconsistent');
 const ownerRows=await readMyOwnerTransfers(db.ownerA);
 const recipientRows=await readMyOwnerTransfers(db.recipient);
 const sender=ownerRows.find(x=>x.id===winners[0].data);
 const recipient=recipientRows.find(x=>x.id===winners[0].data);
 if(sender?.status!=='pending'||recipient?.status!=='pending')throw Error('pending_scope_inconsistent');
 const memberships=await readMyMemberships(db.recipient);
 const clash=await Promise.all([
  settled(()=>decideOwnerTransfer(db.recipient,recipient,'accepted',memberships,false,true)),
  settled(()=>decideOwnerTransfer(db.ownerA,sender,'cancelled',[],true,true))
 ]);
 const accepted=clash[0].ok, cancelled=clash[1].ok;
 record('H19_RACE_ACCEPT_VS_CANCEL_EXACTLY_ONE_WINS',Number(accepted)+Number(cancelled)===1,
  {accepted, cancelled});
 const rejected=clash.find(x=>!x.ok);
 record('H19_RACE_LOSER_REJECTED',!!rejected&&['PT409','42501'].includes(rejected.code),
   {code:rejected?.code??null});
 const ownerAfter=await readMyOwnerTransfers(db.ownerA);
 const receiverAfter=await readMyOwnerTransfers(db.recipient);
 const expected=accepted?'accepted':'cancelled';
 record('H19_RACE_BOTH_SEE_SAME_FINAL_STATUS',ownerAfter.length===1&&receiverAfter.length===1
  &&ownerAfter[0].status===expected&&receiverAfter[0].status===expected,
  {status:expected});
 const ownerCan=await readOwnerCandidates(db.ownerA,club.id);
 const recipientCan=await readOwnerCandidates(db.recipient,club.id);
 record('H19_RACE_OWNER_PERMISSION_MATCHES_WINNER',
  accepted?ownerCan===null&&Array.isArray(recipientCan):Array.isArray(ownerCan)&&recipientCan===null);
 const notices=await db.recipient.from('notifications').select('id,type').eq('related_club_id',club.id);
 const noteCount=await db.ownerA.from('notifications').select('id,type').eq('related_club_id',club.id);
 record('H19_RACE_NOTIFICATIONS_SINGLE_DECISION',
  !notices.error&&!noteCount.error
  &&notices.data.length+noteCount.data.length===2,
  {notices_to_recipient:notices.data?.length??null,notices_to_owner:noteCount.data?.length??null});
 if(checks.some(x=>x.outcome!=='PASS'))process.exitCode=1;
 }catch(e){checks.push({label:'H19_RACE_RUNTIME_OR_SETUP',outcome:'BLOCKED'});process.exitCode=1;}
 finally{
  for(const c of Object.values(db))await c.auth.signOut({scope:'local'}).catch(()=>{});
  console.log(JSON.stringify({phase:'H19_TWO_CLIENT_REAL_STAGE_RACE',
   cleanup_required:'95_h19_real_race_fixture_cleanup.sql',checks},null,2));
 }
})();
