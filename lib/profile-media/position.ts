export type AvatarPosition = { x: number; y: number; zoom: number };
export const CENTERED_AVATAR: AvatarPosition = { x: 0.5, y: 0.5, zoom: 1 };
export const MAX_AVATAR_ZOOM = 4;
export function avatarPosition(profile?: { avatar_focus_x?: number; avatar_focus_y?: number; avatar_zoom?: number }): AvatarPosition {
  const p = { x: profile?.avatar_focus_x ?? 0.5, y: profile?.avatar_focus_y ?? 0.5, zoom: profile?.avatar_zoom ?? 1 };
  return validAvatarPosition(p) ? p : { ...CENTERED_AVATAR };
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function validAvatarPosition(value: unknown): value is AvatarPosition {
  if (!value || typeof value !== "object") return false;
  const p = value as AvatarPosition;
  return Number.isFinite(p.x) && p.x >= 0 && p.x <= 1 && Number.isFinite(p.y) && p.y >= 0 && p.y <= 1
    && Number.isFinite(p.zoom) && p.zoom >= 1 && p.zoom <= MAX_AVATAR_ZOOM;
}

// 正方形の一辺を1とした描画サイズ。保存値は表示ピクセル数に依存しない。
export function avatarGeometry(width: number, height: number, position: AvatarPosition) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !validAvatarPosition(position)) throw new Error("写真の表示設定を確認してください");
  const shortest = Math.min(width, height), renderedWidth = width / shortest * position.zoom, renderedHeight = height / shortest * position.zoom;
  const x = clamp(position.x, 0.5 / renderedWidth, 1 - 0.5 / renderedWidth);
  const y = clamp(position.y, 0.5 / renderedHeight, 1 - 0.5 / renderedHeight);
  return { width: renderedWidth, height: renderedHeight, x, y, zoom: position.zoom };
}

export function clampAvatarPosition(width: number, height: number, position: AvatarPosition): AvatarPosition {
  const p = avatarGeometry(width, height, position);
  return { x: p.x, y: p.y, zoom: p.zoom };
}

export function moveAvatarPosition(width: number, height: number, circleSize: number, position: AvatarPosition, dx: number, dy: number): AvatarPosition {
  if (!Number.isFinite(circleSize) || circleSize <= 0 || !Number.isFinite(dx) || !Number.isFinite(dy)) return position;
  const size = avatarGeometry(width, height, position);
  return clampAvatarPosition(width, height, { x: clamp(size.x - dx / (size.width * circleSize), 0, 1), y: clamp(size.y - dy / (size.height * circleSize), 0, 1), zoom: position.zoom });
}

export function sameAvatarPosition(a: AvatarPosition, b: AvatarPosition) {
  return Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.y - b.y) < 1e-8 && Math.abs(a.zoom - b.zoom) < 1e-8;
}
