import type { SupabaseClient } from '@supabase/supabase-js';
import type { RoundCard } from './guest-round-lineup';

export type LineupVersions = { version: 1; editing_enabled: boolean; event_revision: number; rounds: { round_id: string; revision: number }[] };
export type LineupSnapshot = {
 event_id: string; round_id: string; round_number: number; revision: number; event_revision: number; status: string; blocked_reason: string | null;
 eligible: string[]; people: { id: string; name: string; status: string }[];
 cards: { id: string; court_number: number; players: RoundCard['players']; completed: boolean; result: { id:string;score_a:number;score_b:number;winner_team:string }[] }[];
};
const message = (error: { code?: string; message?: string } | null, fallback: string) => error?.code === 'PGRST202' ? 'DB更新が未適用です。管理者に確認してください。' : error?.message || fallback;
export async function readLineupVersions(s: SupabaseClient, eventId: string): Promise<LineupVersions> {
 const { data, error } = await s.rpc('get_friendly_lineup_versions', { p_event_id: eventId });
 if (error || data?.version !== 1 || !Array.isArray(data.rounds) || !Number.isSafeInteger(data.event_revision)) throw new Error(message(error, 'メンバー構成の版数を確認できませんでした。'));
 return data;
}
export async function readRoundLineup(s: SupabaseClient, eventId: string, roundId: string): Promise<LineupSnapshot> {
 const { data, error } = await s.rpc('get_friendly_round_lineup', { p_event_id: eventId, p_round_id: roundId });
 if (error || data?.event_id !== eventId || data.round_id !== roundId || !Array.isArray(data.cards) || !Array.isArray(data.people) || !Array.isArray(data.eligible)) throw new Error(message(error, 'Roundを読み込めませんでした。'));
 return data;
}
export function createLineupCommit(s: SupabaseClient, snapshot: LineupSnapshot) {
 snapshot = structuredClone(snapshot);
 let pending: { cards: string; id: string } | null = null;
 return async (cards: RoundCard[]) => {
  const payload = cards.map(c => ({ id:c.id, players:c.players.map(p => ({ participant_id:p.participant_id, team:p.team })) }));
  const serialized = JSON.stringify(payload);
  if (pending && pending.cards !== serialized) throw new Error('保存結果が不明のため変更内容を変えずに再試行してください。');
  pending ??= { cards: serialized, id: crypto.randomUUID() };
  const { data, error } = await s.rpc('replace_friendly_round_lineup', { p_event_id:snapshot.event_id, p_round_id:snapshot.round_id, p_expected:snapshot, p_cards:payload, p_request_id:pending.id });
  if (error || data?.request_id !== pending.id || data.snapshot?.round_id !== snapshot.round_id) throw new Error(message(error, '保存結果を確認できません。同じ内容で再試行してください。'));
  return data.snapshot as LineupSnapshot;
 };
}
export const canonicalPlayers = (players: RoundCard['players']) => players.map(p=>({participant_id:p.participant_id,team:p.team})).sort((a,b)=>a.team.localeCompare(b.team)||a.participant_id.localeCompare(b.participant_id));
type ScoredCard = RoundCard & { round_id?: string|null; lineup_revision?: number; result?: {id?: string; score_a:number;score_b:number;winner_team:string}|null };
// 削除確認で見ていた構成・結果を固定し、応答喪失時も同一要求を再送する。
export function createFriendlyDeleteCommit(s: SupabaseClient, eventId: string, match: ScoredCard) {
 const displayed = structuredClone(match), requestId = crypto.randomUUID();
 let expected: LineupSnapshot | null = null;
 return async () => {
  if (!displayed.round_id) throw new Error('Roundを確認できません。再読み込みしてください。');
  if (!expected) {
   const snapshot = await readRoundLineup(s,eventId,displayed.round_id), card = snapshot.cards.find(c=>c.id===displayed.id);
   const scoreKey = (r: {id?:string;score_a:number;score_b:number;winner_team:string}) => [r.id,r.score_a,r.score_b,r.winner_team];
   const result = displayed.result ? [scoreKey(displayed.result)] : [];
   if (!card || snapshot.revision !== (displayed.lineup_revision??0) || JSON.stringify(canonicalPlayers(card.players)) !== JSON.stringify(canonicalPlayers(displayed.players)) || card.completed !== displayed.completed || JSON.stringify(card.result.map(scoreKey)) !== JSON.stringify(result)) throw new Error('構成またはスコアが変更されています。最新データで削除を確認し直してください。');
   expected = snapshot;
  }
  const {data,error} = await s.rpc('delete_friendly_match',{p_event_id:eventId,p_match_id:displayed.id,p_expected:expected,p_request_id:requestId});
  if (error || data?.request_id!==requestId || data.match_id!==displayed.id || data.deleted!==true) throw new Error(message(error,'削除結果を確認できません。同じ操作で再試行してください。'));
 };
}
// この関数が返す送信操作をキューに保持する。再試行で新しい構成へ期待値を置き換えない。
export function createFriendlyScoreCommit(s: SupabaseClient, eventId: string, match: ScoredCard) {
 const expectedRevision=match.lineup_revision??0,matchId=match.id;
 const expectedPlayers=canonicalPlayers(match.players), expectedScore={completed:match.completed,results:match.result?[{id:match.result.id,score_a:match.result.score_a,score_b:match.result.score_b,winner_team:match.result.winner_team}]:[]};
 let request: { a: number; b: number; id:string } | null = null;
 return async (a:number,b:number) => {
  if(request && (request.a!==a||request.b!==b)) throw new Error('保存結果を確認してから新しいスコアを入力してください。');
  request ??= {a,b,id:crypto.randomUUID()};
  const {data,error}=await s.rpc('save_friendly_match_score',{p_event_id:eventId,p_match_id:matchId,p_revision:expectedRevision,p_players:expectedPlayers,p_expected_score:expectedScore,p_a:a,p_b:b,p_request_id:request.id});
  if(error || data?.request_id!==request.id || data.match_id!==matchId || !data.result?.id || data.result.score_a!==a || data.result.score_b!==b) throw new Error('スコア保存：'+message(error,'保存結果を確認できません。同じ操作で再試行してください。'));
  return data.result as {id:string;score_a:number;score_b:number;winner_team:'A'|'B'|'draw'};
 };
}
