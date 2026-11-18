import { mediaContext, limitedBody, jsonResponse, mediaError } from "@/lib/profile-media/server";
import { MediaFailure } from "@/lib/profile-media/service";
import { homeCourtName } from "@/lib/profile-options";
import { isUuid,type PrivateProfile } from "@/lib/profile-media/shared";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
 try {
  const { id }=await context.params,c=await mediaContext(request,id,true),bytes=await limitedBody(request);
  if(bytes.length>1024)throw new MediaFailure("入力が長すぎます",413);
  let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new MediaFailure("入力内容を確認してください",400);}
  if(!value||typeof value.name!=="string"||!Number.isSafeInteger(value.version)||value.version<0)throw new MediaFailure("入力内容を確認してください",400);
  let name;try{name=homeCourtName(value.name);}catch{throw new MediaFailure("ホームコートは80文字以内のコート名を入力してください",400);}
  if(Object.prototype.hasOwnProperty.call(value,"facilityId")){
   if(value.facilityId!==null&&(typeof value.facilityId!=="string"||!isUuid(value.facilityId)))throw new MediaFailure("施設を選択し直してください",400);
   const profile=await c.rpc<PrivateProfile>("save_my_home_court_selection",{p_profile:id,p_expected:value.version,p_facility:value.facilityId,p_name:name,p_ticket:c.ticket});
   // 保存確定後の補助読込み失敗で、確定した参照を取り消さない。
   const current=await c.read().catch(()=>null);
   return jsonResponse({profile:current?.profile??profile});
  }
  return jsonResponse({profile:await c.rpc<PrivateProfile>("save_my_home_court",{p_profile:id,p_expected:value.version,p_name:name,p_ticket:c.ticket})});
 }catch(error){return mediaError(error);}
}
