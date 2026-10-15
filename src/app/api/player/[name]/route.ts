import { asc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { matches, skaterGames } from "@/db/schema";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** Поматчевая статистика игрока (все протоколы, где он встречается под этим именем). */
export async function GET(_req: Request, ctx: Ctx) {
  const { name: rawName } = await ctx.params;
  const name = decodeURIComponent(rawName).trim();
  if (!name) return NextResponse.json({ error: "Пустое имя" }, { status: 400 });

  const lower = name.toLowerCase();
  const rows = await db
    .select({
      skater: skaterGames,
      match: matches,
    })
    .from(skaterGames)
    .innerJoin(matches, eq(skaterGames.matchId, matches.id))
    .where(sql`lower(${skaterGames.name}) = ${lower}`)
    .orderBy(asc(matches.date), asc(matches.id));

  const games = rows.map(({ skater: s, match: m }) => {
    const team = s.side === "home" ? m.homeTeam : m.awayTeam;
    const opponent = s.side === "home" ? m.awayTeam : m.homeTeam;
    const gf = s.side === "home" ? m.homeScore : m.awayScore;
    const ga = s.side === "home" ? m.awayScore : m.homeScore;
    return {
      matchId: m.id,
      date: m.date,
      team,
      opponent,
      side: s.side,
      gf,
      ga,
      winType: m.winType,
      jersey: s.jersey,
      position: s.position,
      goals: s.goals,
      assists: s.assists,
      points: s.goals + s.assists,
      plusMinus: s.plusMinus,
      shots: s.shots,
      shotsOnGoal: s.shotsOnGoal,
      hits: s.hits,
      blocks: s.blocks,
      pim: s.pim,
      toiSeconds: s.toiSeconds,
      faceoffs: s.faceoffs,
      faceoffWins: s.faceoffWins,
    };
  });

  const totals = games.reduce(
    (a, g) => ({
      gp: a.gp + 1,
      goals: a.goals + g.goals,
      assists: a.assists + g.assists,
      points: a.points + g.points,
      // +/− за сезон = простая сумма показателей за каждый матч
      plusMinus: a.plusMinus + g.plusMinus,
      shots: a.shots + g.shots,
      shotsOnGoal: a.shotsOnGoal + g.shotsOnGoal,
      hits: a.hits + g.hits,
      blocks: a.blocks + g.blocks,
      pim: a.pim + g.pim,
      toi: a.toi + g.toiSeconds,
    }),
    { gp: 0, goals: 0, assists: 0, points: 0, plusMinus: 0, shots: 0, shotsOnGoal: 0, hits: 0, blocks: 0, pim: 0, toi: 0 },
  );

  return NextResponse.json({ name, games, totals });
}
