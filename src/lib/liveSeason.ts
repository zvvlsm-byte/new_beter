/**
 * Текущий сезон из протоколов → формат «Статистика за сезоны».
 * Существующие формулы (compute.ts) не меняются: здесь только проекция
 * уже посчитанных поматчевых цифр в архивный формат Stats.
 */
import { db } from "@/db";
import {
  goalieGames,
  goals,
  matches,
  skaterGames,
  type Goal,
  type GoalieGame,
  type Match,
  type SkaterGame,
} from "@/db/schema";
import { seasonOf } from "./history";
import { nameKey, type SeasonImportMeta, type SeasonRow, type SeasonsPayload, type Stage, type Stats } from "./seasonStats";
import { matchStage } from "./seasonMode";

const SKATER_LIVE_COLS = [
  "gp", "goals", "assists", "points", "plusMinus", "pim", "avgToi", "toi",
  "ppGoals", "ppAssists", "shGoals", "shAssists", "shots", "sog", "shotPct",
  "foWon", "foLost", "foTotal", "foPct", "hits", "blocks", "gwg",
];

const GOALIE_LIVE_COLS = [
  "rostered", "gp", "toi", "wins", "otLosses", "soLosses", "losses",
  "shotsAgainst", "goalsAgainst", "saves", "savePct", "gaa", "shutouts",
  "goals", "assists", "pim",
];

type SkAcc = {
  name: string;
  nameKey: string;
  jersey: number | null;
  position: string | null;
  matchIds: Set<number>;
  goals: number; assists: number; plusMinus: number; pim: number;
  toi: number; shots: number; sog: number; hits: number; blocks: number;
  foWon: number; foTotal: number;
  ppGoals: number; ppAssists: number; shGoals: number; shAssists: number; gwg: number;
};

type GlAcc = {
  name: string;
  nameKey: string;
  jersey: number | null;
  matchIds: Set<number>;
  gp: number; wins: number; losses: number; otLosses: number; soLosses: number;
  toi: number; saves: number; goalsAgainst: number;
  shutouts: number; goals: number; assists: number; pim: number;
};

function emptySk(name: string, jersey: number | null, position: string | null): SkAcc {
  return {
    name, nameKey: nameKey(name), jersey, position,
    matchIds: new Set(), goals: 0, assists: 0, plusMinus: 0, pim: 0,
    toi: 0, shots: 0, sog: 0, hits: 0, blocks: 0, foWon: 0, foTotal: 0,
    ppGoals: 0, ppAssists: 0, shGoals: 0, shAssists: 0, gwg: 0,
  };
}

function emptyGl(name: string, jersey: number | null): GlAcc {
  return {
    name, nameKey: nameKey(name), jersey, matchIds: new Set(),
    gp: 0, wins: 0, losses: 0, otLosses: 0, soLosses: 0,
    toi: 0, saves: 0, goalsAgainst: 0, shutouts: 0, goals: 0, assists: 0, pim: 0,
  };
}

function skStats(a: SkAcc): Stats {
  const gp = a.matchIds.size;
  const foLost = Math.max(0, a.foTotal - a.foWon);
  return {
    gp,
    goals: a.goals,
    assists: a.assists,
    points: a.goals + a.assists,
    plusMinus: a.plusMinus,
    pim: a.pim,
    toi: a.toi || null,
    avgToi: gp && a.toi ? Math.round(a.toi / gp) : null,
    ppGoals: a.ppGoals,
    ppAssists: a.ppAssists,
    shGoals: a.shGoals,
    shAssists: a.shAssists,
    shots: a.shots,
    sog: a.sog,
    shotPct: a.sog ? (a.goals / a.sog) * 100 : null,
    foWon: a.foWon,
    foLost,
    foTotal: a.foTotal,
    foPct: a.foTotal ? (a.foWon / a.foTotal) * 100 : null,
    hits: a.hits,
    blocks: a.blocks,
    gwg: a.gwg,
  };
}

function glStats(a: GlAcc): Stats {
  const sa = a.saves + a.goalsAgainst;
  return {
    rostered: a.matchIds.size,
    gp: a.gp,
    toi: a.toi || null,
    wins: a.wins,
    otLosses: a.otLosses,
    soLosses: a.soLosses,
    losses: a.losses,
    shotsAgainst: sa,
    goalsAgainst: a.goalsAgainst,
    saves: a.saves,
    shutouts: a.shutouts,
    goals: a.goals,
    assists: a.assists,
    pim: a.pim,
  };
}

