"use client";
import { useEffect, useId, useRef, useState } from "react";
import { stepPhases, stepTitles, type DemoStep, type ExperienceKind } from "@/lib/tutorial-content";

import { TutorialGuide } from "./tutorial-guide";
import styles from "./tutorial-demo.module.css";

const demoPlayers = Array.from({ length: 8 }, (_, i) => `プレイヤー${String(i + 1).padStart(2, "0")}`);
// 既存の「6名から1名を欠席にする」操作は維持する。
const names = demoPlayers.slice(0, 6);
const button = "min-h-11 rounded-xl border border-zinc-600 px-3 py-2 text-sm disabled:opacity-40";
const action = `${button} border-accent bg-accent font-bold text-black`;
type Tab = "対戦" | "参加者" | "結果";
type Status = "active" | "resting" | "absent";
type Round = { players: string[]; rest: string; score: [number | null, number | null]; saved: boolean };
export type DemoDestination = "create" | "home";
const startingTab = (step: DemoStep): Tab => step === "round" ? "参加者" : step === "finish" || step === "finalResults" || step === "share" ? "結果" : "対戦";
const sampleRound = (n: number, eligible = names.slice(0, 5), recorded = false): Round => ({
  players: n === 0 ? eligible.slice(0, 4) : [eligible[4], eligible[0], eligible[1], eligible[2]],
  rest: eligible[n === 0 ? 4 : 3], score: recorded ? (n ? [3, 4] : [4, 2]) : [null, null], saved: recorded
});

