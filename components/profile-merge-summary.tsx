import type { ProfileMergePreview } from "@/lib/profile-links";

const roles: Record<string, string> = { main_admin: "メイン管理者", sub_admin: "サブ管理者", member: "メンバー" };
export function ProfileMergeSummary({ preview }: { preview: ProfileMergePreview }) {
  return <div className="space-y-3 text-sm">
    <div className="rounded-xl bg-zinc-800 p-3">
      <p className="font-semibold">仮登録選手：{preview.source.display_name}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-zinc-300">
        {([["自己紹介", preview.source.bio], ["レベル", preview.source.play_level], ["利き手", preview.source.dominant_hand], ["ポジション", preview.source.preferred_position], ["活動地域", preview.source.activity_area]] as const).map(([label, value]) => <div key={label} className="contents"><dt>{label}</dt><dd className="whitespace-pre-wrap break-words">{value || "未設定"}</dd></div>)}
      </dl>
    </div>
    <div><p className="font-semibold">引き継ぐグループ所属</p>{preview.memberships.map(m => <p key={m.id} className="mt-1 text-xs text-zinc-300">{m.club_name} / {roles[m.role] ?? m.role} / {m.is_active && m.status === "active" ? "在籍" : "退会・休止"} / 登録 {new Date(m.created_at).toLocaleDateString("ja-JP")}</p>)}</div>
    <p>イベント参加 {preview.participant_count}件 / 通常試合 {preview.match_count}件（結果 {preview.result_count}件）</p>
    <p>フレンドリーチーム戦 {preview.team_match_count}件 / 公式戦 {preview.official_match_count}件</p>
    {preview.stats_count !== undefined && <p>引き継ぐ累計戦績 {preview.stats_count}件（変更前後を監査に保存します）</p>}
    <p>統合後の本人プロフィール：<strong>{preview.target_display_name ?? "未作成"}</strong></p>
    <p className="rounded-lg border border-amber-600/40 p-3 text-xs text-amber-200">承認すると、上記の過去の所属・参加・戦績を本人プロフィールへ引き継ぎます。本人の表示名・設定を全グループで使用します。仮登録選手の設定では上書きしません。</p>
  </div>;
}
