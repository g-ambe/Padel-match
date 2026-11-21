/**
 * H19 Stage-only ONE-SHOT real Auth/PostgREST acceptance of the actual
 * lib/club-owner-transfer.ts application helper. Uses SQL fixture 88 and
 * requires immediate guarded cleanup SQL 89. No successful owner transfer.
 * NEVER log account IDs, request IDs, names, JWTs, secrets or response DTOs.
 */
const {createClient}=require('@supabase/supabase-js');
const {readOwnerCandidates,readMyOwnerTransfers,requestOwnerTransfer,decideOwnerTransfer,
 canAcceptOwnerTransfer,OwnerTransferError}=require('../../../lib/club-owner-transfer.ts');
const {readMyMemberships}=require('../../../lib/group-read.ts');
const url='https://zzjwpresqkefnyjyisgd.supabase.co';
const credentials={
 owner:['main-A@example.com','TASK08_STAGING_MAIN_A_PASSWORD'],
 recipient:['recipient@example.com','TASK08_STAGING_RECIPIENT_PASSWORD'],
 outsider:['outsider@example.com','TASK08_STAGING_OUTSIDER_PASSWORD']
};
const clients={},tests=[];
const mark=(name,pass,more={})=>tests.push({name,outcome:pass?'PASS':'FAIL',...more});
function client(key){return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}
function uuid(v){return typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v)}
async function denial(f,expectedCode=null){try{await f();return{pass:false,code:'unexpected_success'}}catch(e){
 return{pass:e instanceof OwnerTransferError&&(expectedCode===null||e.code===expectedCode),code:e?.code??null};}}