// 独立したデモを拡充する。SDK・本番生成器・ScoreInput・共有APIは一切使わない。
export function TutorialDemo({ steps, kind, onClose, onComplete, notice }: {
  steps: readonly DemoStep[]; kind: ExperienceKind; onClose: () => void;
  onComplete: (destination?: DemoDestination) => void; notice?: string;
}) {
  const first = steps[0], full = kind === "full";
  const [index, setIndex] = useState(0), [sectionDone, setSectionDone] = useState(false);
  const [group, setGroup] = useState(first === "group" ? "" : "パデル体験クラブ"), [groupName, setGroupName] = useState("パデル体験クラブ");
  const [members, setMembers] = useState<string[]>([]), [memberName, setMemberName] = useState(names[0]);
  const [name, setName] = useState("パデル体験会"), [courts, setCourts] = useState(1);
  const [statuses, setStatuses] = useState<Status[]>(names.map((_, i) => steps.includes("participants") || i < 5 ? "active" : "absent"));
  const [change, setChange] = useState<number | null>(null), [participantDone, setParticipantDone] = useState(false);
  const [tab, setTab] = useState<Tab>(startingTab(first));
  const [rounds, setRounds] = useState<Round[]>(() => full || ["home", "group", "members", "format", "event", "participants", "round", "team"].includes(first) ? [] : first === "score" ? [sampleRound(0)] : [sampleRound(0, undefined, true), sampleRound(1, undefined, first !== "secondScore")]);
  const [editing, setEditing] = useState<0 | 1 | null>(null), [saving, setSaving] = useState<number | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false), [ended, setEnded] = useState(first === "share" || first === "finalResults");
  const [shareVersion, setShareVersion] = useState(0), [preview, setPreview] = useState(false), [shareMessage, setShareMessage] = useState("");
  const [teamMode, setTeamMode] = useState("manual"), [teamPreview, setTeamPreview] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), trail = useRef<number[]>([]);
  const root = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null), guideId = useId();
  const step = steps[index], completeScreen = step === "done" || sectionDone;
  const go = (target: number, remember = true) => { if (target < 0 || target >= steps.length) return; if (remember && target !== index) trail.current.push(index); setEditing(null); setChange(null); setConfirmEnd(false); setIndex(target); setTab(startingTab(steps[target])); };
  const advance = () => { if (index + 1 < steps.length) go(index + 1); else setSectionDone(true); };
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [index, sectionDone]);
  // 保存表示だけのローカルタイマー。実際の保存キューには接続しない。
  useEffect(() => {
    if (saving === null) return;
    const timer = window.setTimeout(() => {
      setRounds(rows => rows.map((r, i) => i === saving ? { ...r, saved: true } : r));
      setSaving(null); advance();
    }, 450);
    return () => clearTimeout(timer);
    // 保存中は進行操作を止め、このステップの完了後にだけ進める。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving]);
  const roster = members.length >= 6 ? members : names;
  const eligible = roster.filter((_, i) => statuses[i] === "active");
  const activeRound = step === "secondScore" || step === "nextRound" ? 1 : 0;
  const recordedRounds = rounds.filter(r => r.saved);
  const stats = roster.map(player => {
    let played = 0, wins = 0, losses = 0, diff = 0;
    for (const r of recordedRounds) {
      const position = r.players.indexOf(player); if (position < 0) continue;
      const a = r.score[0] ?? 0, b = r.score[1] ?? 0, own = position < 2 ? a : b, other = position < 2 ? b : a;
      played++; wins += Number(own > other); losses += Number(own < other); diff += own - other;
    }
    return { player, played, wins, losses, diff, rate: played ? Math.round(wins / played * 100) : 0 };
  }).sort((a, b) => b.rate - a.rate || b.diff - a.diff);
  const eventScreen = ["participants", "round", "score", "nextRound", "secondScore", "results", "finish", "finalResults", "share"].includes(step);
  const desiredTab: Tab = step === "participants" ? "参加者" : ["results", "finalResults", "share"].includes(step) ? "結果" : "対戦";
  const absentCount = statuses.filter(s => s === "absent").length, restingIndex = statuses.indexOf("resting");
  const participantReady = eligible.length === 5 && absentCount === 1;
  let target: string | null = null, instruction = "";
  if (completeScreen) { target = full ? "done-home" : "done-topic"; instruction = "体験完了！元の画面へ戻ろう"; }
  else if (eventScreen && tab !== desiredTab) { target = `tab-${desiredTab}`; instruction = `「${desiredTab}」タブを開こう`; }
  else {
    const guides: Partial<Record<DemoStep, [string, string]>> = {
      home: ["home", "まずは「試合」をタップ！"], create: ["create", "新しい試合を作ってみよう"], format: ["format", "フレンドリーの乱数を選ぼう"],
      groupTip: ["group-new", "グループを準備しよう"], group: [groupName.trim() ? "group-create" : "group-name", "グループ名を入力して作成しよう"],
      members: members.length >= 6 ? ["members-return", "試合作成へ戻ろう"] : members.length ? ["members-sample", "残りのメンバーも追加しよう"] : [memberName.trim() ? "member-add" : "member-name", "名前を入力して追加してみよう"],
      event: [name.trim() ? "event-create" : "event-name", "開催名を確認して作成しよう"],
      round: [rounds[0] ? "round-review" : "generate", rounds[0] ? "組み合わせを確認して続けよう" : "組み合わせを作ろう"],
      nextRound: [rounds[1] ? "round-review" : "generate", rounds[1] ? "休憩した選手の出場を確認しよう" : "次のRoundも作ってみよう"],
      results: ["result-review", "暫定戦績を確認して続けよう"], finish: [confirmEnd ? "finish-confirm" : "finish", confirmEnd ? "確認したら「終了する」をタップ" : "イベントを終了してみよう"],
      finalResults: ["result-review", "結果を確認したら共有へ！"], share: [!shareVersion ? "share-create" : preview ? "share-review" : "share-line", !shareVersion ? "共有リンクを作ろう" : preview ? "送る内容を確認して完了しよう" : "結果をLINEで共有！"],
      team: [teamPreview ? "team-review" : "team-show", teamPreview ? "組み合わせを確認して続けよう" : "追加方法を選んで表示しよう"]
    };
    if (step === "participants") {
      if (change !== null) { target = `status-${change}-${absentCount > 1 ? "active" : "absent"}`; instruction = absentCount > 1 ? "参加に戻して5名にしよう" : "1人を欠席にしよう"; }
      else if (restingIndex >= 0) { target = `rest-${restingIndex}`; instruction = "休憩中の選手を参加へ戻そう"; }
      else if (participantReady && participantDone) { target = "participants-done"; instruction = "対戦へ進もう"; }
      else { target = `change-${absentCount > 1 ? statuses.indexOf("absent") : 5}`; instruction = absentCount > 1 ? "参加状態を調整しよう" : "「変更」から1人を欠席にしよう"; }
    } else if (step === "score" || step === "secondScore") {
      target = saving !== null ? null : editing !== null ? "score-number" : rounds[activeRound]?.score[0] === null ? "score-a" : "score-b";
      instruction = editing !== null ? `ペア${editing ? "B" : "A"}の数字を選ぼう` : "得点欄をタップしてみよう";
    } else if (guides[step]) [target, instruction] = guides[step]!;
  }
  const mark = (key: string) => ({ "data-tutorial-target": key, "data-tutorial-current": key === target ? "true" : undefined, "aria-describedby": key === target ? guideId : undefined });
  const prepareMembers = (next: string[]) => { setMembers(next); if (next.length >= 6) advance(); };
  const updateStatuses = (next: Status[]) => { setStatuses(next); setChange(null); setParticipantDone(true); if (next.filter(v => v === "active").length === 5 && next.filter(v => v === "absent").length === 1) advance(); };
  const chooseScore = (value: number) => {
    if (editing === null || saving !== null) return;
    const r = rounds[activeRound]; if (!r) return;
    const score: Round["score"] = [...r.score]; score[editing] = value;
    setRounds(rows => rows.map((row, i) => i === activeRound ? { ...row, score, saved: false } : row));
    if (score[0] !== null && score[1] !== null) { setEditing(null); setSaving(activeRound); }
    else setEditing(editing === 0 ? 1 : 0);
  };
  const card = (number: number, editable = false) => {
    const r = rounds[number]; if (!r) return null;
    return <section className="space-y-2 rounded-xl border border-zinc-700 p-3" aria-label={`体験Round ${number + 1}`}>
      <div className="flex items-center justify-between text-xs"><strong>Round {number + 1} · コート1</strong><span role="status">{saving === number ? "保存中…（体験）" : r.saved ? "記録済み（体験）" : "スコア未入力"}</span></div>
      <div className="grid grid-cols-2 gap-2">{([0, 1] as const).map(side => <div key={side} className={`min-w-0 border-l-2 pl-2 ${side ? "border-blue-500" : "border-emerald-500"}`}><p className="break-words text-xs">ペア{side ? "B" : "A"} · {r.players.slice(side * 2, side * 2 + 2).join("・")}</p>{editable ? <button {...mark(side ? "score-b" : "score-a")} disabled={saving !== null} aria-label={`体験ペア${side ? "B" : "A"}の得点`} className={`${button} mt-1 w-full text-3xl font-bold`} onClick={() => setEditing(side)}>{r.score[side] ?? "−"}</button> : <p className="py-1 text-2xl font-bold">{r.score[side] ?? "−"}</p>}</div>)}</div>
      <p className="text-xs">自動休憩：{r.rest}</p>
    </section>;
  };
  const results = () => <section className="space-y-3" aria-label="体験の個人戦績">
    <p className="text-sm font-bold">{ended ? "終了後の結果" : "開催中の暫定戦績"} · {recordedRounds.length}試合記録済み</p>
    <table className="w-full text-left text-xs"><thead><tr><th className="py-2">選手</th><th>勝敗</th><th>勝率</th><th>得失点差</th></tr></thead><tbody>{stats.map(r => <tr className="border-t border-zinc-700" key={r.player}><th className="py-2 font-normal">{r.player}</th><td>{r.wins}勝{r.losses}敗</td><td>{r.rate}%</td><td>{r.diff > 0 ? "+" : ""}{r.diff}</td></tr>)}</tbody></table>
    {ended && <p className="rounded-xl border border-accent p-3 text-sm">MVP（体験内の参考表示）：{stats[0].player}</p>}
  </section>;
  const tips = (text: string) => <aside data-tutorial-tip className="rounded-xl bg-zinc-800 p-3 text-sm leading-6"><span aria-hidden="true">💡 </span>{text}</aside>;
  const shareUrl = `https://padel-demo.invalid/share/result-${shareVersion}`;
  return <div ref={root} data-tutorial-demo data-step={step} data-experience={kind} className={`${styles.demo} flex min-h-0 flex-1 flex-col overflow-hidden`}>
      <div className="flex shrink-0 px-4 pt-4 pb-1 items-center justify-between gap-2 text-xs"><strong className="text-accent">体験モード · 実データは変更しません</strong><span className="shrink-0">{full ? `${stepPhases[step]} / 9` : `${Math.min(index + 1, steps.length)} / ${steps.length}`}</span></div>
    <div ref={scroller} data-tutorial-content className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
      <h3 ref={heading} tabIndex={-1} className="text-base font-bold">{stepTitles[completeScreen ? "done" : step]}</h3>
      {completeScreen ? <div className="space-y-4"><h4 className="text-lg font-bold text-accent">{full ? "体験完了！お疲れさまでした！" : "この項目の体験が完了しました"}</h4><p className="text-sm leading-7">{full ? "試合作成から結果共有まで体験できました。" : "体験用のデータは保存されません。何度でも再体験できます。"}</p><p className="text-xs">詳しい使い方は「使い方・ヘルプ」から確認できます。</p>{full ? <><button className={`${action} w-full`} onClick={() => onComplete("create")}>実際に試合を作成する</button><button {...mark("done-home")} className={`${button} w-full`} onClick={() => onComplete("home")}>ホームへ戻る</button></> : <button {...mark("done-topic")} className={`${action} w-full`} onClick={() => onComplete()}>体験を完了して戻る</button>}</div> : <>
      {step === "home" && <><div className="space-y-3 rounded-xl border border-zinc-700 p-3"><p className="text-sm">マイページ（体験用）</p><div className="grid grid-cols-3 border-t border-zinc-700 pt-3"><button {...mark("home")} className={action} onClick={advance}>試合</button><span className="p-3 text-center text-xs">ランキング</span><span className="p-3 text-center text-xs">マイページ</span></div></div></>}
      {step === "create" && <><p className="text-sm font-bold">試合TOP</p><label className="block text-xs">表示対象グループ<select className="mt-1 min-h-11 w-full rounded-xl bg-zinc-800 p-2"><option>すべての閲覧可能な試合</option></select></label><p className="text-sm">開催中の試合はありません</p><button {...mark("create")} className={`${action} w-full`} onClick={advance}>＋ 新しい試合を作成</button><p className="text-xs">過去の試合はここに表示されます。</p></>}
      {step === "format" && <><p className="text-sm">フレンドリー</p><button {...mark("format")} aria-label="組み合わせ戦・自動生成" className={`${action} w-full text-left`} onClick={advance}>組み合わせ戦・自動生成<span className="mt-1 block text-xs font-normal">参加者から組み合わせを作成（乱数）</span></button></>}
      {step === "groupTip" && <><h4 className="font-bold">フレンドリーマッチ作成</h4><label className="block text-xs">作成先グループ<select className="mt-1 min-h-11 w-full rounded-xl bg-zinc-800 p-2"><option>グループなし</option></select></label>{tips("次回からメンバー登録がラクになります。") }<button {...mark("group-new")} className={`${action} w-full`} onClick={advance}>＋ 新しいグループを作成</button><button className={`${button} w-full`} onClick={() => { setGroup(""); go(steps.indexOf("event")); }}>グループ作成をスキップ</button></>}
      {step === "group" && <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (groupName.trim()) { setGroup(groupName.trim()); advance(); } }}><label className="block text-sm">グループ名<input {...mark("group-name")} aria-label="体験用グループ名" className="mt-1 min-h-11 w-full rounded-xl bg-zinc-800 p-3" value={groupName} onChange={e => setGroupName(e.target.value)} /></label><button {...mark("group-create")} disabled={!groupName.trim()} className={`${action} w-full`}>作成</button></form>}
      {step === "members" && <><p className="font-bold">{group || "パデル体験クラブ"} · メンバー管理</p><form className="flex gap-2" onSubmit={e => { e.preventDefault(); const value = memberName.trim(); if (value && !members.includes(value)) { prepareMembers([...members, value]); setMemberName(""); } }}><input {...mark("member-name")} aria-label="体験用メンバー名" placeholder="表示名" className="min-h-11 min-w-0 flex-1 rounded-xl bg-zinc-800 p-2" value={memberName} onChange={e => setMemberName(e.target.value)} /><button {...mark("member-add")} className={action} disabled={!memberName.trim() || members.includes(memberName.trim())}>追加</button></form><ul className="divide-y divide-zinc-700 text-sm">{members.map(n => <li className="py-2" key={n}>{n} · 参加</li>)}</ul><button {...mark("members-sample")} className={`${button} w-full`} onClick={() => prepareMembers(Array.from(new Set([...members, ...names])).slice(0, 6))}>残りのサンプルメンバーを追加</button>{members.length >= 6 && <button {...mark("members-return")} className={`${action} w-full`} onClick={advance}>試合作成へ戻る</button>}</>}
      {step === "event" && <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (name.trim()) advance(); }}><h4 className="font-bold">フレンドリーマッチ作成</h4><label className="block text-sm">作成先グループ<select aria-label="体験用作成先グループ" className="mt-1 min-h-11 w-full rounded-xl bg-zinc-800 p-2" value={group} onChange={e => setGroup(e.target.value)}><option value="">グループなし</option><option value={group || "パデル体験クラブ"}>{group || "パデル体験クラブ"}</option></select></label><label className="block text-sm">開催名<input {...mark("event-name")} aria-label="体験用イベント名" className="mt-1 min-h-11 w-full rounded-xl bg-zinc-800 p-3" value={name} onChange={e => setName(e.target.value)} /></label><label className="flex min-h-11 items-center justify-between text-sm">コート数<select aria-label="体験用コート数" className="rounded-lg bg-card p-2" value={courts} onChange={e => setCourts(Number(e.target.value))}><option value="1">1面</option></select></label><p className="text-sm">対戦作成方式：自動生成（乱数）</p><button {...mark("event-create")} disabled={!name.trim()} className={`${action} w-full`}>作成</button></form>}
      {eventScreen && <>
        <header className="space-y-1"><h4 className="break-words font-bold">{name}</h4><p className="text-xs">{ended ? "終了済み" : "開催中"} · 乱数 · {courts}面</p></header>
        <div role="tablist" aria-label="体験用開催詳細" className="grid grid-cols-3 border-b border-zinc-700">{(["対戦", "参加者", "結果"] as const).map(label => <button {...mark(`tab-${label}`)} key={label} role="tab" aria-selected={tab === label} disabled={saving !== null} className={`min-h-11 text-sm ${tab === label ? "border-b-2 border-accent font-bold text-accent" : ""} ${tab !== desiredTab && label === desiredTab ? "rounded-t-lg bg-accent/10 text-accent" : ""}`} onClick={() => setTab(label)}>{label}</button>)}</div>
        {tab !== desiredTab ? <div className="space-y-3">{tab === "結果" ? results() : <>{tab === "対戦" && card(rounds.length - 1)}<p className="text-sm">{tab === "参加者" ? `参加中 ${eligible.length}名 · 欠席 ${statuses.filter(s => s === "absent").length}名` : "対戦カード・Round生成・イベント終了"}</p></>}</div> : <>
          {step === "participants" && <>{tips("欠席は今日不参加、休憩は一時的なお休みです。") }<ul className="divide-y divide-zinc-700">{roster.map((n, i) => <li key={n} className="flex flex-wrap items-center gap-2 py-2 text-xs"><span className="min-w-0 flex-1">{n}<strong className={`ml-2 ${statuses[i] === "active" ? "text-accent" : "text-zinc-400"}`}>{{ active: "参加中", resting: "休憩中（手動）", absent: "欠席" }[statuses[i]]}</strong></span>{statuses[i] !== "absent" && <button {...mark(`rest-${i}`)} className={button} aria-label={`${n}の休憩切替`} onClick={() => updateStatuses(statuses.map((s, k) => k === i ? s === "active" ? "resting" : "active" : s))}>{statuses[i] === "resting" ? "参加へ" : "休憩"}</button>}<button {...mark(`change-${i}`)} className={button} aria-expanded={change === i} onClick={() => setChange(change === i ? null : i)} aria-label={`${n}の参加状態を変更`}>変更</button>{change === i && <div className="flex w-full gap-2">{(["active", "absent"] as const).map(s => <button {...mark(`status-${i}-${s}`)} key={s} className={button} onClick={() => { updateStatuses(statuses.map((v, k) => k === i ? s : v)); }}>{s === "absent" ? "欠席" : "参加へ戻す"}</button>)}</div>}</li>)}</ul><p role="status" className="text-sm">参加中 {eligible.length}名 · 欠席 {statuses.filter(s => s === "absent").length}名</p>{participantDone && participantReady && <button {...mark("participants-done")} className={`${action} w-full`} onClick={advance}>対戦へ</button>}</>}
          {(step === "round" || step === "nextRound") && <>{step === "nextRound" && card(0)}<button {...mark("generate")} className={`${action} w-full`} onClick={() => setRounds(rows => step === "round" ? [sampleRound(0, eligible)] : [rows[0] ?? sampleRound(0, eligible, true), sampleRound(1, eligible)])}>次のRoundを生成</button>{card(activeRound)}{rounds[activeRound] && <>{tips(step === "round" ? "休憩も自動で調整します。" : "前回休憩した選手が出場する例です。") }<button {...mark("round-review")} className={`${action} w-full`} onClick={advance}>続ける</button></>}</>}
          {(step === "score" || step === "secondScore") && <>{card(activeRound, true)}{editing !== null && <section aria-label="体験用得点選択" className="space-y-2 rounded-xl border border-accent p-2"><p className="text-xs font-bold">ペア{editing ? "B" : "A"}の得点</p><div className="grid grid-cols-4 gap-2">{Array.from({ length: 8 }, (_, n) => <button {...mark(n === (editing ? 2 : 4) ? "score-number" : `score-number-${n}`)} key={n} className={button} onClick={() => chooseScore(n)}>{n}</button>)}</div><button className={`${button} w-full`} onClick={() => setEditing(null)}>数字選択を閉じる</button></section>}</>}
          {step === "results" && <>{results()}<button {...mark("result-review")} className={`${action} w-full`} onClick={advance}>続ける</button></>}
          {step === "finish" && <>{confirmEnd ? <section aria-label="体験用終了確認" className="space-y-3 rounded-xl border border-zinc-600 p-3"><h4 className="font-bold">この開催を終了しますか？</h4><p className="text-xs">未確定の試合：0件</p><div className="grid grid-cols-2 gap-2"><button className={button} onClick={() => setConfirmEnd(false)}>キャンセル</button><button {...mark("finish-confirm")} className={action} onClick={() => { setEnded(true); advance(); }}>終了する</button></div></section> : <>{card(1)}<button {...mark("finish")} className={`${action} w-full`} onClick={() => setConfirmEnd(true)}>イベント終了</button></>}</>}
          {step === "finalResults" && <>{results()}<button {...mark("result-review")} className={`${action} w-full`} onClick={advance}>続ける</button></>}
          {step === "share" && <section className="space-y-3" aria-label="体験用結果共有"><h4 className="font-bold">結果共有</h4>{!shareVersion ? <><button {...mark("share-create")} className={`${action} w-full`} onClick={() => { setShareVersion(1); setPreview(false); setShareMessage(""); }}>共有リンクを作成</button></> : <><p className="break-all rounded-xl bg-zinc-800 p-3 text-xs">{shareUrl}</p><p className="text-xs">実在しない体験用リンクです。</p><div className="grid grid-cols-2 gap-2"><button {...mark("share-line")} className={action} onClick={() => { setPreview(true); setShareMessage(""); }}>LINEで共有</button><button className={button} onClick={() => { setPreview(true); setShareMessage("文章のプレビューです（コピーしません）。"); }}>文章をコピー</button><button className={button} onClick={() => { setShareVersion(0); setPreview(false); setShareMessage("共有を停止しました（体験）。"); }}>共有を停止</button><button className={button} onClick={() => { setShareVersion(v => v + 1); setPreview(false); setShareMessage("旧リンクは無効になりました（体験）。"); }}>共有リンクを再発行</button></div></>}{shareMessage && <p role="status" className="text-xs">{shareMessage}</p>}{preview && <div className="space-y-2 rounded-xl border border-accent p-3"><p className="text-sm font-bold">共有メッセージのプレビュー</p><p className="whitespace-pre-line break-all text-sm">{name}{"\n"}本日の結果：{recordedRounds.length}試合記録済み{"\n"}{recordedRounds.map((r, i) => `Round ${i + 1}：${r.score[0]}対${r.score[1]}`).join("\n")}{"\n"}{shareUrl}</p><p className="text-xs">体験ではLINEを起動しません。</p><button {...mark("share-review")} className={`${action} w-full`} onClick={advance}>体験を完了</button></div>}{tips("終了後はLINEで共有できます。共有停止も可能です。") }</section>}
        </>}
      </>}
      {step === "team" && <><div className="grid gap-2">{[["manual", "手動追加"], ["confrontation", "チーム対決乱数"], ["mixed", "チーム混合乱数"]].map(([key, label]) => <button key={key} aria-pressed={teamMode === key} className={`${button} ${teamMode === key ? "border-accent text-accent" : ""}`} onClick={() => { setTeamMode(key); setTeamPreview(false); }}>{label}</button>)}</div><button {...mark("team-show")} className={action} onClick={() => setTeamPreview(true)}>試合カードを表示</button>{teamPreview && <div className="space-y-2 rounded-xl border border-zinc-600 p-3"><div className="grid grid-cols-2 gap-2 text-sm"><p className="border-l-2 border-emerald-500 pl-2">{demoPlayers[4]} ＋ {teamMode === "mixed" ? demoPlayers[6] : demoPlayers[5]}</p><p className="border-l-2 border-blue-500 pl-2">{teamMode === "mixed" ? demoPlayers[5] : demoPlayers[6]} ＋ {demoPlayers[7]}</p></div><p className="text-xs">{teamMode === "mixed" ? "混合は個人・ペア戦績のみ。チーム勝敗へは加算しません。" : teamMode === "manual" ? "手動では4名を自分で選びます。" : "チームごとの2名ずつで対戦します。"}</p><button {...mark("team-review")} className={action} onClick={advance}>続ける</button></div>}</>}
      </>}
      {notice && <p role="status" className="text-xs text-amber-300">{notice}</p>}
    </div>
    <TutorialGuide root={root} scroller={scroller} target={target} label={instruction} id={guideId} />
    <div className="flex shrink-0 flex-wrap gap-2 border-t border-zinc-700 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {(index > 0 || sectionDone) && <button disabled={saving !== null} className={button} onClick={() => { if (sectionDone) setSectionDone(false); else go(trail.current.pop() ?? index - 1, false); }}>戻る</button>}
      <button disabled={saving !== null} className={`${button} ml-auto`} onClick={onClose}>スキップ・終了</button>
    </div>
  </div>;
}
