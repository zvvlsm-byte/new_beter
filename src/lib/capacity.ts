import type { Match } from "@/db/schema";

/**
 * НОВЫЙ модуль: вместимость арен, аншлаги и заполняемость.
 * Существующие расчёты (src/lib/compute.ts) не изменяются и не используются —
 * здесь только дополнительная инфографика для страницы «Зрители».
 *
 * Арена привязана к команде-хозяйке: у каждой команды одна домашняя площадка.
 * Вместимость вводится вручную, аншлагом считается матч, где зрителей >= вместимости.
 */

export type ArenaCapacityRow = {
  team: string;
  arenaName: string | null;
  capacity: number | null;
};

/** Один домашний матч, у которого известны и зрители, и вместимость арены. */
export type ArenaMatchRow = {
  matchId: number;
  date: string;
  homeTeam: string;
  awayTeam: string;
  label: string;
  arenaName: string | null;
  attendance: number;
  capacity: number;
  fillPct: number; // attendance / capacity * 100
  sellout: boolean; // attendance >= capacity
  freeSeats: number; // max(0, capacity - attendance)
};

/** Сводка по одной арене (команде-хозяйке). */
export type ArenaStatsRow = {
  team: string;
  arenaName: string | null;
  capacity: number | null;
  homeGames: number; // все домашние матчи
  gamesWithAttendance: number; // домашние матчи со зрителями
  games: number; // матчи, по которым считается заполняемость (зрители + вместимость)
  total: number; // всего зрителей по матчам с данными
  avg: number | null; // средняя посещаемость
  avgFillPct: number | null; // средняя заполняемость: avg / capacity
  seats: number; // сумма мест по матчам с вместимостью
  freeSeats: number; // свободные места по тем же матчам
  fillPct: number | null; // total / seats * 100
  sellouts: number; // аншлаги
  selloutPct: number | null; // sellouts / games * 100
  maxAttendance: number | null;
  maxFillPct: number | null;
  bestMatch: ArenaMatchRow | null; // самая заполненная игра
};

export type FillBucket = {
  key: string;
  label: string;
  count: number;
  color: string;
};

export type CapacitySummary = {
  arenas: ArenaStatsRow[]; // все домашние площадки (сортировка — по заполняемости)
  arenasTotal: number;
  arenasWithCapacity: number;
  matches: ArenaMatchRow[]; // все матчи со зрителями и вместимостью (по убыванию заполненности)
  selloutMatches: ArenaMatchRow[]; // только аншлаги (по дате, свежие сверху)
  matchesTotal: number;
  sellouts: number;
  selloutPct: number | null;
  seats: number; // всего мест по сыгранным матчам
  attendance: number; // всего зрителей по тем же матчам
  freeSeats: number;
  fillPct: number | null; // общая заполняемость
  buckets: FillBucket[]; // распределение матчей по заполняемости
  biggestArena: ArenaStatsRow | null;
  bestFill: ArenaStatsRow | null;
  worstFill: ArenaStatsRow | null;
  mostSellouts: ArenaStatsRow | null;
  hasCapacity: boolean;
};

const pct = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

const BUCKETS: { key: string; label: string; color: string; test: (p: number) => boolean }[] = [
  { key: "full", label: "Аншлаг (100% и выше)", color: "bg-accent", test: (p) => p >= 100 },
  { key: "high", label: "80–99%", color: "bg-ok", test: (p) => p >= 80 && p < 100 },
  { key: "mid", label: "60–79%", color: "bg-ice", test: (p) => p >= 60 && p < 80 },
  { key: "low", label: "40–59%", color: "bg-warn", test: (p) => p >= 40 && p < 60 },
  { key: "empty", label: "ниже 40%", color: "bg-ink-soft", test: (p) => p < 40 },
];

