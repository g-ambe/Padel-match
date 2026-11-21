export type GroupOrigin = "profile" | "discover" | "notifications" | "ranking";
export const groupOrigins: Record<GroupOrigin,string> = { profile:"/profile", discover:"/groups/discover", notifications:"/notifications", ranking:"/ranking" };
export type GroupOriginRecord = { account: string; path: string; y: number; expanded: boolean; inside: number };
const key = (token:string) => `padel_group_origin_v1:${token}`;
export function readGroupOrigin(storage: Pick<Storage,"getItem">, token: string|null, account: string|null): GroupOriginRecord|null {
  if(!token||!account||token.length>80)return null;
  try{const r=JSON.parse(storage.getItem(key(token))??"null");return r&&r.account===account&&Object.values(groupOrigins).includes(r.path)&&Number.isFinite(r.y)&&r.y>=0&&Number.isFinite(r.inside)&&r.inside>=0?r:null;}catch{return null;}
}
export function saveGroupOrigin(storage: Pick<Storage,"setItem">, token: string, record:GroupOriginRecord){storage.setItem(key(token),JSON.stringify(record));}
export function safeGroupReturn(origin:string|null) { return origin && Object.hasOwn(groupOrigins,origin) ? groupOrigins[origin as GroupOrigin] : "/profile#profile-groups"; }
export function safeGroupEventPath(path:string){return /^\/(events|team-matches|official-matches)\/[a-zA-Z0-9_-]+$/.test(path);}
export type GroupEventReturn = {account:string; group:string; path:string; tab:string; stat:string; mode:string; popups:unknown[]; y:number; inside:number};
export function readGroupEventReturn(storage: Pick<Storage,"getItem">, token:string|null, account:string|null):GroupEventReturn|null{
  if(!token||!account||token.length>80)return null;
  try{const r=JSON.parse(storage.getItem(`padel_group_event_v1:${token}`)??"null");return r&&r.account===account&&/^\/groups\/[a-zA-Z0-9_-]+(?:\?[^#]*)?$/.test(r.group)&&safeGroupEventPath(r.path)&&Array.isArray(r.popups)&&Number.isFinite(r.y)&&Number.isFinite(r.inside)?r:null;}catch{return null;}
}
