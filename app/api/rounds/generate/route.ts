import { NextRequest, NextResponse } from "next/server";
import { generateRound } from "@/lib/round-generator";
import { Player } from "@/lib/types";


export async function POST(req: NextRequest) {
  const body = (await req.json()) as { players: Player[]; courtCount: number };
  const result = generateRound(body.players, body.courtCount);
  return NextResponse.json(result);
}
