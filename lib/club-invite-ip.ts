// Only call with a platform-verified direct Cloudflare request; arbitrary
// forwarded headers and unverified proxies must never set trusted=true.
export function normalizeInviteIp(raw:string):string|null {
 if(!raw||raw.length>45||raw.trim()!==raw||raw.includes('%'))return null;
 if(/^\d+\.\d+\.\d+\.\d+$/.test(raw)){const parts=raw.split('.');if(parts.some(p=>p.length>1&&p.startsWith('0')||Number(p)>255))return null;return parts.map(Number).join('.');}
 if(!/^[0-9a-f:.]+$/i.test(raw)||!raw.includes(':'))return null;
 try{const host=new URL(`http://[${raw}]/`).hostname;if(!host.startsWith('[')||!host.endsWith(']'))return null;const value=host.slice(1,-1).toLowerCase();const mapped=/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(value);if(mapped){const a=parseInt(mapped[1],16),b=parseInt(mapped[2],16);return [a>>8,a&255,b>>8,b&255].join('.');}return value;}catch{return null;}
}
export async function anonymousInviteIpDigest(raw:string,secret:string,trusted:boolean):Promise<string|null>{
 if(!trusted)return null;const ip=normalizeInviteIp(raw);if(!ip)return null;
 try{const decoded=atob(secret);if(decoded.length!==32||btoa(decoded)!==secret)return null;const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);const digest=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('club-invite-ip-v1:'+ip)));return '\\x'+Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');}catch{return null;}
}
