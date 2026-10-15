/**
 * «Интересные серии» и рекорды для карточек игрока и вратаря.
 * Работает поверх уже посчитанной поматчевой статистики (ничего не пересчитывает),
 * матчи должны быть отсортированы по дате.
 */

export type StreakInfo = {
  key: string;
  label: string;
  hint: string;
  best: number;
  bestFrom: string | null;
  bestTo: string | null;
  current: number;
  tone: "good" | "bad" | "neutral";
  /** сумма показателя за лучшую серию, например «7 очков» */
  sumLabel?: string;
};

export type RecordInfo = { key: string; label: string; value: string; sub: string };

type Dated = { date: string; opponent: string };

function longest<T extends Dated>(games: T[], pred: (g: T) => boolean) {
  let best = 0;
  let bestEnd = -1;
  let run = 0;
  for (let i = 0; i < games.length; i++) {
    if (pred(games[i])) {
      run += 1;
      if (run > best) {
        best = run;
        bestEnd = i;
      }
    } else run = 0;
  }
  return { best, bestStart: bestEnd - best + 1, bestEnd, current: run };
}

function makeStreak<T extends Dated>(
  games: T[],
  key: string,
  label: string,
  hint: string,
  pred: (g: T) => boolean,
  tone: StreakInfo["tone"],
  sum?: { get: (g: T) => number; unit: string },
): StreakInfo {
  const r = longest(games, pred);
  let sumLabel: string | undefined;
  if (sum && r.best > 0) {
    const total = games.slice(r.bestStart, r.bestEnd + 1).reduce((a, g) => a + sum.get(g), 0);
    sumLabel = `${total} ${sum.unit}`;
  }
  return {
    key, label, hint, best: r.best, current: r.current, tone, sumLabel,
    bestFrom: r.best > 0 ? games[r.bestStart].date : null,
    bestTo: r.best > 0 ? games[r.bestEnd].date : null,
  };
}

const ddmm = (d: string) => {
  const [, m, day] = d.split("-");
  return `${day}.${m}`;
};

const recordOf = <T extends Dated>(
  games: T[],
  key: string,
  label: string,
  get: (g: T) => number,
  fmt: (v: number) => string = String,
  min = 1,
): RecordInfo | null => {
  let best: T | null = null;
  for (const g of games) if (get(g) >= min && (!best || get(g) > get(best))) best = g;
  if (!best) return null;
  const ties = games.filter((g) => get(g) === get(best as T)).length;
  return {
    key, label, value: fmt(get(best)),
    sub: `${ddmm(best.date)} · ${best.opponent}${ties > 1 ? ` (ещё ${ties - 1} раз)` : ""}`,
  };
};

const fmtToi = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export type SkaterGameLite = Dated & {
  goals: number; assists: number; points: number; plusMinus: number;
  shots: number; shotsOnGoal: number; hits: number; blocks: number; pim: number; toiSeconds: number;
};

export function skaterStreaks(games: SkaterGameLite[]): { streaks: StreakInfo[]; records: RecordInfo[] } {
  const streaks = [
    makeStreak(games, "pts", "Очковая серия", "матчи подряд с очками", (g) => g.points > 0, "good", { get: (g) => g.points, unit: "оч." }),
    makeStreak(games, "goals", "Голевая серия", "матчи подряд с голом", (g) => g.goals > 0, "good", { get: (g) => g.goals, unit: "гол." }),
    makeStreak(games, "ast", "Серия с передачами", "матчи подряд с передачей", (g) => g.assists > 0, "good", { get: (g) => g.assists, unit: "пер." }),
    makeStreak(games, "plus", "В плюсе подряд", "матчи подряд с +/− больше нуля", (g) => g.plusMinus > 0, "good", { get: (g) => g.plusMinus, unit: "по +/−" }),
    makeStreak(games, "nominus", "Без минуса", "матчи подряд с +/− не меньше нуля", (g) => g.plusMinus >= 0, "good"),
    makeStreak(games, "sog3", "3+ броска в створ", "матчи подряд с 3 и более бросками в створ", (g) => g.shotsOnGoal >= 3, "good", { get: (g) => g.shotsOnGoal, unit: "бр." }),
    makeStreak(games, "sog", "С броском в створ", "матчи подряд хотя бы с одним броском в створ", (g) => g.shotsOnGoal > 0, "neutral"),
    makeStreak(games, "hits", "С силовым приёмом", "матчи подряд с силовым приёмом", (g) => g.hits > 0, "neutral", { get: (g) => g.hits, unit: "сил." }),
    makeStreak(games, "blocks", "С блоком", "матчи подряд с заблокированным броском", (g) => g.blocks > 0, "neutral", { get: (g) => g.blocks, unit: "блок." }),
    makeStreak(games, "toi20", "20+ минут на льду", "матчи подряд с временем 20:00 и больше", (g) => g.toiSeconds >= 1200, "neutral"),
    makeStreak(games, "clean", "Без штрафов", "матчи подряд без удалений", (g) => g.pim === 0, "good"),
    makeStreak(games, "pen", "Со штрафом", "матчи подряд с удалением", (g) => g.pim > 0, "bad", { get: (g) => g.pim, unit: "мин" }),
    makeStreak(games, "nopts", "Без очков", "матчи подряд без результативных действий", (g) => g.points === 0, "bad"),
    makeStreak(games, "nogoal", "Без голов", "матчи подряд без заброшенных шайб", (g) => g.goals === 0, "bad"),
  ].filter((s) => s.best >= 2);

  const multi = games.filter((g) => g.points >= 2).length;
  const hat = games.filter((g) => g.goals >= 3).length;
  const withPts = games.filter((g) => g.points > 0).length;
  const records = [
    recordOf(games, "maxPts", "Больше всего очков", (g) => g.points),
    recordOf(games, "maxGoals", "Больше всего голов", (g) => g.goals),
    recordOf(games, "maxAst", "Больше всего передач", (g) => g.assists),
    recordOf(games, "maxSog", "Больше всего бросков в створ", (g) => g.shotsOnGoal),
    recordOf(games, "maxHits", "Больше всего силовых", (g) => g.hits),
    recordOf(games, "maxBlocks", "Больше всего блоков", (g) => g.blocks),
    recordOf(games, "maxPm", "Лучший +/−", (g) => g.plusMinus, (v) => `+${v}`),
    recordOf(games, "maxToi", "Больше всего времени", (g) => g.toiSeconds, fmtToi),
    recordOf(games, "maxPim", "Больше всего штрафа", (g) => g.pim, (v) => `${v} мин`),
    games.length
      ? { key: "multi", label: "Матчи 2+ очка", value: String(multi), sub: `хет-трики: ${hat}` }
      : null,
    games.length
      ? { key: "ptsShare", label: "Матчи с очками", value: `${withPts}/${games.length}`, sub: `${Math.round((withPts / games.length) * 100)}% игр` }
      : null,
  ].filter((r): r is RecordInfo => !!r);
  return { streaks, records };
}

