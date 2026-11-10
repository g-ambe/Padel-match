"use client";
import { useEffect, useRef, useState } from "react";
import { stepTitles, type DemoStep } from "@/lib/tutorial-content";

const names = ["青木", "今野", "神原", "安倍", "赤木", "蓮見", "佐藤", "中村"];
const button = "min-h-11 rounded-xl border border-zinc-600 px-3 py-2 text-sm disabled:opacity-40";
const action = `${button} border-accent bg-accent font-bold text-black`;

// Supabase・生成器・ScoreInput・保存キューを参照しない、完全に独立した操作体験。
export function TutorialDemo({ steps, onClose, onComplete, notice }: { steps: readonly DemoStep[]; onClose: () => void; onComplete: () => void; notice?: string }) {
  const [index, setIndex] = useState(0), [group, setGroup] = useState(false), [members, setMembers] = useState(4);
  const [format, setFormat] = useState(false), [event, setEvent] = useState(false), [name, setName] = useState("はじめてのパデル"), [courts, setCourts] = useState(1);
  const [selected, setSelected] = useState(names), [touched, setTouched] = useState(false), [generated, setGenerated] = useState(false);
  const [score, setScore] = useState<[number | null, number | null]>([null, null]), [editing, setEditing] = useState<0 | 1 | null>(null), [ended, setEnded] = useState(false);
  const [teamMode, setTeamMode] = useState("manual"), [teamPreview, setTeamPreview] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = steps[index], last = index === steps.length - 1;
  useEffect(() => { heading.current?.scrollIntoView({ block: "nearest", behavior: "auto" }); }, [index]);
  const ready = { group, members: members > 4, format, event, participants: touched && selected.length >= 4, round: generated, score: score.every(v => v !== null), results: ended, team: teamPreview }[step];
  const used = Math.min(courts, Math.floor(selected.length / 4)) * 4;
  return <div data-tutorial-demo className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-3">
      <p className="text-xs font-bold text-accent">操作体験中 · 実際のデータは変更しません</p>
      <div className="flex items-center justify-between gap-2"><h3 ref={heading} className="text-base font-bold">{stepTitles[step]}</h3><span className="shrink-0 text-xs">{index + 1} / {steps.length}</span></div>
      {step === "group" && <><p className="text-sm">まずは仲間と使うグループを作りましょう。</p><button className={action} onClick={() => setGroup(true)}>＋ グループ作成</button>{group && <div className="rounded-xl border border-accent p-3">体験用パデル部 <span className="text-xs">作成しました</span></div>}</>}
      {step === "members" && <><p className="text-sm">グループにメンバーを追加します。</p><ul className="grid grid-cols-2 gap-2 text-sm">{names.slice(0, members).map(n => <li key={n} className="rounded-lg bg-zinc-800 p-2">{n}</li>)}</ul><button className={action} onClick={() => setMembers(n => Math.min(8, n + 4))}>＋ メンバー追加</button></>}
      {step === "format" && <><p className="text-sm">今回は組み合わせ戦を選びます。</p><button aria-pressed={format} className={`${button} w-full ${format ? "border-accent bg-accent text-black" : ""}`} onClick={() => setFormat(true)}>通常フレンドリー（組み合わせ戦）</button><p className="text-xs text-zinc-400">チーム戦は、チームごとに選手を選ぶ形式です。</p></>}
      {step === "event" && <><label className="block text-sm">イベント名<input aria-label="体験用イベント名" className="mt-1 min-h-11 w-full rounded-lg bg-zinc-800 p-2" value={name} onChange={e => { setName(e.target.value); setEvent(false); }} /></label><label className="flex min-h-11 items-center justify-between text-sm">コート数<select aria-label="体験用コート数" className="rounded-lg bg-card p-2" value={courts} onChange={e => { setCourts(Number(e.target.value)); setEvent(false); }}><option value="1">1面</option><option value="2">2面</option></select></label><button disabled={!name.trim()} className={action} onClick={() => setEvent(true)}>イベントを作成</button>{event && <p role="status" className="text-sm">「{name}」を体験用に作成しました。</p>}</>}
      {step === "participants" && <><p className="text-sm">名前をタップして参加・休憩を切り替えます。4名以上を選びましょう。</p><div className="grid grid-cols-2 gap-2">{names.map(n => <button key={n} className={`${button} ${selected.includes(n) ? "border-accent text-accent" : ""}`} aria-pressed={selected.includes(n)} onClick={() => { setTouched(true); setSelected(rows => rows.includes(n) ? rows.filter(v => v !== n) : [...rows, n]); }}>{n} · {selected.includes(n) ? "参加" : "休憩"}</button>)}</div><p className="text-xs">{selected.length}名が参加中</p></>}
      {step === "round" && <><p className="text-sm">参加人数に合わせて対戦と自動休憩が決まります。</p><button className={action} onClick={() => setGenerated(true)}>ラウンドを生成</button>{generated && <div className="space-y-2">{Array.from({ length: used / 4 }, (_, i) => <div key={i} className="rounded-xl border border-zinc-700 p-3"><p className="text-xs">コート{i + 1}</p><div className="grid grid-cols-2 gap-2 text-sm"><p className="border-l-2 border-emerald-500 pl-2">{selected.slice(i * 4, i * 4 + 2).join("・")}</p><p className="border-l-2 border-blue-500 pl-2">{selected.slice(i * 4 + 2, i * 4 + 4).join("・")}</p></div></div>)}<p className="text-xs">今回の自動休憩：{selected.slice(used).join("・") || "なし"}（手動の休憩設定とは別です）</p></div>}</>}
      {step === "score" && <><p className="text-sm">得点欄をタップして、両ペアの数字を選びます。</p><div className="grid grid-cols-2 gap-2">{([0, 1] as const).map(i => <button key={i} aria-label={`体験ペア${i + 1}の得点`} className={`${button} border-2 ${i ? "border-blue-500" : "border-emerald-500"}`} onClick={() => setEditing(i)}><span className="block text-xs">ペア{i + 1}</span><span className="text-3xl font-bold">{score[i] ?? "−"}</span></button>)}</div>{editing !== null && <div className="rounded-xl border border-accent p-2"><p className="mb-2 text-xs">ペア{editing + 1}の得点を選択</p><div className="grid grid-cols-4 gap-2">{Array.from({ length: 8 }, (_, n) => <button key={n} className={button} onClick={() => { setScore(old => editing === 0 ? [n, old[1]] : [old[0], n]); setEditing(editing === 0 && score[1] === null ? 1 : null); }}>{n}</button>)}</div><button className={button} onClick={() => setEditing(null)}>数字選択を閉じる</button></div>}{score.every(n => n !== null) && <p role="status" className="text-sm text-accent">体験内に保存しました（実際のスコアは保存しません）</p>}</>}
      {step === "results" && <><p className="text-sm">スコアを確認したらイベントを終了し、結果を見ます。</p><button className={action} onClick={() => setEnded(true)}>イベントを終了</button>{ended && <div className="space-y-2 rounded-xl border border-accent p-3"><h4 className="font-bold">当日の結果（サンプル）</h4><p className="text-sm">ペア1 {score[0] ?? 4} − {score[1] ?? 2} ペア2</p><p className="text-xs">青木：1試合 · 今野：1試合</p><p className="font-bold text-accent">これで準備完了！</p></div>}</>}
      {step === "team" && <><p className="text-sm">試合を追加する方法を選び、カードを表示してみましょう。</p><div className="grid gap-2">{[["manual", "手動追加"], ["confrontation", "チーム対決乱数"], ["mixed", "チーム混合乱数"]].map(([key, label]) => <button key={key} aria-pressed={teamMode === key} className={`${button} ${teamMode === key ? "border-accent text-accent" : ""}`} onClick={() => { setTeamMode(key); setTeamPreview(false); }}>{label}</button>)}</div><button className={action} onClick={() => setTeamPreview(true)}>試合カードを表示</button>{teamPreview && <div className="space-y-2 rounded-xl border border-zinc-600 p-3"><div className="grid grid-cols-2 gap-2 text-sm"><p className="border-l-2 border-emerald-500 pl-2">A1 ＋ {teamMode === "mixed" ? "B1" : "A2"}</p><p className="border-l-2 border-blue-500 pl-2">{teamMode === "mixed" ? "A2 ＋ B2" : "B1 ＋ B2"}</p></div><p className="text-xs">{teamMode === "mixed" ? "混合は個人・ペア戦績のみ。チーム勝敗へは加算しません。" : teamMode === "manual" ? "手動では4名を自分で選びます。" : "チームごとの2名ずつで対戦します。"}</p></div>}</>}
      {notice && <p role="status" className="text-xs text-amber-300">{notice}</p>}
    </div>
    <div className="flex shrink-0 flex-wrap gap-2 border-t border-zinc-700 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {index > 0 && <button className={button} onClick={() => { setEditing(null); setIndex(i => i - 1); }}>戻る</button>}
      <button className={`${action} flex-1`} disabled={!ready} onClick={() => { if (last) onComplete(); else { setEditing(null); setIndex(i => i + 1); } }}>{last ? "体験を完了して戻る" : "次へ"}</button>
      <button className={button} onClick={onClose}>スキップ・終了</button>
    </div>
  </div>;
}
