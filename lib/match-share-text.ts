import type { RankingGroup } from "./result-ranking";

export type MatchShareResult = { date?: string | null; ranking: readonly RankingGroup[] };

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

function eventResultText(name: string, result: MatchShareResult, detail?: string) {
  const date = result.date ? new Date(result.date) : null;
  const dateLabel = date && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date) : "未設定";
  const record = (row: RankingGroup["rows"][number]) => `${row.wins}勝${row.losses}敗${row.draws ? `${row.draws}分` : ""}（勝率${row.winRate}%）`;
  const groups = result.ranking.filter((group, index) => group.rank <= 3 || index === result.ranking.length - 1);
  const lines = groups.map(group => {
    const records = group.rows.map(record);
    const people = records.every(value => value === records[0])
      ? `${group.rows.map(row => oneLine(row.name)).join("、")}　${records[0]}`
      : group.rows.map((row, index) => `${oneLine(row.name)} ${records[index]}`).join(" ／ ");
    return `${group.rank > 3 ? "最下位" : `${group.rank}位`}　${people}`;
  });
  return [`【イベント結果】`, `イベント名：${oneLine(name)}`, `開催日：${dateLabel}`, "", "【ランキング】",
    ...(lines.length ? lines : ["戦績未登録"]), ...(detail ? ["", "戦績詳細：", detail] : [])].join("\n");
}

export function buildMatchShareText(params: {
  event: MatchShareEvent;
  eventName: string;
  origin: string;
  kind: MatchShareKind;
  matches: readonly MatchShareEntry[];
  allowUnsharedText?: boolean;
  result?: MatchShareResult;
}) {
  const urls = getMatchShareUrls(params.event, params.origin, params.kind);
  const base = new URL(params.origin);
  if (!urls && !(params.allowUnsharedText && params.event.status === "closed" && params.event.is_deleted !== true && ["https:", "http:"].includes(base.protocol))) throw new Error("終了済みで共有リンクが有効なイベントのみ共有できます");
  // 既存の結果画面が計算した順位グループ・勝率を使う。他形式の文章は従来どおり。
  if (params.kind === "events" && params.result) return eventResultText(params.eventName, params.result, urls?.detail);
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
  return `${urls ? `戦績詳細：\n${urls.detail}\n\n` : ""}${blocks.join("\n\n")}\n\nログイン・アカウント登録はこちら\n${urls?.login ?? `${base.origin}/login`}`;
}

// 実機・ブラウザごとのURL上限に備えた保守的な上限。文章自体は一切切り詰めない。
export const MAX_LINE_SHARE_URL_LENGTH = 8000;
export const buildLineShareUrl = (text: string) => `https://line.me/R/share?text=${encodeURIComponent(text)}`;
export const isLineMobileDevice = (userAgent: string, maxTouchPoints: number) => /Android|iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
