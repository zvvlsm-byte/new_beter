/**
 * «К следующим матчам»: активные серии игроков и вратарей на выбранный игровой
 * день. Серия активна, если она продолжается на последний сыгранный матч
 * игрока (на эту дату) — то есть может продлиться в следующей игре.
 *
 * Показываем только СУЩЕСТВЕННЫЕ серии — в пересчёте на количество сыгранных
 * матчей: серия в 3 матча при 3 сыгранных или в 2 матча при 12 — не серия.
 *
 * Правило существенности (len — длина серии, gp — сыграно матчей на дату):
 *   len ≥ minLen  И  (len ≥ 2·minLen  ИЛИ  len ≥ gp / 3)
 * т.е. серия охватывает хотя бы треть сыгранных игр либо достаточно длинная
 * сама по себе, чтобы быть заметной при любом количестве игр.
 *
 * Модуль ничего не пересчитывает в существующей статистике — работает поверх
 * сырых поматчевых строк протоколов.
 */

import type { GoalieGame, Match, SkaterGame } from "@/db/schema";

export type FormTone = "good" | "bad" | "neutral";

export type FormEntry = {
  kind: "skater" | "goalie";
  key: string;
  label: string;
  hint: string;
  tone: FormTone;
  name: string;
  team: string;
  len: number; // длина активной серии
  gp: number; // сыграно матчей на эту дату
  share: number; // len / gp (0..1)
  sumLabel: string | null; // «9 оч.» — сумма показателя за серию
  fromDate: string; // первый матч серии
  lastDate: string; // последний матч серии (= последний матч игрока на дату)
};

export type ConsistencyEntry = {
  name: string;
  team: string;
  gp: number;
  withPts: number; // матчей с очками
  share: number; // withPts / gp
  points: number;
  goals: number;
  assists: number;
  lastDate: string;
};

export type DayForm = {
  skaters: FormEntry[];
  goalies: FormEntry[];
  consistency: ConsistencyEntry[];
};

type SkLite = {
  date: string;
  team: string;
  goals: number;
  assists: number;
  points: number;
  plusMinus: number;
  shotsOnGoal: number;
  hits: number;
  blocks: number;
  pim: number;
};

type GkLite = {
  date: string;
  team: string;
  saves: number;
  goalsAgainst: number;
  shotsAgainst: number;
  won: boolean;
  shutout: boolean;
};

type Def<T> = {
  key: string;
  label: string;
  hint: string;
  tone: FormTone;
  minLen: number;
  pred: (g: T) => boolean;
  sum?: { get: (g: T) => number; unit: string; signed?: boolean };
  /** дополнительное условие по всем матчам игрока (например, «спад» — только у результативных) */
  eligible?: (games: T[], len: number) => boolean;
};

/** Игрок считается «в обойме», если его последний матч был не раньше, чем за столько дней до выбранной даты. */
export const RECENT_DAYS = 7;

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Минимум сыгранных матчей, чтобы вообще попасть в список (серия «3 из 3» — не серия). */
export const MIN_GP_SKATER = 5;
export const MIN_GP_GOALIE = 3;

/** «Спад» интересен только у того, кто обычно набирает очки:
 *  до начала серии сыграно ≥3 матчей со средним ≥0.5 очка за игру. */
const productive = (games: SkLite[], len: number) => {
  const pre = games.slice(0, games.length - len);
  if (pre.length < 3) return false;
  return pre.reduce((a, g) => a + g.points, 0) / pre.length >= 0.5;
};

