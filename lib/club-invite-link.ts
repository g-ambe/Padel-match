export type InviteLink = {invite:string;generation:number;secret:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseInviteFragment(fragment:string):InviteLink|null {
 const p=new URLSearchParams(fragment.startsWith("#")?fragment.slice(1):fragment);
 if([...p.keys()].sort().join(",")!=="generation,invite,secret")return null;
 const invite=p.get("invite"),g=p.get("generation"),secret=p.get("secret");
 if(!invite||!uuid.test(invite)||!g||!/^\d{1,9}$/.test(g)||Number(g)<1||!secret||!/^[0-9a-f]{64}$/.test(secret))return null;
 return {invite,generation:Number(g),secret};
}
export const inviteRecoveryKey="padel-invite-recovery-v1";
export function saveInviteRecovery(storage:Pick<Storage,"setItem">,link:InviteLink){storage.setItem(inviteRecoveryKey,JSON.stringify(link));}
export function readInviteRecovery(storage:Pick<Storage,"getItem">):InviteLink|null{
 try{const raw=storage.getItem(inviteRecoveryKey);if(!raw)return null;const value=JSON.parse(raw);return parseInviteFragment(new URLSearchParams({invite:String(value.invite),generation:String(value.generation),secret:String(value.secret)}).toString());}catch{return null;}
}
