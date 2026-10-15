import { asc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { goalieGames, matches } from "@/db/schema";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** Поматчевая статистика вратаря (все протоколы, где он встречается под этим именем). */
export async function GET(_req: Request, ctx: Ctx) {
  const { name: rawName } = await ctx.params;
  const name = decodeURIComponent(rawName).trim();
  if (!name) return NextResponse.json({ error: "Пустое имя" }, { status: 400 });

  const lower = name.toLowerCase();
  const rows = await db
    .select({
      goalie: goalieGames,
      match: matches,
    })
    .from(goalieGames)
    .innerJoin(matches, eq(goalieGames.matchId, matches.id))
    .where(sql`lower(${goalieGames.name}) = ${lower}`)
    .orderBy(asc(matches.date), asc(matches.id));

  const games = rows.map(({ goalie: g, match: m }) => {
    const team = g.side === "home" ? m.homeTeam : m.awayTeam;
    const opponent = g.side === "home" ? m.awayTeam : m.homeTeam;
    const gf = g.side === "home" ? m.homeScore : m.awayScore;
    const ga = g.side === "home" ? m.awayScore : m.homeScore;
    const won = gf > ga;
    const played = g.toiSeconds > 0;
    return {
      matchId: m.id,
      date: m.date,
      team,
      opponent,
      side: g.side,
      gf,
      ga,
      winType: m.winType,
      jersey: g.jersey,
      toiSeconds: g.toiSeconds,
      saves: g.saves,
      goalsAgainst: g.goalsAgainst,
      shotsAgainst: g.saves + g.goalsAgainst,
      result: played ? (won ? "W" : "L") : "",
      shutout: played && g.goalsAgainst === 0,
      assists: g.assists,
      hits: g.hits,
      blocks: g.blocks,
      pim: g.pim,
    };
  });

  let wins = 0;
  let losses = 0;
  let gp = 0;
  let shutouts = 0;
  const totals = games.reduce(
    (a, g) => {
      if (g.toiSeconds > 0) {
        gp += 1;
        if (g.result === "W") wins += 1;
        if (g.result === "L") losses += 1;
        if (g.shutout) shutouts += 1;
      }
      return {
        rostered: a.rostered + 1,
        toi: a.toi + g.toiSeconds,
        saves: a.saves + g.saves,
        goalsAgainst: a.goalsAgainst + g.goalsAgainst,
        shotsAgainst: a.shotsAgainst + g.shotsAgainst,
        assists: a.assists + g.assists,
        hits: a.hits + g.hits,
        blocks: a.blocks + g.blocks,
        pim: a.pim + g.pim,
      };
    },
    { rostered: 0, toi: 0, saves: 0, goalsAgainst: 0, shotsAgainst: 0, assists: 0, hits: 0, blocks: 0, pim: 0 },
  );

  return NextResponse.json({
    name,
    games,
    totals: {
      ...totals,
      gp,
      wins,
      losses,
      shutouts,
      savePct: totals.shotsAgainst ? (totals.saves / totals.shotsAgainst) * 100 : null,
      gaa: totals.toi > 0 ? (totals.goalsAgainst / (totals.toi / 60)) * 60 : null,
    },
  });
}