/** Победный гол: шайба победителя, после которой его счёт = счёт проигравшего + 1 (финальный). Не для буллитов. */
function gwgScorer(m: Match, matchGoals: Goal[]): string | null {
  if (m.winType === "so") return null;
  const winner: "home" | "away" = m.homeScore > m.awayScore ? "home" : "away";
  const loserScore = winner === "home" ? m.awayScore : m.homeScore;
  const need = loserScore + 1;
  const ordered = [...matchGoals].sort((a, b) => {
    const ta = a.time ?? "";
    const tb = b.time ?? "";
    return ta.localeCompare(tb) || a.id - b.id;
  });
  let wg = 0;
  for (const g of ordered) {
    if (g.side !== winner) continue;
    wg += 1;
    if (wg === need) return g.scorer;
  }
  return null;
}

type Bucket = {
  season: string;
  stage: Stage;
  team: string;
  skaters: Map<string, SkAcc>;
  goalies: Map<string, GlAcc>;
};

function bucketKey(season: string, stage: Stage, team: string) {
  return `${season}|${stage}|${team}`;
}

function buildBuckets(
  allMatches: Match[],
  allSkaters: SkaterGame[],
  allGoalies: GoalieGame[],
  allGoals: Goal[],
): Bucket[] {
  const map = new Map<string, Bucket>();
  const bucket = (season: string, stage: Stage, team: string): Bucket => {
    const k = bucketKey(season, stage, team);
    let b = map.get(k);
    if (!b) {
      b = { season, stage, team, skaters: new Map(), goalies: new Map() };
      map.set(k, b);
    }
    return b;
  };

  const skByMatch = new Map<number, SkaterGame[]>();
  for (const s of allSkaters) {
    const arr = skByMatch.get(s.matchId);
    if (arr) arr.push(s);
    else skByMatch.set(s.matchId, [s]);
  }
  const glByMatch = new Map<number, GoalieGame[]>();
  for (const g of allGoalies) {
    const arr = glByMatch.get(g.matchId);
    if (arr) arr.push(g);
    else glByMatch.set(g.matchId, [g]);
  }
  const goByMatch = new Map<number, Goal[]>();
  for (const g of allGoals) {
    const arr = goByMatch.get(g.matchId);
    if (arr) arr.push(g);
    else goByMatch.set(g.matchId, [g]);
  }

  for (const m of allMatches) {
    const season = seasonOf(m.date);
    const stage = matchStage(m);
    const matchGoals = goByMatch.get(m.id) ?? [];
    const gwg = gwgScorer(m, matchGoals);
    const gwgKey = gwg ? nameKey(gwg) : null;

    for (const side of ["home", "away"] as const) {
      const team = side === "home" ? m.homeTeam : m.awayTeam;
      const b = bucket(season, stage, team);
      for (const s of (skByMatch.get(m.id) ?? []).filter((x) => x.side === side)) {
        const key = nameKey(s.name);
        if (!key) continue;
        let a = b.skaters.get(key);
        if (!a) {
          a = emptySk(s.name.trim(), s.jersey, s.position);
          b.skaters.set(key, a);
        }
        if (s.jersey != null) a.jersey = s.jersey;
        if (s.position) a.position = s.position;
        a.matchIds.add(m.id);
        a.goals += s.goals;
        a.assists += s.assists;
        a.plusMinus += s.plusMinus;
        a.pim += s.pim;
        a.toi += s.toiSeconds;
        a.shots += s.shots;
        a.sog += s.shotsOnGoal;
        a.hits += s.hits;
        a.blocks += s.blocks;
        a.foWon += s.faceoffWins;
        a.foTotal += s.faceoffs;
        if (gwgKey && key === gwgKey) a.gwg += 1;
      }
      for (const g of (glByMatch.get(m.id) ?? []).filter((x) => x.side === side)) {
        const key = nameKey(g.name);
        if (!key) continue;
        let a = b.goalies.get(key);
        if (!a) {
          a = emptyGl(g.name.trim(), g.jersey);
          b.goalies.set(key, a);
        }
        if (g.jersey != null) a.jersey = g.jersey;
        a.matchIds.add(m.id);
        a.toi += g.toiSeconds;
        a.saves += g.saves;
        a.goalsAgainst += g.goalsAgainst;
        a.goals += g.goals;
        a.assists += g.assists;
        a.pim += g.pim;
        if (g.toiSeconds > 0) {
          a.gp += 1;
          const won = (side === "home" && m.homeScore > m.awayScore) || (side === "away" && m.awayScore > m.homeScore);
          if (won) a.wins += 1;
          else if (m.winType === "ot") a.otLosses += 1;
          else if (m.winType === "so") a.soLosses += 1;
          else a.losses += 1;
          if (g.goalsAgainst === 0) a.shutouts += 1;
        }
      }
    }

    for (const g of matchGoals) {
      const team = g.side === "home" ? m.homeTeam : m.awayTeam;
      const b = bucket(season, stage, team);
      const add = (raw: string | null | undefined, field: "ppGoals" | "ppAssists" | "shGoals" | "shAssists") => {
        if (!raw) return;
        const a = b.skaters.get(nameKey(raw));
        if (a) a[field] += 1;
      };
      if (g.strength === "pp") {
        add(g.scorer, "ppGoals");
        add(g.assist1, "ppAssists");
        add(g.assist2, "ppAssists");
      } else if (g.strength === "sh") {
        add(g.scorer, "shGoals");
        add(g.assist1, "shAssists");
        add(g.assist2, "shAssists");
      }
    }
  }

  return [...map.values()];
}

