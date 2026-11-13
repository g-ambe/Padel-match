import { appSection } from "./app-navigation";

export const COURT = { width: 1000, height: 2000, net: 1000, serviceTop: 305, serviceBottom: 1695 } as const;
export const MARKERS = ["A1", "A2", "B1", "B2", "ball"] as const;
export type MarkerId = typeof MARKERS[number];
export type Point = { x: number; y: number };
export type BoardMode = "place" | "movement" | "ball";
export type Stroke = { kind: "movement" | "ball"; points: Point[] };
export type BoardState = { markers: Record<MarkerId, Point>; strokes: Stroke[] };
export const BOARD_COLORS = { court: "#115e59", line: "#ffffff", a: "#00c896", b: "#2563eb", ball: "#fcd34d", ink: "#0b1020" };

export function initialBoard(): BoardState {
  return { markers: { A1: { x: 250, y: 1800 }, A2: { x: 750, y: 1800 }, B1: { x: 250, y: 200 }, B2: { x: 750, y: 200 }, ball: { x: 550, y: 1350 } }, strokes: [] };
}
export function courtPoint(point: Point, margin = 64): Point {
  return { x: Math.max(margin, Math.min(COURT.width - margin, point.x)), y: Math.max(margin, Math.min(COURT.height - margin, point.y)) };
}
export function strokePath(points: Point[]): string {
  if (!points.length) return "";
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], next = points[i + 1];
    d += ` Q${p.x},${p.y} ${(p.x + next.x) / 2},${(p.y + next.y) / 2}`;
  }
  const last = points[points.length - 1];
  return points.length > 1 ? `${d} L${last.x},${last.y}` : d;
}

// 戻り先は既存の内部画面だけ。外部URL・API・ボード自身には遷移しない。
export function boardReturnPath(value: string | null): string {
  if (!value || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    const url = new URL(value, "https://padel.invalid");
    const allowed = ["/", "/login", "/terms", "/privacy"].includes(url.pathname) || appSection(url.pathname) !== null || /^\/share\/(events|official-events)\//.test(url.pathname);
    return url.origin === "https://padel.invalid" && allowed ? url.pathname + url.search : "/";
  } catch { return "/"; }
}
export const padelBoardHref = (from: string) => `/padel-board?from=${encodeURIComponent(boardReturnPath(from))}`;
