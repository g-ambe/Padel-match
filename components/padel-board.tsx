"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import { AppDialog } from "./app-dialog";
import { BOARD_COLORS as colors, COURT, MARKERS, boardReturnPath, courtPoint, initialBoard, strokePath, type BoardMode, type BoardState, type MarkerId, type Point, type Stroke } from "@/lib/padel-board";
import styles from "./padel-board.module.css";

type Gesture = { pointer: number; before: BoardState; marker?: MarkerId; offset: Point; stroke?: Stroke };
const modes = [["place", "配置"], ["movement", "動線"], ["ball", "ボール軌道"]] as const;

async function boardPng(svg: SVGSVGElement): Promise<Blob> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg"); copy.setAttribute("width", String(COURT.width)); copy.setAttribute("height", String(COURT.height));
  copy.removeAttribute("class"); copy.removeAttribute("style");
  const source = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("画像を作成できませんでした。")); image.src = source; });
    const canvas = document.createElement("canvas"); canvas.width = COURT.width; canvas.height = COURT.height;
    const context = canvas.getContext("2d"); if (!context) throw new Error("このブラウザでは画像を作成できません。");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNGを作成できませんでした。")), "image/png"));
  } finally { URL.revokeObjectURL(source); }
}

export function PadelBoard() {
  const [board, setBoard] = useState<BoardState>(initialBoard), [history, setHistory] = useState<BoardState[]>([]);
  const live = useRef(board), gesture = useRef<Gesture | null>(null), svg = useRef<SVGSVGElement>(null);
  const [mode, setMode] = useState<BoardMode>("place"), [active, setActive] = useState(false), [busy, setBusy] = useState(false);
  const [back, setBack] = useState("/"), [notice, setNotice] = useState(""), [preview, setPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null), busyRef = useRef(false), mounted = useRef(true);
  useEffect(() => { setBack(boardReturnPath(new URLSearchParams(location.search).get("from"))); mounted.current = true; return () => { mounted.current = false; if (previewRef.current) URL.revokeObjectURL(previewRef.current); }; }, []);
  useEffect(() => {
    const court = svg.current; if (!court) return;
    // SVGのマーカーでtouch-actionを扱わないブラウザでも、ドラッグ中のスクロールを防ぐ。
    const preventMarkerScroll = (event: TouchEvent) => {
      if (court.dataset.mode === "place" && (event.target as Element).closest("[data-marker]")) event.preventDefault();
    };
    court.addEventListener("touchstart", preventMarkerScroll, { passive: false });
    return () => court.removeEventListener("touchstart", preventMarkerScroll);
  }, []);
  const show = (next: BoardState) => { live.current = next; setBoard(next); };
  const remember = (before: BoardState, next: BoardState) => { if (JSON.stringify(before) !== JSON.stringify(next)) setHistory(rows => [...rows.slice(-49), before]); };
  const point = (event: { clientX: number; clientY: number }): Point => {
    const rect = svg.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * COURT.width, y: (event.clientY - rect.top) / rect.height * COURT.height };
  };
  const start = (event: PointerEvent<SVGSVGElement>) => {
    if (busyRef.current || gesture.current || !event.isPrimary || event.button !== 0) return;
    const id = (event.target as Element).closest("[data-marker]")?.getAttribute("data-marker") as MarkerId | null;
    if (mode === "place" && !id) return;
    event.preventDefault(); const before = live.current, p = point(event);
    const stroke = mode === "place" ? undefined : { kind: mode, points: [courtPoint(p, 40)] } as Stroke;
    gesture.current = { pointer: event.pointerId, before, marker: mode === "place" ? id! : undefined, offset: id && mode === "place" ? { x: before.markers[id].x - p.x, y: before.markers[id].y - p.y } : { x: 0, y: 0 }, stroke };
    event.currentTarget.setPointerCapture(event.pointerId); setActive(true); setNotice("");
    if (stroke) show({ ...before, strokes: [...before.strokes, stroke] });
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const action = gesture.current; if (!action || action.pointer !== event.pointerId) return;
    event.preventDefault(); const p = point(event);
    if (action.marker) show({ ...action.before, markers: { ...action.before.markers, [action.marker]: courtPoint({ x: p.x + action.offset.x, y: p.y + action.offset.y }) } });
    else if (action.stroke) {
      const next = courtPoint(p, 40), previous = action.stroke.points.at(-1)!;
      if (Math.hypot(next.x - previous.x, next.y - previous.y) < 3) return;
      action.stroke = { ...action.stroke, points: [...action.stroke.points, next] };
      show({ ...action.before, strokes: [...action.before.strokes, action.stroke] });
    }
  };
  const finish = (event: PointerEvent<SVGSVGElement>, cancel = false) => {
    const action = gesture.current; if (!action || action.pointer !== event.pointerId) return;
    if (!cancel) move(event);
    gesture.current = null; setActive(false);
    if (cancel || (action.stroke && action.stroke.points.length < 2)) show(action.before);
    else remember(action.before, live.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const markerKey = (event: KeyboardEvent<SVGGElement>, id: MarkerId) => {
    if (mode !== "place" || active || busy) return;
    const direction: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    const delta = direction[event.key]; if (!delta) return;
    event.preventDefault(); const before = live.current, p = before.markers[id], amount = event.shiftKey ? 50 : 10;
    const next = { ...before, markers: { ...before.markers, [id]: courtPoint({ x: p.x + delta.x * amount, y: p.y + delta.y * amount }) } };
    remember(before, next); show(next);
  };
  const closePreview = () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); previewRef.current = null; setPreview(null); };
  const share = async () => {
    if (busyRef.current || gesture.current || !svg.current) return;
    busyRef.current = true; setBusy(true); setNotice("");
    try {
      const blob = await boardPng(svg.current); if (!mounted.current) return;
      const file = new File([blob], "padel-board.png", { type: "image/png" });
      let canShare = false;
      try { canShare = !!navigator.share && !!navigator.canShare?.({ files: [file] }); } catch { /* 能力判定が失敗した場合もPNG保存へ。 */ }
      if (canShare) {
        try { await navigator.share({ files: [file], title: "パデルボード" }); return; }
        catch (error) { if (error instanceof DOMException && error.name === "AbortError") { if (mounted.current) setNotice("共有をキャンセルしました。"); return; } }
      }
      if (mounted.current) { closePreview(); const url = URL.createObjectURL(blob); previewRef.current = url; setPreview(url); }
    } catch (error) { if (mounted.current) setNotice(error instanceof Error ? error.message : "画像を作成できませんでした。もう一度お試しください。"); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  return <main className={styles.page}>
    <header className={styles.header}><Link href={back}>戻る</Link><h1 className="text-xl font-bold">パデルボード</h1></header>
    <svg ref={svg} xmlns="http://www.w3.org/2000/svg" width={COURT.width} height={COURT.height} viewBox={`0 0 ${COURT.width} ${COURT.height}`} role="group" aria-label="パデルコート" data-mode={mode} className={styles.court} onPointerDown={start} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}>
      <defs>{(["movement", "ball"] as const).map(kind => <marker key={kind} id={`board-arrow-${kind}`} viewBox="0 0 32 28" refX="28" refY="14" markerWidth="32" markerHeight="28" markerUnits="userSpaceOnUse" orient="auto"><path d="M2 2L28 14L2 26" fill="none" stroke={kind === "movement" ? colors.a : colors.ball} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" /></marker>)}</defs>
      <rect width={COURT.width} height={COURT.height} fill={colors.court} stroke={colors.line} strokeWidth="8" />
      <g stroke={colors.line} strokeWidth="5" fill="none"><path data-court-services d={`M0 ${COURT.serviceTop}H1000 M0 ${COURT.serviceBottom}H1000 M500 ${COURT.serviceTop}V${COURT.serviceBottom}`} /><path data-court-net d={`M0 ${COURT.net}H1000`} strokeWidth="9" /></g>
      <g data-board-strokes>{board.strokes.map((stroke, i) => <path key={i} d={strokePath(stroke.points)} fill="none" stroke={stroke.kind === "movement" ? colors.a : colors.ball} strokeWidth="9" strokeDasharray={stroke.kind === "movement" ? "24 18" : undefined} strokeLinecap="round" strokeLinejoin="round" markerEnd={stroke.points.length > 1 ? `url(#board-arrow-${stroke.kind})` : undefined} data-stroke-kind={stroke.kind} />)}</g>
      {MARKERS.map(id => { const p = board.markers[id], ball = id === "ball"; return <g key={id} data-marker={id} transform={`translate(${p.x} ${p.y})`} role="img" aria-label={`${ball ? "ボール" : id}（配置モードでは矢印キーでも移動できます）`} tabIndex={mode === "place" && !busy ? 0 : -1} onKeyDown={event => markerKey(event, id)}>
        <circle r="64" fill="transparent" />
        <circle r={ball ? 23 : 42} fill={ball ? colors.ball : id.startsWith("A") ? colors.a : colors.b} stroke={colors.line} strokeWidth="4" />
        {!ball && <text textAnchor="middle" dominantBaseline="central" fontSize="38" fontWeight="700" fontFamily="system-ui,sans-serif" fill={id.startsWith("A") ? colors.ink : colors.line} pointerEvents="none">{id}</text>}
      </g>; })}
    </svg>
    <div className={styles.controls} aria-label="作戦ボードの操作">
      {modes.map(([value, label]) => <button key={value} disabled={busy || active} aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}
      <button disabled={!history.length || busy || active} onClick={() => { const previous = history.at(-1); if (previous) { show(previous); setHistory(rows => rows.slice(0, -1)); setNotice(""); } }}>戻す</button>
      <button disabled={busy || active} onClick={() => { const next = initialBoard(); remember(live.current, next); show(next); setNotice(""); }}>初期化</button>
      <button disabled={busy || active} onClick={() => void share()}>{busy ? "画像を作成中…" : "画像を共有"}</button>
    </div>
    {notice && <p role="status" className="mt-2 text-sm">{notice}</p>}
    <AppDialog open={preview !== null} title="PNGを保存" onClose={closePreview}><div className="space-y-3 overflow-y-auto p-4">{preview && <><img src={preview} alt="作成したパデルボードのPNG" className={styles.preview} /><a className={styles.save} href={preview} download="padel-board.png" target="_blank" rel="noopener noreferrer">PNGを保存</a><p className="text-xs">画像を長押しして保存することもできます。</p></>}</div></AppDialog>
  </main>;
}