(async()=>{
try{
 if(process.env.TASK08_H19_APP_ONCE!=='1')throw Error('write_opt_in_required');
 const key=process.env.TASK08_STAGING_PUBLISHABLE_KEY;
 if(!key?.startsWith('sb_publishable_'))throw Error('staging_publishable_required');
 for(const [label,[email,env]] of Object.entries(credentials)){
  const c=client(key);const login=await c.auth.signInWithPassword({email,password:process.env[env]});
  if(login.error||login.data?.user?.email?.toLowerCase()!==email.toLowerCase()||!login.data?.session?.access_token)throw Error('Stage_auth_failed');
  clients[label]=c;
 }
 const anon=client(key);
 const groups=await clients.owner.from('clubs').select('id,visibility').eq('name','TASK08-H19-HTTP-20261120');
 if(groups.error||groups.data?.length!==1||groups.data[0].visibility!=='private')throw Error('fixture_club_unavailable');
 const club=groups.data[0];
 const roster=await clients.owner.rpc('get_club_roster',{p_club_id:club.id});
 const user=await clients.recipient.auth.getUser();
 const recipientId=user.data?.user?.id;
 const candidate=roster.data?.find(x=>x.role==='main_admin'&&x.player_profiles?.linked_auth_user_id===recipientId);
 if(roster.error||roster.data?.length!==3||!candidate)throw Error('fixture_members_invalid');
 const ownerCandidates=await readOwnerCandidates(clients.owner,club.id);
 mark('H19_APP_OWNER_CANDIDATES',ownerCandidates?.length===1&&ownerCandidates[0].member_id===candidate.id);
 const unauthorizedCandidates=await readOwnerCandidates(clients.outsider,club.id);
 mark('H19_APP_NON_OWNER_CANDIDATES_HIDDEN',unauthorizedCandidates===null);
 const initialOwner=await readMyOwnerTransfers(clients.owner);
 const initialRecipient=await readMyOwnerTransfers(clients.recipient);
 mark('H19_APP_INITIAL_NO_TRANSFER',initialOwner.length===0&&initialRecipient.length===0);
 const outsiderTry=await denial(()=>requestOwnerTransfer(clients.outsider,club.id,candidate.id,ownerCandidates,[],true),'42501');
 mark('H19_APP_NONOWNER_REQUEST_DENIED',outsiderTry.pass,{code:outsiderTry.code});
 const requestId=await requestOwnerTransfer(clients.owner,club.id,candidate.id,ownerCandidates,[],true);
 mark('H19_APP_OWNER_REQUEST_ID_VALID',uuid(requestId));
 const afterOwner=await readMyOwnerTransfers(clients.owner);
 const afterRecipient=await readMyOwnerTransfers(clients.recipient);
 const outsider=await readMyOwnerTransfers(clients.outsider);
 const sender=afterOwner.find(r=>r.id===requestId);
 const recipient=afterRecipient.find(r=>r.id===requestId);
 mark('H19_APP_PENDING_SENDER_SCOPE',sender?.status==='pending'&&sender.is_sender&&!sender.is_recipient);
 mark('H19_APP_PENDING_RECIPIENT_SCOPE',recipient?.status==='pending'&&recipient.is_recipient&&!recipient.is_sender);
 mark('H19_APP_OTHER_ACCOUNT_SEES_NO_REQUESTS',outsider.length===0);
 const second=await denial(()=>requestOwnerTransfer(clients.owner,club.id,candidate.id,ownerCandidates,[],true),'PT409');
 mark('H19_APP_DUPLICATE_CONFLICT',second.pass,{code:second.code});
 const recipientMembers=await readMyMemberships(clients.recipient);
 mark('H19_APP_RECIPIENT_ELIGIBLE',canAcceptOwnerTransfer(recipient,recipientMembers));
 const wrongParty=await denial(()=>decideOwnerTransfer(clients.outsider,recipient,'accepted',recipientMembers,false,true),'42501');
 mark('H19_APP_THIRD_PARTY_CANNOT_ACCEPT',wrongParty.pass,{code:wrongParty.code});
 const nonConfirmed=await denial(()=>decideOwnerTransfer(clients.recipient,recipient,'accepted',recipientMembers,false,false));
 mark('H19_APP_CONFIRMATION_REQUIRED',nonConfirmed.pass);
 const ownerCancellationByRecipient=await denial(()=>decideOwnerTransfer(clients.recipient,sender,'cancelled',recipientMembers,true,true));
 mark('H19_APP_RECIPIENT_CANNOT_CANCEL',ownerCancellationByRecipient.pass);
 const success=await decideOwnerTransfer(clients.recipient,recipient,'declined',recipientMembers,false,true);
 mark('H19_APP_RECIPIENT_DECLINE',success==='declined');
 const afterDecline=await readMyOwnerTransfers(clients.recipient);
 mark('H19_APP_DECLINED_STATE_STORED',afterDecline.some(r=>r.id===requestId&&r.status==='declined'));
 const stale=await denial(()=>decideOwnerTransfer(clients.recipient,recipient,'accepted',recipientMembers,false,true),'PT409');
 mark('H19_APP_STALE_AFTER_DECLINE_DENIED',stale.pass,{code:stale.code});
 const raw=await clients.recipient.from('club_owner_transfer_requests').select('id').eq('club_id',club.id);
 mark('H19_APP_RAW_REQUEST_DENIED',raw.data===null&&!!raw.error,{http_status:raw.status??null});
 mark('H19_APP_WILL_NOT_MOVE_OWNER',!tests.some(t=>t.outcome==='FAIL'));
 if(tests.some(t=>t.outcome!=='PASS'))process.exitCode=1;
}catch(e){tests.push({name:'H19_APP_STAGE_RUNTIME',outcome:'BLOCKED'});process.exitCode=1;}
finally{
 for(const c of Object.values(clients))await c.auth.signOut({scope:'local'}).catch(()=>{});
 console.log(JSON.stringify({phase:'H19_STAGE_AUTH_APP_HELPER_ONE_SHOT',cleanup_required:'89_h19_real_http_fixture_cleanup.sql',tests},null,2));
}
})();
