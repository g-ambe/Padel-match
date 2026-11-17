export const IMAGE_LIMIT = 200 * 1024;
export type PrivateProfile = { profile_id: string; owner_id: string; instagram_username: string | null; instagram_version: number; avatar_key: string | null; avatar_version: number; updated_at?: string };
export const emptyPrivateProfile = (profile: string, owner: string): PrivateProfile => ({ profile_id: profile, owner_id: owner, instagram_username: null, instagram_version: 0, avatar_key: null, avatar_version: 0 });
export function instagramUsername(value: string): string | null {
  const name = value.trim().replace(/^@/, "");
  if (!name) return null;
  if (name.length > 30 || !/^[A-Za-z0-9_](\.?[A-Za-z0-9_])*$/.test(name)) throw new Error("Instagram IDは30文字以内の英数字・_・.で入力してください（URLは登録できません）");
  return name;
}
export const instagramHref = (name: string) => `https://www.instagram.com/${encodeURIComponent(instagramUsername(name) ?? "")}/`;
export const isUuid = (id: string) => /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(id);
// 宣言MIMEではなくRIFF/WebP・フレーム寸法・チャンク長を検査。アニメーション/EXIF/XMP/ICC等は受理しない。
export function validateWebp(bytes: Uint8Array): { width: number; height: number } {
  const fail = () => { throw new Error("512×512px以内・200KB以下の静止WebP画像を選択してください"); };
  if (bytes.length < 20 || bytes.length > IMAGE_LIMIT) return fail();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WEBP" || v.getUint32(4, true) + 8 !== bytes.length) return fail();
  let frame: { width: number; height: number } | null = null, canvas: { width: number; height: number } | null = null, alpha = false;
  for (let at = 12; at < bytes.length;) {
    if (at + 8 > bytes.length) return fail();
    const kind = tag(at), size = v.getUint32(at + 4, true), start = at + 8, end = start + size;
    if (end > bytes.length || end + size % 2 > bytes.length) return fail();
    if (kind === "VP8 ") {
      if (frame || size < 10 || (bytes[start] & 1) || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 1 || bytes[start + 5] !== 0x2a) return fail();
      if ((v.getUint32(start, true) & 0xffffff) >>> 5 > size - 10) return fail();
      frame = { width: v.getUint16(start + 6, true) & 0x3fff, height: v.getUint16(start + 8, true) & 0x3fff };
    } else if (kind === "VP8L") {
      if (frame || size < 5 || bytes[start] !== 0x2f) return fail();
      const bits = v.getUint32(start + 1, true); if (bits >>> 29) return fail();
      frame = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    } else if (kind === "VP8X") {
      if (canvas || frame || size !== 10 || (bytes[start] & ~0x10) || bytes[start + 1] || bytes[start + 2] || bytes[start + 3]) return fail();
      const u24 = (p: number) => bytes[p] + bytes[p + 1] * 256 + bytes[p + 2] * 65536;
      canvas = { width: u24(start + 4) + 1, height: u24(start + 7) + 1 };
    } else if (kind === "ALPH") { if (alpha || frame || !canvas || size < 2) return fail(); alpha = true; }
    else return fail();
    at = end + size % 2;
  }
  if (!frame || !frame.width || !frame.height || frame.width > 512 || frame.height > 512 || (canvas && (canvas.width !== frame.width || canvas.height !== frame.height))) return fail();
  return frame;
}
// Canvasが付けるsRGBプロファイル等も送信前に落とす。元画像は必ず先にCanvasで再符号化する。
export function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),tag=(at:number)=>String.fromCharCode(...bytes.subarray(at,at+4));
  if(bytes.length<20||tag(0)!=="RIFF"||tag(8)!=="WEBP"||view.getUint32(4,true)+8!==bytes.length)throw new Error("WebP画像を変換できませんでした");
  const chunks:Uint8Array[]=[];let size=12;
  for(let at=12;at<bytes.length;){
    if(at+8>bytes.length)throw new Error("WebP画像を変換できませんでした");
    const count=view.getUint32(at+4,true),end=at+8+count+count%2,kind=tag(at);
    if(end>bytes.length)throw new Error("WebP画像を変換できませんでした");
    if(!["ICCP","EXIF","XMP "].includes(kind)){
      const chunk=bytes.slice(at,end);if(kind==="VP8X")chunk[8]&=~(0x20|0x08|0x04);chunks.push(chunk);size+=chunk.length;
    }
    at=end;
  }
  const result=new Uint8Array(size);result.set(bytes.subarray(0,12));new DataView(result.buffer).setUint32(4,size-8,true);let at=12;for(const chunk of chunks){result.set(chunk,at);at+=chunk.length;}
  validateWebp(result);return result;
}
// 画像とInstagramのHTTP応答順は一致しない。それぞれの版を独立して単調に反映する。
export function mergePrivateProfile(current: PrivateProfile | undefined, incoming: PrivateProfile): PrivateProfile {
  if (!current || current.profile_id !== incoming.profile_id || current.owner_id !== incoming.owner_id) return incoming;
  const next = { ...incoming };
  if (current.avatar_version > incoming.avatar_version) { next.avatar_key=current.avatar_key; next.avatar_version=current.avatar_version; }
  if (current.instagram_version > incoming.instagram_version) { next.instagram_username=current.instagram_username; next.instagram_version=current.instagram_version; }
  if (current.updated_at && incoming.updated_at && Date.parse(current.updated_at)>Date.parse(incoming.updated_at)) next.updated_at=current.updated_at;
  return next;
}
