import type { ProfileMergePreview } from "@/lib/profile-links";

const roles: Record<string, string> = { main_admin: "メイン管理者", sub_admin: "サブ管理者", member: "メンバー" };
export function ProfileMergeSummary({ preview }: { preview: ProfileMergePreview }) {
  return <div className="space-y-3 text-sm">
    <div className="rounded-xl bg-zinc-800 p-3">
      <p className="font-semibold">仮登録選手：{preview.source.display_name}</p>
    </div>
    <div><p className="font-semibold">引き継ぐグループ所属</p>{preview.memberships.map(m => <p key={m.id} className="mt-1 text-xs text-zinc-300">{m.club_name} / {roles[m.role] ?? m.role} / {m.is_active && m.status === "active" ? "在籍" : "退会・休止"} / 登録 {new Date(m.created_at).toLocaleDateString("ja-JP")}</p>)}</div>
    <p>イベント参加 {preview.participant_count}件 / 通常試合 {preview.match_count}件（結果 {preview.result_count}件）</p>
    <p>フレンドリーチーム戦 {preview.team_match_count}件 / 公式戦 {preview.official_match_count}件</p>
    <p>統合後の本人プロフィール：<strong>{preview.target_display_name ?? "未作成"}</strong></p>
    <p className="rounded-lg border border-amber-600/40 p-3 text-xs text-amber-200">表示は申請先グループの履歴です。承認すると、この選手の過去の所属・参加・試合結果を本人プロフィールへ引き継ぎます。別グループの非公開情報はここでは表示しません。本人の表示名・設定を使用し、旧累計の数値は変更しません。</p>
  </div>;
}
