export type MatchShareEvent = {
  status: string;
  is_deleted?: boolean | null;
  share_enabled?: boolean | null;
  share_token?: string | null;
};

export type MatchShareEntry = {
  teamA: readonly (string | null | undefined)[];
  teamB: readonly (string | null | undefined)[];
  score: { a: number; b: number } | null;
  youtubeUrl?: string | null;
};

export type MatchShareKind = "events" | "official-events";

// URLだけを組み立てる。表示時には共有文章を生成しない。
export function getMatchShareUrls(event: MatchShareEvent, origin: string, kind: MatchShareKind) {
  if (event.status !== "closed" || event.is_deleted === true || event.share_enabled !== true || !event.share_token || !/^[a-zA-Z0-9_-]+$/.test(event.share_token)) return null;
  try {
    const base = new URL(origin);
    if (!["https:", "http:"].includes(base.protocol)) return null;
    return {
      detail: `${base.origin}/share/${kind}/${event.share_token}`,
      login: `${base.origin}/login`,
    };
  } catch {
    return null;
  }
}

const validScore = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

// チーム戦の未定0-0は未入力。明示的な引き分け0-0とは区別する。
export function storedTeamShareScore(a: number | null, b: number | null, result: string) {
  return validScore(a) && validScore(b) && !(a === 0 && b === 0 && result === "undecided") ? { a, b } : null;
}

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

export function buildMatchShareText(params: {
  event: MatchShareEvent;
  eventName: string;
  origin: string;
  kind: MatchShareKind;
  matches: readonly MatchShareEntry[];
}) {
  const urls = getMatchShareUrls(params.event, params.origin, params.kind);
  if (!urls) throw new Error("終了済みで共有リンクが有効なイベントのみ共有できます");
  const blocks: string[] = [];
  for (const match of params.matches) {
    const a = match.teamA.map(name => oneLine(name ?? ""));
    const b = match.teamB.map(name => oneLine(name ?? ""));
    // 下書き・選手未設定のカードを補完して出力しない。
    if (a.length !== 2 || b.length !== 2 || [...a, ...b].some(name => !name)) continue;
    const score = match.score && validScore(match.score.a) && validScore(match.score.b) ? `${match.score.a}-${match.score.b}` : "未入力";
    const lines = [`▼${oneLine(params.eventName)} ${a.join("")}vs${b.join("")}`, `スコア：${score}`];
    if (match.youtubeUrl?.trim()) lines.push(`動画URL：${match.youtubeUrl.trim()}`);
    blocks.push(lines.join("\n"));
  }
  if (!blocks.length) throw new Error("共有できる試合がありません。選手が設定済みか確認してください");
  return `戦績詳細：\n${urls.detail}\n\n${blocks.join("\n\n")}\n\nログイン・アカウント登録はこちら\n${urls.login}`;
}

// 実機・ブラウザごとのURL上限に備えた保守的な上限。文章自体は一切切り詰めない。
export const MAX_LINE_SHARE_URL_LENGTH = 8000;
export const buildLineShareUrl = (text: string) => `https://line.me/R/share?text=${encodeURIComponent(text)}`;
export const isLineMobileDevice = (userAgent: string, maxTouchPoints: number) => /Android|iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
