"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import { AppDialog } from "./app-dialog";
import { BOARD_COLORS as colors, DRAW_COLORS, COURT, MARKERS, boardReturnPath, courtPoint, initialBoard, strokePath, type DrawingColor, type BoardState, type MarkerId, type Point, type Stroke } from "@/lib/padel-board";
import styles from "./padel-board.module.css";

type Gesture = { pointer: number; before: BoardState; marker?: MarkerId; offset: Point; stroke?: Stroke };
const drawChoices = [["green", "緑"], ["yellow", "黄色"], ["blue", "青"]] as const;
// 既存メニューと同じ、追加ライブラリ不要の線画SVG。
const iconPaths = {
  move: "M12 3v18M3 12h18m-13-5 4-4 4 4m-8 10 4 4 4-4M7 8l-4 4 4 4m10-8 4 4-4 4",
  pen: "m4 16-1 5 5-1L20 8a2.8 2.8 0 0 0-4-4ZM14 6l4 4M12 21h9",
  undo: "m9 4-5 5 5 5M4 9h10a6 6 0 0 1 0 12h-3",
  reset: "M20 7A8 8 0 0 0 7 5L3 9m0-6v6h6M4 17a8 8 0 0 0 13 2l4-4m0 6v-6h-6",
  download: "M12 3v12m-5-5 5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
  share: "m8 10 8-5M8 14l8 5",
  back: "m10 5-7 7 7 7M3 12h18",
};
function BoardIcon({ name }: { name: keyof typeof iconPaths }) {
  return <svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={iconPaths[name]} />{name === "share" && <><circle cx="5" cy="12" r="3" /><circle cx="19" cy="4" r="3" /><circle cx="19" cy="20" r="3" /></>}</svg>;
}

async function boardPng(svg: SVGSVGElement): Promise<Blob> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const height = Math.round(svg.viewBox.baseVal.height);
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg"); copy.setAttribute("width", String(COURT.width)); copy.setAttribute("height", String(height));
  copy.removeAttribute("class"); copy.removeAttribute("style");
  const source = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("画像を作成できませんでした。")); image.src = source; });
    const canvas = document.createElement("canvas"); canvas.width = COURT.width; canvas.height = height;
    const context = canvas.getContext("2d"); if (!context) throw new Error("このブラウザでは画像を作成できません。");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNGを作成できませんでした。")), "image/png"));
  } finally { URL.revokeObjectURL(source); }
}

