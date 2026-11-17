import { instagramUsername, isUuid, validateWebp, type PrivateProfile } from "@/lib/profile-media/shared";
import { changeImage, collectGarbage, MediaFailure } from "@/lib/profile-media/service";
import { jsonResponse, limitedBody, mediaContext, mediaError } from "@/lib/profile-media/server";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params, c = await mediaContext(request,id), op = new URL(request.url).searchParams.get("request");
    if(op&&!isUuid(op))throw new MediaFailure("操作IDを確認してください",400);
    const configured=!!(c.env.PROFILE_IMAGES&&c.env.PROFILE_MEDIA_COMMIT_SECRET&&c.env.PROFILE_MEDIA_RATE_LIMITER);
    const imageEnabled=configured&&await c.rpc<boolean>("profile_media_ready",{p_proof:c.env.PROFILE_MEDIA_COMMIT_SECRET}).catch(()=>false);
    return jsonResponse({ ...await c.read(op??undefined), imageEnabled });
  } catch(error){return mediaError(error);}
}
export async function PATCH(request: Request, context: Context) {
  try {
    const {id}=await context.params,c=await mediaContext(request,id,true);
    if(Number(request.headers.get("content-length"))>1024)throw new MediaFailure("入力が長すぎます",413);
    const body=await limitedBody(request);if(body.length>1024)throw new MediaFailure("入力が長すぎます",413);
    let values;try{values=JSON.parse(new TextDecoder().decode(body));}catch{throw new MediaFailure("入力内容を確認してください",400);}
    if(!values||typeof values!=="object"||typeof values.username!=="string"||!Number.isSafeInteger(values.version)||values.version<0)throw new MediaFailure("入力内容を確認してください",400);
    let name;try{name=instagramUsername(values.username);}catch{throw new MediaFailure("Instagram IDの形式を確認してください",400);}
    return jsonResponse({profile:await c.rpc<PrivateProfile>("save_my_instagram",{p_profile:id,p_expected:values.version,p_username:name,p_ticket:c.ticket})});
  }catch(error){return mediaError(error);}
}
async function image(request:Request,context:Context,kind:"upload"|"delete"){
  try{
    const {id}=await context.params,c=await mediaContext(request,id,true);
    if(!c.env.PROFILE_IMAGES||!c.env.PROFILE_MEDIA_COMMIT_SECRET)throw new MediaFailure("プロフィール画像は準備中です",503);
    if(!await c.rpc<boolean>("profile_media_ready",{p_proof:c.env.PROFILE_MEDIA_COMMIT_SECRET}))throw new MediaFailure("画像APIとDBの連携設定は準備中です",503);
    const operation=request.headers.get("x-profile-request")??"",rawVersion=request.headers.get("x-profile-version")??"",version=Number(rawVersion);
    if(!isUuid(operation)||!/^\d+$/.test(rawVersion)||!Number.isSafeInteger(version))throw new MediaFailure("画像の操作情報を確認してください",400);
    let bytes:Uint8Array|undefined;
    if(kind==="upload"){
      if(request.headers.get("content-type")!=="image/webp")throw new MediaFailure("WebP画像を指定してください",415);
      bytes=await limitedBody(request);try{validateWebp(bytes);}catch{throw new MediaFailure("512×512px以内・200KB以下の静止WebP画像を指定してください",400);}
    }
    const profile=await changeImage({profile:id,request:operation,version,kind,ticket:c.ticket!,bytes,proof:c.env.PROFILE_MEDIA_COMMIT_SECRET,bucket:c.env.PROFILE_IMAGES,rpc:c.rpc,read:()=>c.read(operation),onCommitted:oldKey=>c.waitUntil(collectGarbage(c.rpc,c.env.PROFILE_IMAGES!,c.env.PROFILE_MEDIA_COMMIT_SECRET!,oldKey).catch(()=>{}))});
    return jsonResponse({profile});
  }catch(error){return mediaError(error);}
}
export const PUT=(request:Request,context:Context)=>image(request,context,"upload");
export const DELETE=(request:Request,context:Context)=>image(request,context,"delete");
