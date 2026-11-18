import { PREFECTURES } from "./profile-options";
export type Facility = { id:string; name:string; prefecture:string|null; address?:string|null; aliases?:string[]; availability?:string; usage_note?:string|null };
export type HomeCourtSelection = { facilityId:string|null; name:string };
export const FACILITY_REGIONS:Record<string,readonly string[]>={
 "北海道":["北海道"],"東北":["青森県","岩手県","宮城県","秋田県","山形県","福島県"],"関東":["茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県"],"甲信越・北陸":["新潟県","富山県","石川県","福井県","山梨県","長野県"],"東海":["岐阜県","静岡県","愛知県","三重県"],"関西":["滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県"],"中国":["鳥取県","島根県","岡山県","広島県","山口県"],"四国":["徳島県","香川県","愛媛県","高知県"],"九州":["福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県"],"沖縄":["沖縄県"]
};
const normalize=(s:string)=>s.normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s・＆&]+/g,"");
export function facilityPrefecture(value:string|null){return PREFECTURES.find(p=>p===value||p.replace(/[都府県]$/u,"")===value)??value??"";}
export function filterFacilities(rows:readonly Facility[],area:string,query:string){
 const q=normalize(query),prefs=area.startsWith("region:")?FACILITY_REGIONS[area.slice(7)]:area.startsWith("pref:")?[area.slice(5)]:null;
 return rows.filter(f=>f.availability!=="closed"&&(!prefs||prefs.includes(facilityPrefecture(f.prefecture)))&&(!q||[f.name,f.address??"",f.prefecture??"",...(f.aliases??[])].some(v=>normalize(v).includes(q))));
}
export const facilityAvailability=(f:Facility)=>({seasonal:"季節営業",limited:"期間・利用条件あり",guests_only:"宿泊者専用",closed:"閉業",unverified:"利用可否は要確認"} as Record<string,string>)[f.availability??""]??"";
export function facilityDisplayName(profile?:{home_facility_id?:string|null;home_facility?:Facility|null;home_court_name?:string|null}){
 return profile?.home_facility_id&&profile.home_facility?.id===profile.home_facility_id?profile.home_facility.name:profile?.home_court_name??"";
}
export const PROFILE_GROUP_ACTIONS=[{href:"/groups/discover",label:"グループを探す",path:"m16 16 5 5",kind:"search"},{href:"/groups/new",label:"グループ新規作成",path:"M12 5v14M5 12h14",kind:"plus"}];