export function bucketsToPayload(buckets: Bucket[], live: boolean): SeasonsPayload {
  const imports: SeasonImportMeta[] = [];
  const skaters: SeasonRow[] = [];
  const goalies: SeasonRow[] = [];
  const now = new Date().toISOString();
  let n = 0;
  for (const b of buckets) {
    if (!b.skaters.size && !b.goalies.size) continue;
    n += 1;
    const id = -n;
    const stageLabel = b.stage === "playoff" ? "Плей-офф" : b.stage === "playin" ? "Плей-ин" : "Регулярный чемпионат";
    imports.push({
      id,
      url: live ? `live://current/${b.season}/${b.stage}/${encodeURIComponent(b.team)}` : `live://archive/${b.season}/${b.stage}/${encodeURIComponent(b.team)}`,
      divisionId: 0,
      commandId: 0,
      season: b.season,
      league: live ? "Текущий сезон (протоколы)" : "Архив протоколов",
      divisionName: stageLabel,
      stage: b.stage,
      team: b.team,
      skaterColumns: SKATER_LIVE_COLS,
      goalieColumns: GOALIE_LIVE_COLS,
      importedAt: now,
      skaterCount: b.skaters.size,
      goalieCount: b.goalies.size,
      live,
    });
    for (const a of b.skaters.values()) {
      skaters.push({
        importId: id,
        name: a.name,
        nameKey: a.nameKey,
        extId: null,
        jersey: a.jersey,
        position: a.position,
        birthDate: null,
        stats: skStats(a),
      });
    }
    for (const a of b.goalies.values()) {
      goalies.push({
        importId: id,
        name: a.name,
        nameKey: a.nameKey,
        extId: null,
        jersey: a.jersey,
        position: null,
        birthDate: null,
        stats: glStats(a),
      });
    }
  }
  return { imports, skaters, goalies };
}

export async function loadCurrentSeasonRows(): Promise<{
  matches: Match[];
  skaters: SkaterGame[];
  goalies: GoalieGame[];
  goals: Goal[];
}> {
  const [allMatches, allSkaters, allGoalies, allGoals] = await Promise.all([
    db.select().from(matches),
    db.select().from(skaterGames),
    db.select().from(goalieGames),
    db.select().from(goals),
  ]);
  return { matches: allMatches, skaters: allSkaters, goalies: allGoalies, goals: allGoals };
}

export async function buildLiveSeasonPayload(): Promise<SeasonsPayload> {
  const { matches: ms, skaters, goalies, goals: gs } = await loadCurrentSeasonRows();
  if (!ms.length) return { imports: [], skaters: [], goalies: [] };
  return bucketsToPayload(buildBuckets(ms, skaters, goalies, gs), true);
}

export function buildSeasonPayloadFromRows(
  allMatches: Match[],
  allSkaters: SkaterGame[],
  allGoalies: GoalieGame[],
  allGoals: Goal[],
  live: boolean,
): SeasonsPayload {
  return bucketsToPayload(buildBuckets(allMatches, allSkaters, allGoalies, allGoals), live);
}
