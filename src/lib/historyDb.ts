import fs from "fs/promises";
import path from "path";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  goalieGames, histGames, histGoalieGames, histPlayerGames, matches, skaterGames,
  type HistGame, type HistGoalieGame, type HistPlayerGame,
} from "@/db/schema";
import { nameKey } from "./seasonStats";
import { sameTeam, seasonOf, type HistParsed } from "./history";
import type { HistDetails } from "./histDetails";

/** Сохранить (перезаписать) один старый протокол. */
export async function saveHistGame(p: HistParsed, opts: { writeFile?: boolean } = {}): Promise<number> {
  const id = await db.transaction(async (tx) => {
    await tx.delete(histGames).where(eq(histGames.extId, p.extId));
    const [ins] = await tx
      .insert(histGames)
      .values({
        extId: p.extId, sourceUrl: p.sourceUrl, date: p.date, season: p.season, competition: p.competition,
        gameNo: p.gameNo, homeTeam: p.homeTeam, awayTeam: p.awayTeam, homeScore: p.homeScore,
        awayScore: p.awayScore, attendance: p.attendance, details: p.details ?? null,
      })
      .returning({ id: histGames.id });
    const team = (s: "home" | "away") => (s === "home" ? p.homeTeam : p.awayTeam);
    const opp = (s: "home" | "away") => (s === "home" ? p.awayTeam : p.homeTeam);
    if (p.players.length) {
      await tx.insert(histPlayerGames).values(
        p.players.map((x) => ({
          gameId: ins.id, side: x.side, team: team(x.side), opponent: opp(x.side), name: x.name, nameKey: x.nameKey,
          jersey: x.jersey, position: x.position, played: x.played, goals: x.goals, assists: x.assists,
          ppGoals: x.ppGoals, shGoals: x.shGoals, pim: x.pim,
        })),
      );
    }
    if (p.goalies.length) {
      await tx.insert(histGoalieGames).values(
        p.goalies.map((x) => ({
          gameId: ins.id, side: x.side, team: team(x.side), opponent: opp(x.side), name: x.name, nameKey: x.nameKey,
          jersey: x.jersey, toiSeconds: x.toiSeconds, goalsAgainst: x.goalsAgainst, saves: x.saves, won: x.won,
        })),
      );
    }
    return ins.id;
  });
  if (opts.writeFile !== false) await writeHistoryFile();
  return id;
}

// ---------------------------------------------------------------------------
// Защита от повторной загрузки и подробности для карточки матча (новое)
// ---------------------------------------------------------------------------

/** Уже загруженный протокол: по id протокола (extId). */
export async function findHistByExtId(extId: number): Promise<HistGame | null> {
  const [g] = await db.select().from(histGames).where(eq(histGames.extId, extId)).limit(1);
  return g ?? null;
}

/** Тот же матч под другим id протокола: та же дата и те же команды. */
export async function findHistSameMatch(p: Pick<HistParsed, "extId" | "date" | "homeTeam" | "awayTeam">): Promise<HistGame | null> {
  const sameDay = await db.select().from(histGames).where(eq(histGames.date, p.date));
  return (
    sameDay.find((g) => g.extId !== p.extId && sameTeam(g.homeTeam, p.homeTeam) && sameTeam(g.awayTeam, p.awayTeam)) ?? null
  );
}

export async function setHistDetails(id: number, details: HistDetails): Promise<void> {
  await db.update(histGames).set({ details }).where(eq(histGames.id, id));
}

const FILE = () => path.join(process.cwd(), "data", "history.json");

type HistoryFile = {
  version: 1;
  exportedAt: string;
  games: { game: HistGame; players: HistPlayerGame[]; goalies: HistGoalieGame[] }[];
};

export async function writeHistoryFile(): Promise<void> {
  try {
    const [g, p, k] = await Promise.all([
      db.select().from(histGames),
      db.select().from(histPlayerGames),
      db.select().from(histGoalieGames),
    ]);
    const file: HistoryFile = {
      version: 1,
      exportedAt: new Date().toISOString(),
      games: g.map((x) => ({
        game: x,
        players: p.filter((r) => r.gameId === x.id),
        goalies: k.filter((r) => r.gameId === x.id),
      })),
    };
    await fs.mkdir(path.dirname(FILE()), { recursive: true });
    await fs.writeFile(FILE(), JSON.stringify(file), "utf8");
  } catch (e) {
    console.error("[history] не удалось записать файл:", e);
  }
}

export async function restoreHistoryFromFileIfEmpty(): Promise<number> {
  const ex = await db.select({ id: histGames.id }).from(histGames).limit(1);
  if (ex.length) return 0;
  let raw: string;
  try {
    raw = await fs.readFile(FILE(), "utf8");
  } catch {
    return 0;
  }
  const file = JSON.parse(raw) as HistoryFile;
  if (!file || !Array.isArray(file.games)) return 0;
  let n = 0;
  await db.transaction(async (tx) => {
    for (const e of file.games) {
      const { id: _id, importedAt: _ia, ...g } = e.game;
      void _id;
      void _ia;
      const [ins] = await tx.insert(histGames).values(g).returning({ id: histGames.id });
      const strip = <T extends { id: number; gameId: number }>(r: T) => {
        const { id: _i, gameId: _g, ...rest } = r;
        void _i;
        void _g;
        return { ...rest, gameId: ins.id };
      };
      if (e.players.length) await tx.insert(histPlayerGames).values(e.players.map(strip));
      if (e.goalies.length) await tx.insert(histGoalieGames).values(e.goalies.map(strip));
      n += 1;
    }
  });
  return n;
}

