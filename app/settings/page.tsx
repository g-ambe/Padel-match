"use client";

import Link from "next/link";
import { Card } from "@/components/ui";
import { useTheme } from "@/components/theme-provider";

export default function SettingsPage() {
  const { theme, saving, message, setTheme } = useTheme();
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4"><h1 className="pr-14 text-xl font-bold">アカウント・アプリ設定</h1>
    <Card title="アカウント"><Link href="/profile" className="block min-h-12 rounded-xl border border-zinc-600 p-3 text-sm">プロフィール・所属グループ・連携申請</Link></Card>
    <Card title="表示設定"><p className="mb-3 text-sm text-zinc-300">テーマ</p><div className="grid grid-cols-2 gap-2">{([["dark", "ダークモード"], ["light", "ホワイトモード"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={theme === value} disabled={saving} className={`min-h-12 rounded-xl border p-2 text-sm ${theme === value ? "border-accent bg-accent font-bold text-black" : "border-zinc-600"}`} onClick={() => void setTheme(value)}>{label}</button>)}</div>{message && <p role="status" className="mt-3 text-xs text-accent">{message}</p>}</Card>
    <Link href="/about" className="min-h-11 p-3 text-sm underline">アプリについて・利用規約</Link>
  </main>;
}
