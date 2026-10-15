import { NextResponse } from "next/server";
import { archiveCurrentSeason } from "@/lib/archiveSeason";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await archiveCurrentSeason();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
