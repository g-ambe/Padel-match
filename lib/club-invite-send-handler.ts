import { deliverClaimedInvitation, type Claim } from './club-invite-delivery';
import type { MailClaim, MailResult } from './club-invite-smtp';
type Backend={actor:string;rpc:(name:string,args:Record<string,unknown>)=>Promise<any>;send:(claim:MailClaim)=>Promise<MailResult>;sendConfirmation:(email:string)=>Promise<MailResult>};
type Dependencies={enabled:boolean;origin:()=>Promise<string>;backend:(request:Request,origin:string)=>Promise<Backend>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const inviteDeliveryReply=(status:string,code=200)=>Response.json({status},{status:code,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
// The production entry point always supplies enabled=false until reviewed.
export async function handleInviteDelivery(request:Request,deps:Dependencies){
 try{
  if(!deps.enabled)return inviteDeliveryReply('not_ready',503);
  const origin=await deps.origin();const canonical=new URL(origin);
  if(canonical.protocol!=='https:'||canonical.origin!==origin||request.headers.get('origin')!==origin||new URL(request.url).origin!==origin)return inviteDeliveryReply('unavailable',403);
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')||Number(request.headers.get('content-length')||0)>4096||!request.body)return inviteDeliveryReply('unavailable',400);
  const reader=request.body.getReader();let total=0;const chunks:Uint8Array[]=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>4096){await reader.cancel();return inviteDeliveryReply('unavailable',413);}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const body=JSON.parse(new TextDecoder().decode(bytes));
  if(!body||typeof body!=='object'||typeof body.operationId!=='string'||!uuid.test(body.operationId))return inviteDeliveryReply('unavailable',400);
  const initial=body.mode==='initial',resend=body.mode==='manager'||body.mode==='recipient';
  if(!initial&&!resend)return inviteDeliveryReply('unavailable',400);
  if(initial&&(typeof body.clubId!=='string'||!uuid.test(body.clubId)||typeof body.memberId!=='string'||!uuid.test(body.memberId)||typeof body.ticket!=='string'||!/^[0-9a-f]{64}$/.test(body.ticket)||typeof body.email!=='string'||body.email.length>254))return inviteDeliveryReply('unavailable',400);
  if(resend&&body.kind!==undefined&&body.kind!=='group_invite'&&body.kind!=='auth_confirmation')return inviteDeliveryReply('unavailable',400);
  if(resend&&(typeof body.inviteId!=='string'||!uuid.test(body.inviteId)||!Number.isSafeInteger(body.generation)||body.generation<1))return inviteDeliveryReply('unavailable',400);
  const {actor,rpc,send,sendConfirmation}=await deps.backend(request,origin);
  const result=await deliverClaimedInvitation(body.operationId,{
   reserve:()=>initial?rpc('reserve_club_invite_send',{p_actor:actor,p_club:body.clubId,p_member:body.memberId,p_operation_id:body.operationId,p_ticket:body.ticket,p_email:body.email}):rpc('reserve_club_invite_resend',{p_actor:actor,p_mode:body.mode,p_invite:body.inviteId,p_generation:body.generation,p_operation_id:body.operationId,p_kind:body.kind??'group_invite',p_secret:null,p_ip_digest:null}),
   claim:(id:string)=>rpc('claim_club_invite_send',{p_operation_id:id}) as Promise<Claim>,send,sendConfirmation,
   finalize:(id,generation,outcome)=>rpc('finalize_club_invite_send',{p_operation_id:id,p_generation:generation,p_result:outcome.result,p_failure_code:outcome.failure})
  });return inviteDeliveryReply(result.status);
 }catch{return inviteDeliveryReply('unavailable',503);}
}
