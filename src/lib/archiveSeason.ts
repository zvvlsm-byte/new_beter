/**
 * «В архив»: текущие протоколы уходят в «Статистику за сезоны» и в архив
 * старых протоколов, текущие таблицы очищаются под новый сезон.
 * Формулы подсчёта не меняются.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  goalieGames,
  goals,
  histGames,
  histGoalieGames,
  histPlayerGames,
  matches,
  penalties,
  seasonGoalies,
  seasonImports,
  seasonSkaters,
  skaterGames,
  specialTeamOverrides,
  type Goal,
  type GoalieGame,
  type Match,
  type SkaterGame,
} from "@/db/schema";
import { seasonOf } from "./history";
import { writeHistoryFile } from "./historyDb";
import { buildSeasonPayloadFromRows } from "./liveSeason";
import { matchStage, setActiveStage } from "./seasonMode";
import { nameKey, stageLabel, type Stage } from "./seasonStats";
import { writeSeasonsFile } from "./seasonsDb";
import { writeSnapshotFile } from "./snapshot";

function fnv(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 900_000_000 + 1;
}

function archiveUrl(season: string, stage: Stage, team: string): string {
  return `live://archive/${season}/${stage}/${encodeURIComponent(team)}`;
}

function extIdOf(m: Match): number {
  const u = m.sourceUrl ?? "";
  const g = /games\/(\d+)/.exec(u) || /gamecenter\/(\d+)/.exec(u) || /[?&]id=(\d+)/.exec(u);
  if (g) return parseInt(g[1], 10);
  return 80_000_000 + m.id;
}

async function persistSeasonStats(
  allMatches: Match[],
  allSkaters: SkaterGame[],
  allGoalies: GoalieGame[],
  allGoals: Goal[],
): Promise<number> {
  const payload = buildSeasonPayloadFromRows(allMatches, allSkaters, allGoalies, allGoals, false);
  if (!payload.imports.length) return 0;
  const usedCmd = new Set<number>();
  let n = 0;
  await db.transaction(async (tx) => {
    for (const imp of payload.imports) {
      const url = archiveUrl(imp.season, imp.stage, imp.team);
      const year = parseInt(imp.season.slice(0, 4), 10) || 2000;
      const stageNum = imp.stage === "playoff" ? 2 : imp.stage === "playin" ? 1 : 0;
      const divisionId = 1_000_000 + year * 10 + stageNum;
      let commandId = fnv(imp.team);
      while (usedCmd.has(commandId)) commandId += 1;
      usedCmd.add(commandId);

      const existing = await tx.select({ id: seasonImports.id }).from(seasonImports).where(eq(seasonImports.url, url));
      for (const e of existing) {
        await tx.delete(seasonImports).where(eq(seasonImports.id, e.id));
      }

      const [ins] = await tx
        .insert(seasonImports)
        .values({
          url,
          divisionId,
          commandId,
          season: imp.season,
          league: "Экстралига (протоколы)",
          divisionName: stageLabel(imp.stage),
          stage: imp.stage,
          team: imp.team,
          skaterColumns: imp.skaterColumns,
          goalieColumns: imp.goalieColumns,
        })
        .returning({ id: seasonImports.id });

      const sk = payload.skaters.filter((r) => r.importId === imp.id);
      const gl = payload.goalies.filter((r) => r.importId === imp.id);
      if (sk.length) {
        await tx.insert(seasonSkaters).values(
          sk.map((p) => ({
            importId: ins.id,
            name: p.name,
            nameKey: p.nameKey,
            extId: p.extId,
            jersey: p.jersey,
            position: p.position ?? null,
            birthDate: p.birthDate,
            stats: p.stats,
            extra: {},
          })),
        );
      }
      if (gl.length) {
        await tx.insert(seasonGoalies).values(
          gl.map((p) => ({
            importId: ins.id,
            name: p.name,
            nameKey: p.nameKey,
            extId: p.extId,
            jersey: p.jersey,
            birthDate: p.birthDate,
            stats: p.stats,
            extra: {},
          })),
        );
      }
      n += 1;
    }
  });
  return n;
}

async function copyCurrentToHistory(
  allMatches: Match[],
  allSkaters: SkaterGame[],
  allGoalies: GoalieGame[],
  allGoals: Goal[],
): Promise<number> {
  const existing = await db.select().from(histGames);
  const extUsed = new Set(existing.map((e) => e.extId));
  const datePair = new Set(existing.map((e) => `${e.date}|${e.homeTeam}|${e.awayTeam}`));
  let n = 0;

  for (const m of allMatches) {
    const pair = `${m.date}|${m.homeTeam}|${m.awayTeam}`;
    if (datePair.has(pair)) continue;
    let extId = extIdOf(m);
    while (extUsed.has(extId)) extId += 1;
    extUsed.add(extId);
    datePair.add(pair);

    const stage = matchStage(m);
    const competition = stage === "playoff" ? "Плей-офф" : stage === "playin" ? "Плей-ин" : "Регулярный чемпионат";
    const matchGoals = allGoals.filter((g) => g.matchId === m.id);
    const countStr = (name: string, strength: "pp" | "sh") =>
      matchGoals.filter((g) => g.strength === strength && nameKey(g.scorer) === nameKey(name)).length;

    await db.transaction(async (tx) => {
      const [ins] = await tx
        .insert(histGames)
        .values({
          extId,
          sourceUrl: m.sourceUrl || `live://match/${m.id}`,
          date: m.date,
          season: seasonOf(m.date),
          competition,
          gameNo: null,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          attendance: m.attendance,
        })
        .returning({ id: histGames.id });

      const players = allSkaters.filter((s) => s.matchId === m.id);
      if (players.length) {
        await tx.insert(histPlayerGames).values(
          players.map((s) => {
            const team = s.side === "home" ? m.homeTeam : m.awayTeam;
            const opponent = s.side === "home" ? m.awayTeam : m.homeTeam;
            return {
              gameId: ins.id,
              side: s.side,
              team,
              opponent,
              name: s.name,
              nameKey: nameKey(s.name),
              jersey: s.jersey,
              position: s.position,
              played: true,
              goals: s.goals,
              assists: s.assists,
              ppGoals: countStr(s.name, "pp"),
              shGoals: countStr(s.name, "sh"),
              pim: s.pim,
            };
          }),
        );
      }
      const gks = allGoalies.filter((g) => g.matchId === m.id);
      if (gks.length) {
        await tx.insert(histGoalieGames).values(
          gks.map((g) => {
            const team = g.side === "home" ? m.homeTeam : m.awayTeam;
            const opponent = g.side === "home" ? m.awayTeam : m.homeTeam;
            const won =
              (g.side === "home" && m.homeScore > m.awayScore) ||
              (g.side === "away" && m.awayScore > m.homeScore);
            return {
              gameId: ins.id,
              side: g.side,
              team,
              opponent,
              name: g.name,
              nameKey: nameKey(g.name),
              jersey: g.jersey,
              toiSeconds: g.toiSeconds,
              goalsAgainst: g.goalsAgainst,
              saves: g.saves,
              won,
            };
          }),
        );
      }
    });
    n += 1;
  }
  return n;
}

export type ArchiveResult = {
  matches: number;
  seasonImports: number;
  histGames: number;
};

export async function archiveCurrentSeason(): Promise<ArchiveResult> {
  const [allMatches, allSkaters, allGoalies, allGoals] = await Promise.all([
    db.select().from(matches),
    db.select().from(skaterGames),
    db.select().from(goalieGames),
    db.select().from(goals),
  ]);
  if (!allMatches.length) {
    return { matches: 0, seasonImports: 0, histGames: 0 };
  }

  const seasonN = await persistSeasonStats(allMatches, allSkaters, allGoalies, allGoals);
  const histN = await copyCurrentToHistory(allMatches, allSkaters, allGoalies, allGoals);

  await db.transaction(async (tx) => {
    await tx.delete(penalties);
    await tx.delete(goals);
    await tx.delete(goalieGames);
    await tx.delete(skaterGames);
    await tx.delete(matches);
    await tx.delete(specialTeamOverrides);
  });
  await setActiveStage("regular");
  await writeSeasonsFile();
  await writeHistoryFile();
  await writeSnapshotFile();
  return { matches: allMatches.length, seasonImports: seasonN, histGames: histN };
}
