import { mediaContext, limitedBody, jsonResponse, mediaError } from "@/lib/profile-media/server";
import { MediaFailure } from "@/lib/profile-media/service";
import { homeCourtName } from "@/lib/profile-options";
import type { PrivateProfile } from "@/lib/profile-media/shared";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
 try {
  const { id }=await context.params,c=await mediaContext(request,id,true),bytes=await limitedBody(request);
  if(bytes.length>1024)throw new MediaFailure("入力が長すぎます",413);
  let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new MediaFailure("入力内容を確認してください",400);}
  if(!value||typeof value.name!=="string"||!Number.isSafeInteger(value.version)||value.version<0)throw new MediaFailure("入力内容を確認してください",400);
  let name;try{name=homeCourtName(value.name);}catch{throw new MediaFailure("ホームコートは80文字以内のコート名を入力してください",400);}
  return jsonResponse({profile:await c.rpc<PrivateProfile>("save_my_home_court",{p_profile:id,p_expected:value.version,p_name:name,p_ticket:c.ticket})});
 }catch(error){return mediaError(error);}
}