/** Минимальная длина серии, с которой она считается заметной сама по себе (независимо от доли игр). */
const SKATER_DEFS: Def<SkLite>[] = [
  { key: "pts", label: "Очковая серия", hint: "матчи подряд с очками", tone: "good", minLen: 3, pred: (g) => g.points > 0, sum: { get: (g) => g.points, unit: "оч." } },
  { key: "goals", label: "Голевая серия", hint: "матчи подряд с голом", tone: "good", minLen: 3, pred: (g) => g.goals > 0, sum: { get: (g) => g.goals, unit: "гол." } },
  { key: "ast", label: "Серия с передачами", hint: "матчи подряд с передачей", tone: "good", minLen: 3, pred: (g) => g.assists > 0, sum: { get: (g) => g.assists, unit: "пер." } },
  { key: "multi", label: "2+ очка подряд", hint: "матчи подряд с двумя и более очками", tone: "good", minLen: 2, pred: (g) => g.points >= 2, sum: { get: (g) => g.points, unit: "оч." } },
  { key: "plus", label: "В плюсе подряд", hint: "матчи подряд с +/− больше нуля", tone: "good", minLen: 3, pred: (g) => g.plusMinus > 0, sum: { get: (g) => g.plusMinus, unit: "по +/−", signed: true } },
  { key: "sog3", label: "3+ броска в створ", hint: "матчи подряд с 3 и более бросками в створ", tone: "neutral", minLen: 4, pred: (g) => g.shotsOnGoal >= 3, sum: { get: (g) => g.shotsOnGoal, unit: "бр." } },
  { key: "hits2", label: "2+ силовых подряд", hint: "матчи подряд с двумя и более силовыми приёмами", tone: "neutral", minLen: 4, pred: (g) => g.hits >= 2, sum: { get: (g) => g.hits, unit: "сил." } },
  { key: "blocks2", label: "2+ блока подряд", hint: "матчи подряд с двумя и более заблокированными бросками", tone: "neutral", minLen: 4, pred: (g) => g.blocks >= 2, sum: { get: (g) => g.blocks, unit: "блок." } },
  { key: "nopts", label: "Без очков", hint: "матчи подряд без результативных действий (только у результативных игроков)", tone: "bad", minLen: 4, pred: (g) => g.points === 0, eligible: productive },
  { key: "minus", label: "В минусе подряд", hint: "матчи подряд с +/− меньше нуля", tone: "bad", minLen: 3, pred: (g) => g.plusMinus < 0, sum: { get: (g) => g.plusMinus, unit: "по +/−", signed: true } },
  { key: "pen", label: "Со штрафом подряд", hint: "матчи подряд с удалением", tone: "bad", minLen: 3, pred: (g) => g.pim > 0, sum: { get: (g) => g.pim, unit: "мин" } },
];

const GOALIE_DEFS: Def<GkLite>[] = [
  { key: "win", label: "Победная серия", hint: "победы подряд", tone: "good", minLen: 2, pred: (g) => g.won },
  { key: "so", label: "Сухие подряд", hint: "матчи «на ноль» подряд", tone: "good", minLen: 2, pred: (g) => g.shutout },
  { key: "sv900", label: "%ОБ 90+ подряд", hint: "матчи подряд с процентом отражённых не ниже 90%", tone: "good", minLen: 2, pred: (g) => g.shotsAgainst > 0 && g.saves / g.shotsAgainst >= 0.9, sum: { get: (g) => g.saves, unit: "сейв." } },
  { key: "ga2", label: "≤2 пропущенных подряд", hint: "матчи подряд, пропустив не больше двух", tone: "good", minLen: 2, pred: (g) => g.goalsAgainst <= 2, sum: { get: (g) => g.goalsAgainst, unit: "проп." } },
  { key: "loss", label: "Серия поражений", hint: "поражения подряд", tone: "bad", minLen: 3, pred: (g) => !g.won },
  { key: "ga4", label: "4+ пропущенных подряд", hint: "матчи подряд, пропустив 4 и больше", tone: "bad", minLen: 2, pred: (g) => g.goalsAgainst >= 4, sum: { get: (g) => g.goalsAgainst, unit: "проп." } },
];

/** Длина серии, идущей на конец списка (активной). */
function tail<T>(games: T[], pred: (g: T) => boolean): number {
  let n = 0;
  for (let i = games.length - 1; i >= 0; i--) {
    if (pred(games[i])) n += 1;
    else break;
  }
  return n;
}

/** Существенна ли серия длиной len при gp сыгранных матчах. */
export function isSignificant(len: number, gp: number, minLen: number): boolean {
  if (len < minLen) return false;
  return len >= minLen * 2 || len * 3 >= gp;
}

function build<T extends { date: string; team: string }>(
  kind: "skater" | "goalie",
  name: string,
  games: T[],
  defs: Def<T>[],
): FormEntry[] {
  const out: FormEntry[] = [];
  const gp = games.length;
  if (!gp) return out;
  const last = games[gp - 1];
  for (const d of defs) {
    const len = tail(games, d.pred);
    if (!isSignificant(len, gp, d.minLen)) continue;
    if (d.eligible && !d.eligible(games, len)) continue;
    const slice = games.slice(gp - len);
    let sumLabel: string | null = null;
    if (d.sum) {
      const total = slice.reduce((a, g) => a + d.sum!.get(g), 0);
      sumLabel = `${d.sum.signed && total > 0 ? "+" : ""}${total} ${d.sum.unit}`;
    }
    out.push({
      kind, key: d.key, label: d.label, hint: d.hint, tone: d.tone,
      name, team: last.team, len, gp, share: len / gp, sumLabel,
      fromDate: slice[0].date, lastDate: last.date,
    });
  }
  return out;
}

/** Сортировка: «хорошие» серии выше нейтральных и «плохих»; внутри — по доле сыгранных матчей, затем по длине. */
const toneRank: Record<FormTone, number> = { good: 0, neutral: 1, bad: 2 };
function sortEntries(list: FormEntry[]): FormEntry[] {
  return list.sort(
    (a, b) =>
      toneRank[a.tone] - toneRank[b.tone] ||
      b.share - a.share ||
      b.len - a.len ||
      a.name.localeCompare(b.name, "ru"),
  );
}

