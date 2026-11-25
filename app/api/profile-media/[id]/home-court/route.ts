import { mediaContext, limitedBody, jsonResponse, mediaError } from "@/lib/profile-media/server";
import { MediaFailure } from "@/lib/profile-media/service";
import { isUuid,type PrivateProfile } from "@/lib/profile-media/shared";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
 try {
  const { id }=await context.params,c=await mediaContext(request,id,true),bytes=await limitedBody(request);
  if(bytes.length>1024)throw new MediaFailure("入力が長すぎます",413);
  let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new MediaFailure("入力内容を確認してください",400);}
  if(!value||typeof value.name!=="string"||!Number.isSafeInteger(value.version)||value.version<0)throw new MediaFailure("入力内容を確認してください",400);
  const hasFacility=Object.prototype.hasOwnProperty.call(value,"facilityId"),facilityId=hasFacility?value.facilityId:null;
  if(facilityId!==null&&(typeof facilityId!=="string"||!isUuid(facilityId)))throw new MediaFailure("施設を選択し直してください",400);
  // 旧クライアントも新規の自由入力は拒否。空文字での明示的解除は維持する。
  if(facilityId===null&&value.name.trim()!=="")throw new MediaFailure("ホームコートは施設一覧から選択してください。画面を再読み込みしてください",400);
   const profile=await c.rpc<PrivateProfile>("save_my_home_court_selection",{p_profile:id,p_expected:value.version,p_facility:facilityId,p_name:"",p_ticket:c.ticket});
   // 保存確定後の補助読込み失敗で、確定した参照を取り消さない。
   const current=await c.read().catch(()=>null);
   return jsonResponse({profile:current?.profile??profile});
 }catch(error){return mediaError(error);}
}
