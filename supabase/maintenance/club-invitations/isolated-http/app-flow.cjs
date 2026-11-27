// Synthetic local JWT/PostgREST integration of application functions only.
const fs=require('fs'),cp=require('child_process'),path=require('path'),assert=require('assert/strict');
require('node:module').registerHooks({resolve(s,c,next){return next(['./profile-links','./player-profiles','./group-read','./friendly-round-history','./permissions'].includes(s)?s+'.ts':s,c)}});
const root=path.resolve(__dirname,'../../../..'),{createClient}=require('@supabase/supabase-js');
const {deliverClaimedInvitation}=require(path.join(root,'lib/club-invite-delivery.ts'));
const {listClubInvitations,previewClubInvitation,acceptClubInvitation}=require(path.join(root,'lib/club-invitations.ts'));
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const localFetch=async(url,init={})=>{const p=new URL(String(url)),h=new Headers(init.headers||{});const args=['--host=unix:///var/run/docker.sock','exec','-e','http_proxy=','-e','https_proxy=','-e','HTTP_PROXY=','-e','HTTPS_PROXY=','-e','ALL_PROXY=','-e','all_proxy=',input.container,'wget','-S','-O','-','-T','10'];for(const [k,v] of h)args.push('--header='+k+': '+v);if(init.body!=null)args.push('--post-data='+String(init.body));args.push('http://'+input.rest+p.pathname.replace(/^\/rest\/v1/,'')+p.search);const r=cp.spawnSync('docker',args,{encoding:'utf8'}),found=[...r.stderr.matchAll(/HTTP\/\S+\s+(\d+)/g)];if(!found.length)throw Error('local transport failure');return new Response(r.stdout,{status:Number(found.at(-1)[1]),headers:{'content-type':'application/json'}})};
const client=token=>createClient('http://local.invalid','synthetic-key',{global:{fetch:localFetch,headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}});
async function rpc(db,name,args){const {data,error}=await db.rpc(name,args);if(error)throw Error('synthetic RPC failure');return data}
(async()=>{
 if(input.mode==='send'){
  const svc=client(input.service);let reserved,delivered=0;
  const deps={reserve:async()=>reserved=await rpc(svc,'reserve_club_invite_send',input.args),claim:async op=>rpc(svc,'claim_club_invite_send',{p_operation_id:op}),send:async claim=>{assert.equal(claim.email,input.args.p_email);delivered++;return {result:'sent',failure:null}},finalize:async(op,g,r)=>rpc(svc,'finalize_club_invite_send',{p_operation_id:op,p_generation:g,p_result:r.result,p_failure_code:r.failure})};
  assert.deepEqual(await deliverClaimedInvitation(input.args.p_operation_id,deps),{status:'sent'});
  assert.deepEqual(await deliverClaimedInvitation(input.args.p_operation_id,deps),{status:'sent'});assert.equal(delivered,1);
  console.log(JSON.stringify({invite:reserved.invite_id,generation:reserved.generation}));
 }else{
  const db=client(input.token),other=client(input.other);const items=await listClubInvitations(db);const item=items.find(i=>i.invite_id===input.invite);assert(item);const p=await previewClubInvitation(db,item);
  await assert.rejects(previewClubInvitation(other,item));
  await assert.rejects(acceptClubInvitation(db,p,{name:'本人',publicChoice:false,consent:false,operationId:input.operation}));
  const result=await acceptClubInvitation(db,p,{name:'本人',publicChoice:false,consent:true,operationId:input.operation});assert.equal(result.status,'approved');
  console.log(JSON.stringify({status:'approved'}));
 }
})().catch(e=>{console.error(e.stack);process.exit(1)});
