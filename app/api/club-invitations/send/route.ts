import { createClient } from "@supabase/supabase-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticatedMediaClient } from "@/lib/profile-media/server";
import { deliverClaimedInvitation } from "@/lib/club-invite-delivery";
import { sendInvitationSmtp } from "@/lib/club-invite-smtp";

type Env={INVITE_SUPABASE_SERVICE_ROLE_KEY?:string;INVITE_SMTP_APP_PASSWORD?:string;INVITE_PUBLIC_ORIGIN?:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(status:string,code=200)=>Response.json({status},{status:code,headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}});
// The redemption/recovery path and E2E/security checks are not complete. No
// configuration can override this gate; remove only in a reviewed follow-up.
const DELIVERY_ENABLED: boolean = false;
export async function POST(request:Request){
 try{
  if(!DELIVERY_ENABLED)return reply("unavailable",503);
  const {env}=await getCloudflareContext({async:true});const e=env as Env;
  const origin=e.INVITE_PUBLIC_ORIGIN,url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  if(!origin||!url||!e.INVITE_SUPABASE_SERVICE_ROLE_KEY||!e.INVITE_SMTP_APP_PASSWORD)return reply("unavailable",503);
  const canonical=new URL(origin);if(canonical.protocol!=="https:"||canonical.origin!==origin||request.headers.get("origin")!==origin||new URL(request.url).origin!==origin)return reply("unavailable",403);
  if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")||Number(request.headers.get("content-length")||0)>4096||!request.body)return reply("unavailable",400);
  const reader=request.body.getReader();let total=0;const chunks:Uint8Array[]=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>4096){await reader.cancel();return reply("unavailable",413);}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const body=JSON.parse(new TextDecoder().decode(bytes));
  if(!body||typeof body!=="object"||typeof body.operationId!=="string"||!uuid.test(body.operationId))return reply("unavailable",400);
  const initial=body.mode==="initial",resend=body.mode==="manager"||body.mode==="recipient";
  if(!initial&&!resend)return reply("unavailable",400); // Bearer/anonymous is deliberately unavailable.
  if(initial&&(typeof body.clubId!=="string"||!uuid.test(body.clubId)||typeof body.memberId!=="string"||!uuid.test(body.memberId)||typeof body.ticket!=="string"||!/^[0-9a-f]{64}$/.test(body.ticket)||typeof body.email!=="string"||body.email.length>254))return reply("unavailable",400);
  if(resend&&(typeof body.inviteId!=="string"||!uuid.test(body.inviteId)||!Number.isSafeInteger(body.generation)||body.generation<1))return reply("unavailable",400);
  const {user}=await authenticatedMediaClient(request);
  const service=createClient(url,e.INVITE_SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10000)})}});
  const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await service.rpc(name,args);if(error||!data||typeof data!=="object")throw Error("unavailable");return data;};
  const result=await deliverClaimedInvitation(body.operationId,{
   reserve:()=>initial?rpc("reserve_club_invite_send",{p_actor:user.id,p_club:body.clubId,p_member:body.memberId,p_operation_id:body.operationId,p_ticket:body.ticket,p_email:body.email}):rpc("reserve_club_invite_resend",{p_actor:user.id,p_mode:body.mode,p_invite:body.inviteId,p_generation:body.generation,p_operation_id:body.operationId,p_kind:"group_invite",p_secret:null,p_ip_digest:null}),
   claim:id=>rpc("claim_club_invite_send",{p_operation_id:id}),
   send:async claim=>{const {connect}=await import(/* webpackIgnore: true */ "cloudflare:sockets");return sendInvitationSmtp(connect,claim,origin,e.INVITE_SMTP_APP_PASSWORD!);},
   finalize:(id,generation,outcome)=>rpc("finalize_club_invite_send",{p_operation_id:id,p_generation:generation,p_result:outcome.result,p_failure_code:outcome.failure})
  });
  return reply(result.status);
 }catch{return reply("unavailable",503);}
}