export function computeCapacityStats(
  allMatches: Match[],
  capacities: ArenaCapacityRow[],
): CapacitySummary {
  const capByTeam = new Map<string, { arenaName: string | null; capacity: number | null }>();
  for (const c of capacities) {
    const key = c.team.trim();
    if (!key) continue;
    const capacity =
      typeof c.capacity === "number" && Number.isFinite(c.capacity) && c.capacity > 0
        ? Math.round(c.capacity)
        : null;
    capByTeam.set(key, { arenaName: c.arenaName?.trim() || null, capacity });
  }

  // арены = все команды, игравшие дома, плюс те, для которых вместимость уже введена
  const teams = new Set<string>();
  for (const m of allMatches) teams.add(m.homeTeam.trim());
  for (const [t] of capByTeam) teams.add(t);

  const acc = new Map<
    string,
    {
      homeGames: number;
      gamesWithAttendance: number;
      total: number;
      games: number;
      seats: number;
      sellouts: number;
      maxAttendance: number | null;
      maxFillPct: number | null;
      bestMatch: ArenaMatchRow | null;
    }
  >();

  const matchesRows: ArenaMatchRow[] = [];

  for (const m of allMatches) {
    const team = m.homeTeam.trim();
    let a = acc.get(team);
    if (!a) {
      a = {
        homeGames: 0,
        gamesWithAttendance: 0,
        total: 0,
        games: 0,
        seats: 0,
        sellouts: 0,
        maxAttendance: null,
        maxFillPct: null,
        bestMatch: null,
      };
      acc.set(team, a);
    }
    a.homeGames += 1;

    const attendance = typeof m.attendance === "number" ? m.attendance : null;
    if (attendance === null) continue;
    a.gamesWithAttendance += 1;
    a.total += attendance;
    if (a.maxAttendance === null || attendance > a.maxAttendance) a.maxAttendance = attendance;

    const cap = capByTeam.get(team)?.capacity ?? null;
    if (cap === null) continue;

    const label = `${m.homeTeam} ${m.homeScore}:${m.awayScore} ${m.awayTeam}`;
    const row: ArenaMatchRow = {
      matchId: m.id,
      date: m.date,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      label,
      arenaName: capByTeam.get(team)?.arenaName ?? null,
      attendance,
      capacity: cap,
      fillPct: round1((attendance / cap) * 100),
      sellout: attendance >= cap,
      freeSeats: Math.max(0, cap - attendance),
    };
    matchesRows.push(row);

    a.games += 1;
    a.seats += cap;
    if (row.sellout) a.sellouts += 1;
    if (a.maxFillPct === null || row.fillPct > a.maxFillPct) a.maxFillPct = row.fillPct;
    if (!a.bestMatch || row.fillPct > a.bestMatch.fillPct) a.bestMatch = row;
  }

  const arenas: ArenaStatsRow[] = [...teams].map((team) => {
    const a = acc.get(team) ?? {
      homeGames: 0,
      gamesWithAttendance: 0,
      total: 0,
      games: 0,
      seats: 0,
      sellouts: 0,
      maxAttendance: null,
      maxFillPct: null,
      bestMatch: null,
    };
    const cap = capByTeam.get(team);
    const avg = a.gamesWithAttendance ? Math.round(a.total / a.gamesWithAttendance) : null;
    const fill = pct(a.total, a.seats);
    return {
      team,
      arenaName: cap?.arenaName ?? null,
      capacity: cap?.capacity ?? null,
      homeGames: a.homeGames,
      gamesWithAttendance: a.gamesWithAttendance,
      games: a.games,
      total: a.total,
      avg,
      avgFillPct: avg !== null && cap?.capacity ? round1((avg / cap.capacity) * 100) : null,
      seats: a.seats,
      freeSeats: Math.max(0, a.seats - a.total),
      fillPct: fill !== null ? round1(fill) : null,
      sellouts: a.sellouts,
      selloutPct: a.games ? round1((a.sellouts / a.games) * 100) : null,
      maxAttendance: a.maxAttendance,
      maxFillPct: a.maxFillPct,
      bestMatch: a.bestMatch,
    };
  });

  arenas.sort(
    (x, y) =>
      (y.fillPct ?? -1) - (x.fillPct ?? -1) ||
      y.sellouts - x.sellouts ||
      y.total - x.total ||
      x.team.localeCompare(y.team, "ru"),
  );

  const withCapacity = arenas.filter((a) => a.capacity !== null);
  const withGames = arenas.filter((a) => a.games > 0);

  const matches = [...matchesRows].sort(
    (x, y) => y.fillPct - x.fillPct || y.attendance - x.attendance || y.date.localeCompare(x.date),
  );
  const selloutMatches = matchesRows
    .filter((r) => r.sellout)
    .sort((x, y) => y.date.localeCompare(x.date) || y.fillPct - x.fillPct);

  const seats = matchesRows.reduce((s, r) => s + r.capacity, 0);
  const attendance = matchesRows.reduce((s, r) => s + r.attendance, 0);
  const sellouts = selloutMatches.length;

  const buckets: FillBucket[] = BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    color: b.color,
    count: matchesRows.filter((r) => b.test(r.fillPct)).length,
  }));

  const bestFill = withGames.length
    ? [...withGames].sort((x, y) => (y.fillPct ?? 0) - (x.fillPct ?? 0))[0]
    : null;
  const worstFill = withGames.length
    ? [...withGames].sort((x, y) => (x.fillPct ?? 0) - (y.fillPct ?? 0))[0]
    : null;

  const biggestArena = withCapacity.length
    ? [...withCapacity].sort((x, y) => (y.capacity ?? 0) - (x.capacity ?? 0))[0]
    : null;
  const mostSellouts = withGames.length
    ? [...withGames].sort((x, y) => y.sellouts - x.sellouts || (y.selloutPct ?? 0) - (x.selloutPct ?? 0))[0]
    : null;

  return {
    arenas,
    arenasTotal: arenas.length,
    arenasWithCapacity: withCapacity.length,
    matches,
    selloutMatches,
    matchesTotal: matchesRows.length,
    sellouts,
    selloutPct: matchesRows.length ? round1((sellouts / matchesRows.length) * 100) : null,
    seats,
    attendance,
    freeSeats: Math.max(0, seats - attendance),
    fillPct: seats ? round1((attendance / seats) * 100) : null,
    buckets,
    biggestArena,
    bestFill,
    worstFill,
    mostSellouts,
    hasCapacity: withCapacity.length > 0 && matchesRows.length > 0,
  };
}