/**
 * Активные серии на дату `asOf` (включительно): учитываются только матчи с датой ≤ asOf.
 * Матчи упорядочиваются по дате и id — так же, как в карточках игрока/вратаря.
 */
export function computeDayForm(
  matches: Match[],
  skaters: SkaterGame[],
  goalies: GoalieGame[],
  asOf: string,
  opts: { minGpForConsistency?: number; minShareForConsistency?: number } = {},
): DayForm {
  const minGp = opts.minGpForConsistency ?? 6;
  const minShare = opts.minShareForConsistency ?? 0.5;

  const matchById = new Map<number, Match>();
  for (const m of matches) if (m.date <= asOf) matchById.set(m.id, m);
  const order = (a: { date: string; matchId: number }, b: { date: string; matchId: number }) =>
    a.date.localeCompare(b.date) || a.matchId - b.matchId;

  // --- полевые ---
  const bySkater = new Map<string, { name: string; games: (SkLite & { matchId: number })[] }>();
  for (const s of skaters) {
    const m = matchById.get(s.matchId);
    if (!m) continue;
    const key = s.name.trim().toLowerCase();
    if (!key) continue;
    let r = bySkater.get(key);
    if (!r) {
      r = { name: s.name.trim(), games: [] };
      bySkater.set(key, r);
    }
    r.games.push({
      matchId: m.id,
      date: m.date,
      team: s.side === "home" ? m.homeTeam : m.awayTeam,
      goals: s.goals,
      assists: s.assists,
      points: s.goals + s.assists,
      plusMinus: s.plusMinus,
      shotsOnGoal: s.shotsOnGoal,
      hits: s.hits,
      blocks: s.blocks,
      pim: s.pim,
    });
  }
  const skaterEntries: FormEntry[] = [];
  const consistency: ConsistencyEntry[] = [];
  for (const { name, games } of bySkater.values()) {
    games.sort(order);
    // только те, кто играл недавно — иначе «к следующим матчам» не относится
    const recent = daysBetween(games[games.length - 1].date, asOf) <= RECENT_DAYS;
    if (recent && games.length >= MIN_GP_SKATER) skaterEntries.push(...build("skater", name, games, SKATER_DEFS));
    // стабильность: очки в N из M матчей (не обязательно подряд)
    const gp = games.length;
    if (gp >= minGp) {
      const withPts = games.filter((g) => g.points > 0).length;
      if (withPts / gp >= minShare) {
        consistency.push({
          name,
          team: games[gp - 1].team,
          gp,
          withPts,
          share: withPts / gp,
          points: games.reduce((a, g) => a + g.points, 0),
          goals: games.reduce((a, g) => a + g.goals, 0),
          assists: games.reduce((a, g) => a + g.assists, 0),
          lastDate: games[gp - 1].date,
        });
      }
    }
  }
  consistency.sort(
    (a, b) => b.share - a.share || b.withPts - a.withPts || b.points - a.points || a.name.localeCompare(b.name, "ru"),
  );

  // --- вратари: только реально сыгранные матчи (есть игровое время), как в карточке вратаря ---
  const byGoalie = new Map<string, { name: string; games: (GkLite & { matchId: number })[] }>();
  for (const g of goalies) {
    const m = matchById.get(g.matchId);
    if (!m || g.toiSeconds <= 0) continue;
    const key = g.name.trim().toLowerCase();
    if (!key) continue;
    let r = byGoalie.get(key);
    if (!r) {
      r = { name: g.name.trim(), games: [] };
      byGoalie.set(key, r);
    }
    const gf = g.side === "home" ? m.homeScore : m.awayScore;
    const ga = g.side === "home" ? m.awayScore : m.homeScore;
    r.games.push({
      matchId: m.id,
      date: m.date,
      team: g.side === "home" ? m.homeTeam : m.awayTeam,
      saves: g.saves,
      goalsAgainst: g.goalsAgainst,
      shotsAgainst: g.saves + g.goalsAgainst,
      won: gf > ga,
      shutout: g.goalsAgainst === 0,
    });
  }
  const goalieEntries: FormEntry[] = [];
  for (const { name, games } of byGoalie.values()) {
    games.sort(order);
    if (daysBetween(games[games.length - 1].date, asOf) > RECENT_DAYS) continue;
    if (games.length < MIN_GP_GOALIE) continue;
    goalieEntries.push(...build("goalie", name, games, GOALIE_DEFS));
  }

  return {
    skaters: sortEntries(skaterEntries),
    goalies: sortEntries(goalieEntries),
    consistency,
  };
}
