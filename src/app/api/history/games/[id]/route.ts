import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { histGames, histGoalieGames, histPlayerGames } from "@/db/schema";
import { fetchHtml } from "@/lib/history";
import { parseHistoricDetails } from "@/lib/histDetails";
import { setHistDetails, writeHistoryFile } from "@/lib/historyDb";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Карточка матча из архива старых протоколов: вся статистика матча
 * (периоды, броски, голы, удаления, вратари, игроки). Если подробностей ещё
 * нет (матч загружен до их появления) — один раз дозагружаем протокол.
 * ?refresh=1 — перечитать подробности из протокола заново.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id: idStr } = await ctx.params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const [game] = await db.select().from(histGames).where(eq(histGames.id, id));
  if (!game) return NextResponse.json({ error: "Матч не найден" }, { status: 404 });
  const [players, goalies] = await Promise.all([
    db.select().from(histPlayerGames).where(eq(histPlayerGames.gameId, id)).orderBy(asc(histPlayerGames.jersey)),
    db.select().from(histGoalieGames).where(eq(histGoalieGames.gameId, id)),
  ]);

  let details = game.details ?? null;
  let detailsError: string | null = null;
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  if (!details || refresh) {
    try {
      const html = await fetchHtml(game.sourceUrl);
      details = parseHistoricDetails(html);
      await setHistDetails(game.id, details);
      await writeHistoryFile();
    } catch (e) {
      detailsError = e instanceof Error ? e.message : "не удалось загрузить протокол";
    }
  }
  return NextResponse.json({ game: { ...game, details }, players, goalies, detailsError });
}
