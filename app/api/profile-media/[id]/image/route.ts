import { mediaContext, mediaError } from "@/lib/profile-media/server";
import { isUuid } from "@/lib/profile-media/shared";
import { MediaFailure } from "@/lib/profile-media/service";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 try{
  const {id}=await context.params,c=await mediaContext(request,id),{profile}=await c.read();
  if(!profile.avatar_key||new URL(request.url).searchParams.get("version")!==String(profile.avatar_version))throw new MediaFailure("画像が更新されています",404);
  const suffix=profile.avatar_key.slice(`profiles/${id}/`.length);
  if(!profile.avatar_key.startsWith(`profiles/${id}/`)||!suffix.endsWith(".webp")||!isUuid(suffix.slice(0,-5)))throw new MediaFailure("画像の参照情報を確認してください",503);
  const headers={"Cache-Control":"private, max-age=300, must-revalidate","Vary":"Authorization","ETag":`"profile-${id}-${profile.avatar_version}"`,"Content-Type":"image/webp","X-Content-Type-Options":"nosniff"};
  if(request.headers.get("if-none-match")===headers.ETag)return new Response(null,{status:304,headers});
  if(!c.env.PROFILE_IMAGES)throw new MediaFailure("プロフィール画像は準備中です",503);
  const image=await c.env.PROFILE_IMAGES.get(profile.avatar_key);
  if(!image)throw new MediaFailure("画像を取得できませんでした",404);
  return new Response(image.body,{headers});
 }catch(error){return mediaError(error);}
}
