/**
 * «Самые продолжительные бомбардирские серии сезона — действующие или прерванные».
 * Новый модуль: работает поверх сырых поматчевых строк, ничего в существующих
 * расчётах не меняет.
 *
 * Бомбардирская серия — матчи подряд (в порядке дат игрока), в каждом из которых
 * игрок набрал хотя бы одно очко (гол или передачу). Для каждого игрока берём
 * все серии длиной ≥ MIN_LEN; серия «идёт», если она продолжается на последний
 * матч игрока на выбранную дату, иначе — «прервана» (с датой матча, где прервалась).
 */
import type { Match, SkaterGame } from "@/db/schema";

export const SCORING_STREAK_MIN_LEN = 3;

export type ScoringStreak = {
  name: string;
  team: string;
  len: number;
  goals: number;
  assists: number;
  points: number;
  fromDate: string;
  toDate: string;
  active: boolean;
  brokenOn: string | null; // дата матча, где серия прервалась
};

export function computeScoringStreaks(
  matches: Match[],
  skaters: SkaterGame[],
  asOf: string,
  minLen = SCORING_STREAK_MIN_LEN,
): ScoringStreak[] {
  const matchById = new Map<number, Match>();
  for (const m of matches) if (m.date <= asOf) matchById.set(m.id, m);
  type G = { matchId: number; date: string; team: string; goals: number; assists: number };
  const byPlayer = new Map<string, { name: string; games: G[] }>();
  for (const s of skaters) {
    const m = matchById.get(s.matchId);
    if (!m) continue;
    const key = s.name.trim().toLowerCase();
    if (!key) continue;
    let r = byPlayer.get(key);
    if (!r) {
      r = { name: s.name.trim(), games: [] };
      byPlayer.set(key, r);
    }
    const ex = r.games.find((g) => g.matchId === m.id);
    if (ex) {
      ex.goals += s.goals;
      ex.assists += s.assists;
      continue;
    }
    r.games.push({
      matchId: m.id,
      date: m.date,
      team: s.side === "home" ? m.homeTeam : m.awayTeam,
      goals: s.goals,
      assists: s.assists,
    });
  }
  const out: ScoringStreak[] = [];
  for (const { name, games } of byPlayer.values()) {
    games.sort((a, b) => a.date.localeCompare(b.date) || a.matchId - b.matchId);
    let i = 0;
    while (i < games.length) {
      if (games[i].goals + games[i].assists <= 0) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < games.length && games[j + 1].goals + games[j + 1].assists > 0) j++;
      const len = j - i + 1;
      if (len >= minLen) {
        const slice = games.slice(i, j + 1);
        const goals = slice.reduce((a, g) => a + g.goals, 0);
        const assists = slice.reduce((a, g) => a + g.assists, 0);
        const active = j === games.length - 1;
        out.push({
          name,
          team: games[j].team,
          len,
          goals,
          assists,
          points: goals + assists,
          fromDate: games[i].date,
          toDate: games[j].date,
          active,
          brokenOn: active ? null : games[j + 1].date,
        });
      }
      i = j + 1;
    }
  }
  out.sort(
    (a, b) =>
      b.len - a.len ||
      b.points - a.points ||
      Number(b.active) - Number(a.active) ||
      a.name.localeCompare(b.name, "ru"),
  );
  return out;
}