export function PadelBoard() {
  const [board, setBoard] = useState<BoardState>(initialBoard), [history, setHistory] = useState<BoardState[]>([]);
  const live = useRef(board), gesture = useRef<Gesture | null>(null), svg = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<"move" | "draw">("move"), [drawColor, setDrawColor] = useState<DrawingColor>("green");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const palette = useRef<HTMLDivElement>(null), drawButton = useRef<HTMLButtonElement>(null);
  const mode = tool === "move" ? "place" : "draw";
  // 操作・履歴の座標系は維持し、表示だけを利用可能な画面比率へ合わせる。
  const [displayHeight, setDisplayHeight] = useState<number>(COURT.height);
  const scaleY = displayHeight / COURT.height;
  const [active, setActive] = useState(false), [busy, setBusy] = useState(false);
  const [back, setBack] = useState("/"), [notice, setNotice] = useState(""), [preview, setPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null), busyRef = useRef(false), mounted = useRef(true);
  useEffect(() => { setBack(boardReturnPath(new URLSearchParams(location.search).get("from"))); mounted.current = true; return () => { mounted.current = false; if (previewRef.current) URL.revokeObjectURL(previewRef.current); }; }, []);
  useEffect(() => {
    const court = svg.current; if (!court) return;
    const resize = () => {
      const rect = court.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setDisplayHeight(Math.max(1, Math.round(rect.height / rect.width * COURT.width)));
    };
    const observer = new ResizeObserver(resize); observer.observe(court); resize();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    // この画面だけページのスクロールを禁止。ダイアログ内のスクロールとズームは維持する。
    const preventPageScroll = (event: TouchEvent | WheelEvent) => {
      if (event.target instanceof Element && event.target.closest("dialog[open], #global-menu-panel")) return;
      if (("touches" in event && event.touches.length > 1) || ("ctrlKey" in event && event.ctrlKey)) return;
      if (event.cancelable) event.preventDefault();
    };
    document.addEventListener("touchmove", preventPageScroll, { passive: false });
    document.addEventListener("wheel", preventPageScroll, { passive: false });
    return () => { document.removeEventListener("touchmove", preventPageScroll); document.removeEventListener("wheel", preventPageScroll); };
  }, []);
  useEffect(() => {
    if (!paletteOpen) return;
    palette.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    const dismiss = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !palette.current?.contains(event.target) && !drawButton.current?.contains(event.target)) setPaletteOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setPaletteOpen(false); drawButton.current?.focus({ preventScroll: true }); }
    };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [paletteOpen]);
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
    event.preventDefault(); setPaletteOpen(false); const before = live.current, p = point(event);
    const stroke = mode === "place" ? undefined : { color: drawColor, points: [courtPoint(p, 40, scaleY)] } as Stroke;
    const position = id ? courtPoint(before.markers[id], 64, scaleY) : p;
    gesture.current = { pointer: event.pointerId, before, marker: mode === "place" ? id! : undefined, offset: id && mode === "place" ? { x: position.x - p.x, y: position.y - p.y } : { x: 0, y: 0 }, stroke };
    event.currentTarget.setPointerCapture(event.pointerId); setActive(true); setNotice("");
    if (stroke) show({ ...before, strokes: [...before.strokes, stroke] });
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const action = gesture.current; if (!action || action.pointer !== event.pointerId) return;
    event.preventDefault(); const p = point(event);
    if (action.marker) show({ ...action.before, markers: { ...action.before.markers, [action.marker]: courtPoint({ x: p.x + action.offset.x, y: p.y + action.offset.y }, 64, scaleY) } });
    else if (action.stroke) {
      const next = courtPoint(p, 40, scaleY), previous = action.stroke.points.at(-1)!;
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
    event.preventDefault(); const before = live.current, p = courtPoint(before.markers[id], 64, scaleY), amount = event.shiftKey ? 50 : 10;
    const next = { ...before, markers: { ...before.markers, [id]: courtPoint({ x: p.x + delta.x * amount, y: p.y + delta.y * amount }, 64, scaleY) } };
    remember(before, next); show(next);
  };
  const closePreview = () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); previewRef.current = null; setPreview(null); };
  const exportImage = async (action: "save" | "share") => {
    if (busyRef.current || gesture.current || !svg.current) return;
    busyRef.current = true; setBusy(true); setPaletteOpen(false); setNotice("");
    try {
      const blob = await boardPng(svg.current); if (!mounted.current) return;
      const file = new File([blob], "padel-board.png", { type: "image/png" });
      let canShare = false;
      try { canShare = action === "share" && !!navigator.share && !!navigator.canShare?.({ files: [file] }); } catch { /* 能力判定が失敗した場合もPNG保存へ。 */ }
      if (canShare) {
        try { await navigator.share({ files: [file], title: "パデルボード" }); return; }
        catch (error) { if (error instanceof DOMException && error.name === "AbortError") { if (mounted.current) setNotice("共有をキャンセルしました。"); return; } }
      }
      if (mounted.current) {
        closePreview(); const url = URL.createObjectURL(blob); previewRef.current = url; setPreview(url);
        if (action === "save") {
          const link = document.createElement("a"); link.href = url; link.download = "padel-board.png"; link.target = "_blank"; link.rel = "noopener noreferrer";
          document.body.appendChild(link); link.click(); link.remove();
          // iOS等でdownloadが利用できない場合も、既存のプレビューから保存できる。
        }
      }
    } catch (error) { if (mounted.current) setNotice(error instanceof Error ? error.message : "画像を作成できませんでした。もう一度お試しください。"); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  return <main className={styles.page}>
    <header className={styles.header}><Link href={back} aria-label="戻る" title="元の画面へ戻る"><BoardIcon name="back" /></Link><h1 className="text-xl font-bold">パデルボード</h1></header>
    <div className={styles.courtArea}>
    <svg ref={svg} xmlns="http://www.w3.org/2000/svg" width={COURT.width} height={COURT.height} viewBox={`0 0 ${COURT.width} ${displayHeight}`} role="group" aria-label="パデルコート" data-mode={mode} className={styles.court} onPointerDown={start} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}>
      <defs>{drawChoices.map(([color]) => <marker key={color} id={`board-arrow-${color}`} viewBox="0 0 32 28" refX="28" refY="14" markerWidth="32" markerHeight="28" markerUnits="userSpaceOnUse" orient="auto"><path d="M2 2L28 14L2 26" fill="none" stroke={DRAW_COLORS[color]} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" /></marker>)}</defs>
      <rect width={COURT.width} height={displayHeight} fill={colors.court} />
      <g stroke={colors.line} strokeWidth="5" fill="none"><path data-court-services d={`M0 ${COURT.serviceTop * scaleY}H1000 M0 ${COURT.serviceBottom * scaleY}H1000 M500 ${COURT.serviceTop * scaleY}V${COURT.serviceBottom * scaleY}`} /><path data-court-net d={`M0 ${COURT.net * scaleY}H1000`} strokeWidth="9" /></g>
      <g data-board-strokes>{board.strokes.map((stroke, i) => <path key={i} d={strokePath(stroke.points.map(p => { const next = courtPoint(p, 40, scaleY); return { x: next.x, y: next.y * scaleY }; }))} fill="none" stroke={DRAW_COLORS[stroke.color]} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" markerEnd={stroke.points.length > 1 ? `url(#board-arrow-${stroke.color})` : undefined} data-stroke-color={stroke.color} />)}</g>
      {MARKERS.map(id => { const p = courtPoint(board.markers[id], 64, scaleY), ball = id === "ball"; return <g key={id} data-marker={id} transform={`translate(${p.x} ${p.y * scaleY})`} role="img" aria-label={`${ball ? "ボール" : id}（移動モードでは矢印キーでも移動できます）`} tabIndex={mode === "place" && !busy ? 0 : -1} onKeyDown={event => markerKey(event, id)}>
        <circle r="64" fill="transparent" />
        <circle r={ball ? 23 : 42} fill={ball ? colors.ball : id.startsWith("A") ? colors.a : colors.b} stroke={colors.line} strokeWidth="4" />
        {!ball && <text textAnchor="middle" dominantBaseline="central" fontSize="38" fontWeight="700" fontFamily="system-ui,sans-serif" fill={id.startsWith("A") ? colors.ink : colors.line} pointerEvents="none">{id}</text>}
      </g>; })}
    </svg>
    </div>
    <div className={styles.controls} role="group" aria-label="作戦ボードの操作">
      <button aria-label="移動" title="移動" disabled={busy || active} aria-pressed={tool === "move"} onClick={() => { setTool("move"); setPaletteOpen(false); }}><BoardIcon name="move" /><span className={styles.modeLabel}>移動</span></button>
      <button ref={drawButton} aria-label="描く" title={`描く（${drawChoices.find(([color]) => color === drawColor)![1]}）`} aria-haspopup="dialog" aria-controls="board-palette" aria-expanded={paletteOpen} disabled={busy || active} aria-pressed={tool === "draw"} onClick={() => { setTool("draw"); setPaletteOpen(open => !open); }}><BoardIcon name="pen" /><span className={styles.modeLabel}>描く</span><span className={styles.colorIndicator} style={{ background: DRAW_COLORS[drawColor] }} aria-hidden="true" /></button>
      <button aria-label="戻す" title="直前の操作を取り消す" disabled={!history.length || busy || active} onClick={() => { const previous = history.at(-1); if (previous) { show(previous); setHistory(rows => rows.slice(0, -1)); setNotice(""); } }}><BoardIcon name="undo" /></button>
      <button aria-label="初期化" title="ボードを初期状態に戻す" disabled={busy || active} onClick={() => { const next = initialBoard(); remember(live.current, next); show(next); setNotice(""); }}><BoardIcon name="reset" /></button>
      <button aria-label="保存" title="PNG画像を保存" disabled={busy || active} onClick={() => void exportImage("save")}><BoardIcon name="download" /></button>
      <button aria-label="画像を共有" title="共有" disabled={busy || active} onClick={() => void exportImage("share")}><BoardIcon name="share" /></button>
      {paletteOpen && <div ref={palette} id="board-palette" className={styles.palette} role="dialog" aria-label="描画色">
        {drawChoices.map(([color, label]) => <button key={color} aria-label={label} title={label} aria-pressed={drawColor === color} disabled={busy || active} onClick={() => { setDrawColor(color); setPaletteOpen(false); drawButton.current?.focus({ preventScroll: true }); }}><span className={styles.swatch} style={{ background: DRAW_COLORS[color] }} /></button>)}
      </div>}
    </div>
    {(busy || notice) && <p role="status" className={styles.notice}>{busy ? "画像を作成中…" : notice}</p>}
    <AppDialog open={preview !== null} title="PNGを保存" onClose={closePreview}><div className="space-y-3 overflow-y-auto p-4">{preview && <><img src={preview} alt="作成したパデルボードのPNG" className={styles.preview} /><a className={styles.save} href={preview} download="padel-board.png" target="_blank" rel="noopener noreferrer">PNGを保存</a><p className="text-xs">画像を長押しして保存することもできます。</p></>}</div></AppDialog>
  </main>;
}
