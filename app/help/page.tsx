import Link from "next/link";
import { HelpManual } from "@/components/help-manual";
export default function HelpPage(){return <main className="mx-auto min-h-screen max-w-md space-y-4 p-4"><h1 className="pr-14 text-xl font-bold">使い方・ヘルプ</h1><HelpManual/><Link href="/home" className="block min-h-11 p-3 text-center text-sm underline">試合トップへ</Link></main>;}
