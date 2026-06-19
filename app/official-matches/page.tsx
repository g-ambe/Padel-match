"use client";

import { OfficialMatchList } from "@/components/official-match-list";

export default function OfficialMatchListPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">オフィシャルチームマッチ一覧</h1>
      <OfficialMatchList showCreateLink showBackLink />
    </main>
  );
}
