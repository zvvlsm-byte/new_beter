import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { histGames } from "@/db/schema";
import { writeHistoryFile } from "@/lib/historyDb";

export const dynamic = "force-dynamic";

/** Сводка архива старых протоколов: по сезонам и последние загруженные. */
export async function GET() {
  const [bySeason, latest] = await Promise.all([
    db
      .select({ season: histGames.season, n: sql<number>`count(*)::int`, minExt: sql<number>`min(${histGames.extId})::int`, maxExt: sql<number>`max(${histGames.extId})::int` })
      .from(histGames)
      .groupBy(histGames.season)
      .orderBy(histGames.season),
    db.select().from(histGames).orderBy(desc(histGames.importedAt), desc(histGames.id)).limit(100),
  ]);
  return NextResponse.json({ bySeason, latest });
}

export async function DELETE(req: Request) {
  const id = parseInt(new URL(req.url).searchParams.get("id") ?? "", 10);
  if (!id) return NextResponse.json({ error: "id" }, { status: 400 });
  await db.delete(histGames).where(eq(histGames.id, id));
  await writeHistoryFile();
  return NextResponse.json({ ok: true });
}