export type GoalieGameLite = Dated & {
  toiSeconds: number; saves: number; goalsAgainst: number; shotsAgainst: number;
  result: "" | "W" | "L"; shutout: boolean; pim: number;
};

export function goalieStreaks(all: GoalieGameLite[]): { streaks: StreakInfo[]; records: RecordInfo[] } {
  const games = all.filter((g) => g.toiSeconds > 0); // только реально сыгранные
  const sv = (g: GoalieGameLite) => (g.shotsAgainst ? g.saves / g.shotsAgainst : 0);
  const streaks = [
    makeStreak(games, "win", "Победная серия", "победы подряд", (g) => g.result === "W", "good"),
    makeStreak(games, "sa30", "30+ бросков подряд", "матчи подряд с 30 и более бросками в створ", (g) => g.shotsAgainst >= 30, "neutral", { get: (g) => g.saves, unit: "сейв." }),
    makeStreak(games, "sv900", "%ОБ 90+ подряд", "матчи подряд с процентом отражённых не ниже 90%", (g) => g.shotsAgainst > 0 && sv(g) >= 0.9, "good", { get: (g) => g.saves, unit: "сейв." }),
    makeStreak(games, "sv930", "%ОБ 93+ подряд", "матчи подряд с процентом отражённых не ниже 93%", (g) => g.shotsAgainst > 0 && sv(g) >= 0.93, "good"),
    makeStreak(games, "ga2", "≤2 пропущенных", "матчи подряд, пропустив не больше двух", (g) => g.goalsAgainst <= 2, "good", { get: (g) => g.goalsAgainst, unit: "проп." }),
    makeStreak(games, "sv25", "25+ сейвов подряд", "матчи подряд с 25 и более отражёнными", (g) => g.saves >= 25, "neutral"),
    makeStreak(games, "so", "Сухие подряд", "матчи «на ноль» подряд", (g) => g.shutout, "good"),
    makeStreak(games, "loss", "Серия поражений", "поражения подряд", (g) => g.result === "L", "bad"),
    makeStreak(games, "ga4", "4+ пропущенных подряд", "матчи подряд, пропустив 4 и больше", (g) => g.goalsAgainst >= 4, "bad"),
    makeStreak(games, "pen", "Со штрафом", "матчи подряд с удалением вратаря", (g) => g.pim > 0, "bad"),
  ].filter((s) => s.best >= 2);

  const big = games.filter((g) => g.shotsAgainst >= 20);
  const records = [
    recordOf(games, "maxSaves", "Больше всего сейвов", (g) => g.saves),
    recordOf(games, "maxSa", "Больше всего бросков", (g) => g.shotsAgainst),
    recordOf(big, "bestSv", "Лучший %ОБ (20+ бросков)", (g) => sv(g) * 100, (v) => `${v.toFixed(1)}%`, 0),
    recordOf(games, "maxGa", "Больше всего пропущено", (g) => g.goalsAgainst),
    recordOf(games, "maxToi", "Самый долгий матч", (g) => g.toiSeconds, fmtToi),
    games.length
      ? { key: "sa30cnt", label: "Матчи с 30+ бросками", value: String(games.filter((g) => g.shotsAgainst >= 30).length), sub: `из ${games.length} сыгранных` }
      : null,
    games.length
      ? { key: "so", label: "Сухие матчи", value: String(games.filter((g) => g.shutout).length), sub: `из ${games.length} сыгранных` }
      : null,
  ].filter((r): r is RecordInfo => !!r);
  return { streaks, records };
}

export { ddmm };
