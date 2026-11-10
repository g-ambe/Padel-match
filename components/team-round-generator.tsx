"use client";
import { useEffect, useRef, useState } from "react";
import { AppDialog } from "@/components/app-dialog";
import { getSupabaseClient } from "@/lib/supabase";
import { friendlyTeamRoundError, generateTeamRound, type TeamRoundContext, type TeamRoundDraft, type TeamRoundMode, type TeamRoundPlayer } from "@/lib/friendly-team-rounds";

export function TeamRoundPerson({ player, teamNames }: { player: Pick<TeamRoundPlayer,"source"|"name">; teamNames: [string,string] }) {
  return <span className={`team-player-picker team-side-${player.source === "team_a" ? "a" : "b"} min-w-0`}><span className="team-player-heading break-words">{player.name}<span className="ml-1 text-[10px] opacity-80">({teamNames[player.source === "team_a" ? 0 : 1]})</span></span></span>;
}
export function TeamRoundGenerator({ eventId, teamNames, counts, courtCount, disabled, onSaved, onBusyChange }: { eventId: string; teamNames: [string,string]; counts: [number,number]; courtCount: number; disabled: boolean; onSaved: () => Promise<void>; onBusyChange: (busy:boolean)=>void }) {
  const [mode,setMode]=useState<TeamRoundMode>("confrontation"),[courts,setCourts]=useState(courtCount),[draft,setDraft]=useState<TeamRoundDraft|null>(null);
  const [request,setRequest]=useState<{id:string;revision:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const lock=useRef(false);
  const insufficient=counts.some(count=>count<2);
  useEffect(()=>{onBusyChange(busy||!!draft);return()=>onBusyChange(false);},[busy,!!draft,onBusyChange]);
  const preview=async()=>{
    if(lock.current||disabled)return;lock.current=true;setBusy(true);setError("");
    try{
      const db=getSupabaseClient();if(!db)throw new Error("通信の準備ができませんでした");
      const result=await db.rpc("get_friendly_team_round_context",{p_event:eventId});
      if(result.error)throw new Error(friendlyTeamRoundError(result.error,"参加状態を取得できませんでした。再度お試しください"));
      const context=result.data as TeamRoundContext;
      setDraft(generateTeamRound(context,mode,courts));setRequest({id:crypto.randomUUID(),revision:context.revision});
    }catch(cause){setError(cause instanceof Error?cause.message:"編成できませんでした。再度お試しください");}
    finally{lock.current=false;setBusy(false);}
  };
  const save=async()=>{
    if(lock.current||!draft||!request||disabled)return;lock.current=true;setBusy(true);setError("");
    try{
      const db=getSupabaseClient();if(!db)throw new Error("通信の準備ができませんでした");
      const result=await db.rpc("create_friendly_team_round",{p_event:eventId,p_request:request.id,p_revision:request.revision,p_mode:draft.mode,p_courts:courts,p_cards:draft.courts});
      if(result.error)throw new Error(friendlyTeamRoundError(result.error));
      setDraft(null);setRequest(null);
      try{await onSaved();}catch{setError("保存しましたが再読み込みに失敗しました。画面を更新してください");}
    }catch(cause){setError(cause instanceof Error?cause.message:"保存できませんでした。編成を保持しています。再試行してください");}
    finally{lock.current=false;setBusy(false);}
  };
  const cancel=()=>{if(!lock.current){setDraft(null);setRequest(null);setError("");}};
  return <section className="space-y-2 rounded-xl border border-zinc-700 p-3" aria-label="次のラウンドを生成">
    <h2 className="text-sm font-bold">次のラウンドを生成</h2>
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="自動編成モード">{([["confrontation","チーム対決"],["mixed","チーム混合"]] as const).map(([value,label])=><button key={value} type="button" disabled={disabled||busy||!!draft} aria-pressed={mode===value} className={`min-h-11 rounded-xl border px-2 text-sm ${mode===value?"border-accent text-accent":"border-zinc-700 text-zinc-400"}`} onClick={()=>setMode(value)}>{label}</button>)}</div>
    <p className="break-words text-xs text-zinc-400">{teamNames[0]}：{counts[0]}名 / {teamNames[1]}：{counts[1]}名</p>
    <div className="flex items-center gap-2"><label className="flex min-h-11 items-center gap-2 text-sm">利用コート数<select className="rounded-lg border border-zinc-600 bg-card p-2" value={courts} disabled={disabled||busy||!!draft} onChange={e=>setCourts(Number(e.target.value))}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}面</option>)}</select></label><button type="button" disabled={disabled||busy||!!draft||insufficient} className="min-h-11 flex-1 rounded-xl bg-accent px-3 text-sm font-bold text-black disabled:opacity-40" onClick={()=>void preview()}>{busy&&!draft?"確認中…":"次のラウンドを生成"}</button></div>
    {insufficient&&<p role="status" className="text-xs text-zinc-400">両チームに参加可能な選手が各2名以上必要です。</p>}
    {mode==="mixed"&&<p className="text-xs text-zinc-400">混合ペアで対戦します。チームの勝敗には加算しません。</p>}
    {!draft&&error&&<p role="alert" className="text-sm text-red-400">{error}</p>}
    <AppDialog open={!!draft} title="生成プレビュー" busy={busy} onClose={cancel}>
      <div className="min-h-0 space-y-3 overflow-y-auto p-3">{draft&&<><p className="text-sm">{draft.mode==="mixed"?"チーム混合":"チーム対決"} · {draft.courts.length}面</p>{draft.courts.map(c=><section key={c.court} className="space-y-2 rounded-xl border border-zinc-700 p-2"><h3 className="text-xs">コート{c.court}</h3><div className="grid grid-cols-2 gap-2">{c.pairs.map((pair,index)=><div key={index} className="min-w-0 space-y-1"><p className="text-xs text-zinc-400">{draft.mode==="mixed"?`ペア${index+1}`:teamNames[index]}</p>{pair.map(p=><p key={p.key} className="text-sm"><TeamRoundPerson player={p} teamNames={teamNames}/></p>)}</div>)}</div></section>)}<div className="text-xs"><p className="mb-1 font-bold">今回の休憩（欠席とは別）</p>{draft.resting.length?draft.resting.map(p=><span key={`${p.source}:${p.key}`} className="mr-2 inline-block"><TeamRoundPerson player={p} teamNames={teamNames}/></span>):"なし"}</div></>}{error&&<p role="alert" className="text-sm text-red-400">{error}</p>}</div>
      <div className="shrink-0 space-y-2 border-t border-zinc-700 p-3"><button type="button" disabled={busy||disabled} className="min-h-11 w-full rounded-xl bg-accent px-3 font-bold text-black disabled:opacity-40" onClick={()=>void save()}>{busy?"保存中…":"確定して追加"}</button><div className="grid grid-cols-2 gap-2"><button type="button" disabled={busy||disabled} className="min-h-11 rounded-xl border border-zinc-600 text-sm" onClick={()=>void preview()}>再抽選</button><button type="button" disabled={busy} className="min-h-11 rounded-xl border border-zinc-600 text-sm" onClick={cancel}>キャンセル</button></div></div>
    </AppDialog>
  </section>;
}
