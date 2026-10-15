import { eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { goalieGames, goals, matches, penalties, skaterGames } from "@/db/schema";
import { computeDayFacts } from "@/lib/dayFacts";

export const dynamic = "force-dynamic";

/** Интересные факты по каждому матчу игрового дня: ?date=YYYY-MM-DD */
export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Укажите дату" }, { status: 400 });
  const dayMatches = await db.select().from(matches).where(eq(matches.date, date));
  if (!dayMatches.length) return NextResponse.json({ date, matches: [] });
  const ids = dayMatches.map((m) => m.id);
  const [sk, gk, gl, pn] = await Promise.all([
    db.select().from(skaterGames).where(inArray(skaterGames.matchId, ids)),
    db.select().from(goalieGames).where(inArray(goalieGames.matchId, ids)),
    db.select().from(goals).where(inArray(goals.matchId, ids)),
    db.select().from(penalties).where(inArray(penalties.matchId, ids)),
  ]);
  return NextResponse.json({ date, matches: computeDayFacts(date, dayMatches, sk, gk, gl, pn) });
}
