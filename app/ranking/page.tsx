import { GroupDestinations } from "@/components/group-destinations";

export default function RankingPage() {
  return <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4"><h1 className="pr-14 text-xl font-bold">ランキング</h1><GroupDestinations ranking /></main>;
}
