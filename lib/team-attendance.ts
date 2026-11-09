import type { SupabaseClient } from '@supabase/supabase-js';
export type TeamAttendance = { side: 'team_a'|'team_b'; member_id: string|null; guest_id: string|null; status: 'active'|'absent' };
export async function readTeamAttendance(s: SupabaseClient,event: string): Promise<TeamAttendance[]> {
 const {data,error}=await s.from('event_team_attendance').select('side,member_id,guest_id,status').eq('event_id',event);
 if(error)throw new Error('参加状態を取得できませんでした。再読み込みしてください。');
 return data??[];
}
export const teamAbsent=(rows:TeamAttendance[],side:string,player:string|null,guest:string|null)=>rows.some(r=>r.side===side&&r.status==='absent'&&((!!player&&r.member_id===player)||(!!guest&&r.guest_id===guest)));