// ---------------------------------------------------------------------------
// Поматчевые логи игрока: архив старых протоколов + текущие матчи из базы
// ---------------------------------------------------------------------------

export type SkaterLog = {
  source: "archive" | "current";
  date: string; season: string; team: string; opponent: string; home: boolean;
  score: string; won: boolean;
  played: boolean; goals: number; assists: number; points: number; pim: number;
};
export type GoalieLog = {
  source: "archive" | "current";
  date: string; season: string; team: string; opponent: string; home: boolean;
  score: string; won: boolean;
  toiSeconds: number; goalsAgainst: number; saves: number | null;
};

type CurMatch = { id: number; date: string; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number };

/** Матч архива дублирует матч текущей базы (одна дата, те же команды)? */
function isDup(h: HistGame, cur: CurMatch[]): boolean {
  return cur.some((m) => m.date === h.date && sameTeam(m.homeTeam, h.homeTeam) && sameTeam(m.awayTeam, h.awayTeam));
}

export async function loadSkaterLogs(keys: string[]): Promise<Map<string, SkaterLog[]>> {
  const out = new Map<string, SkaterLog[]>();
  if (!keys.length) return out;
  const keySet = new Set(keys);
  const [curMatches, hist, allSk] = await Promise.all([
    db.select().from(matches),
    db.select().from(histPlayerGames).where(inArray(histPlayerGames.nameKey, keys)),
    db.select().from(skaterGames),
  ]);
  const gameIds = [...new Set(hist.map((h) => h.gameId))];
  const games = gameIds.length ? await db.select().from(histGames).where(inArray(histGames.id, gameIds)) : [];
  const gById = new Map(games.map((g) => [g.id, g]));
  const push = (k: string, l: SkaterLog) => (out.get(k) ?? out.set(k, []).get(k)!).push(l);
  for (const h of hist) {
    const g = gById.get(h.gameId);
    if (!g || isDup(g, curMatches)) continue;
    const home = h.side === "home";
    const gf = home ? g.homeScore : g.awayScore;
    const ga = home ? g.awayScore : g.homeScore;
    push(h.nameKey, {
      source: "archive", date: g.date, season: g.season, team: h.team, opponent: h.opponent, home,
      score: `${gf}:${ga}`, won: gf > ga, played: h.played, goals: h.goals, assists: h.assists,
      points: h.goals + h.assists, pim: h.pim,
    });
  }
  const mById = new Map(curMatches.map((m) => [m.id, m]));
  for (const s of allSk) {
    const k = nameKey(s.name);
    if (!keySet.has(k)) continue;
    const m = mById.get(s.matchId);
    if (!m) continue;
    const home = s.side === "home";
    const gf = home ? m.homeScore : m.awayScore;
    const ga = home ? m.awayScore : m.homeScore;
    push(k, {
      source: "current", date: m.date, season: seasonOf(m.date), team: home ? m.homeTeam : m.awayTeam,
      opponent: home ? m.awayTeam : m.homeTeam, home, score: `${gf}:${ga}`, won: gf > ga, played: true,
      goals: s.goals, assists: s.assists, points: s.goals + s.assists, pim: s.pim,
    });
  }
  for (const l of out.values()) l.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export async function loadGoalieLogs(keys: string[]): Promise<Map<string, GoalieLog[]>> {
  const out = new Map<string, GoalieLog[]>();
  if (!keys.length) return out;
  const keySet = new Set(keys);
  const [curMatches, hist, allG] = await Promise.all([
    db.select().from(matches),
    db.select().from(histGoalieGames).where(inArray(histGoalieGames.nameKey, keys)),
    db.select().from(goalieGames),
  ]);
  const gameIds = [...new Set(hist.map((h) => h.gameId))];
  const games = gameIds.length ? await db.select().from(histGames).where(inArray(histGames.id, gameIds)) : [];
  const gById = new Map(games.map((g) => [g.id, g]));
  const push = (k: string, l: GoalieLog) => (out.get(k) ?? out.set(k, []).get(k)!).push(l);
  for (const h of hist) {
    const g = gById.get(h.gameId);
    if (!g || isDup(g, curMatches) || h.toiSeconds <= 0) continue;
    const home = h.side === "home";
    const gf = home ? g.homeScore : g.awayScore;
    const ga = home ? g.awayScore : g.homeScore;
    push(h.nameKey, {
      source: "archive", date: g.date, season: g.season, team: h.team, opponent: h.opponent, home,
      score: `${gf}:${ga}`, won: gf > ga, toiSeconds: h.toiSeconds, goalsAgainst: h.goalsAgainst, saves: h.saves,
    });
  }
  const mById = new Map(curMatches.map((m) => [m.id, m]));
  for (const g of allG) {
    const k = nameKey(g.name);
    if (!keySet.has(k) || g.toiSeconds <= 0) continue;
    const m = mById.get(g.matchId);
    if (!m) continue;
    const home = g.side === "home";
    const gf = home ? m.homeScore : m.awayScore;
    const ga = home ? m.awayScore : m.homeScore;
    push(k, {
      source: "current", date: m.date, season: seasonOf(m.date), team: home ? m.homeTeam : m.awayTeam,
      opponent: home ? m.awayTeam : m.homeTeam, home, score: `${gf}:${ga}`, won: gf > ga,
      toiSeconds: g.toiSeconds, goalsAgainst: g.goalsAgainst, saves: g.saves,
    });
  }
  for (const l of out.values()) l.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
