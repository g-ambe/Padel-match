import { createClient } from "@supabase/supabase-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticatedMediaClient } from "@/lib/profile-media/server";
import { handleInviteDelivery } from "@/lib/club-invite-send-handler";
import { sendInvitationSmtp } from "@/lib/club-invite-smtp";

type Env={INVITE_SUPABASE_SERVICE_ROLE_KEY?:string;INVITE_SMTP_APP_PASSWORD?:string;INVITE_PUBLIC_ORIGIN?:string};
// This is intentionally not configurable. The route cannot deliver until a
// separately reviewed change removes this gate.
const DELIVERY_ENABLED: boolean = false;
export async function POST(request:Request){
 let config:Env|undefined;
 return handleInviteDelivery(request,{
  enabled:DELIVERY_ENABLED,
  origin:async()=>{const {env}=await getCloudflareContext({async:true});config=env as Env;if(!config.INVITE_PUBLIC_ORIGIN||!process.env.NEXT_PUBLIC_SUPABASE_URL||!config.INVITE_SUPABASE_SERVICE_ROLE_KEY||!config.INVITE_SMTP_APP_PASSWORD)throw Error();return config.INVITE_PUBLIC_ORIGIN;},
  backend:async(req,origin)=>{const {user}=await authenticatedMediaClient(req);const e=config!;const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,e.INVITE_SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10000)})}});
   const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await service.rpc(name,args);if(error||!data||typeof data!=="object")throw Error("unavailable");return data;};
   return {actor:user.id,rpc,send:async claim=>{const {connect}=await import(/* webpackIgnore: true */ "cloudflare:sockets");return sendInvitationSmtp(connect,claim,origin,e.INVITE_SMTP_APP_PASSWORD!);},sendConfirmation:async email=>{const {error}=await service.auth.resend({type:"signup",email,options:{emailRedirectTo:new URL("/login?confirmed=true",origin).toString()}});return error?{result:"unknown",failure:"uncertain"}:{result:"sent",failure:null};}};
  }
 });
}
