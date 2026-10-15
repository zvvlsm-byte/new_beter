import { NextResponse } from "next/server";
import { db } from "@/db";
import { matches } from "@/db/schema";
import { getActiveStage, matchStage, normalizeStage, setActiveStage } from "@/lib/seasonMode";
import { STAGES, type Stage } from "@/lib/seasonStats";

export const dynamic = "force-dynamic";

export async function GET() {
  const [activeStage, all] = await Promise.all([getActiveStage(), db.select({ id: matches.id, stage: matches.stage }).from(matches)]);
  const counts = { regular: 0, playoff: 0, playin: 0 };
  for (const m of all) counts[matchStage(m)] += 1;
  return NextResponse.json({ activeStage, counts, total: all.length });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { stage?: string };
  if (!STAGES.some((s) => s.key === body.stage)) {
    return NextResponse.json({ error: "Укажите стадию: regular или playoff" }, { status: 400 });
  }
  const stage = normalizeStage(body.stage) as Stage;
  await setActiveStage(stage);
  return NextResponse.json({ ok: true, activeStage: stage });
}
