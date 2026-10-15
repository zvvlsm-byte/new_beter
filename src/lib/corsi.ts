/**
 * Корси (Corsi) — все бросковые попытки. НОВЫЙ модуль: существующие расчёты
 * (compute.ts) не меняются, Корси считается поверх тех же поматчевых строк.
 *
 * Формулы:
 *   CF  = Голы + Броски в створ + Броски мимо + Заблокированные соперником броски
 *   CA  = то же самое для соперника (его попытки, включая броски, заблокированные нами)
 *   Corsi± = CF − CA
 *   CF% = CF / (CF + CA) × 100%
 *
 * Как это раскладывается по колонкам протокола hockey.by:
 *   Бс (броски в створ) уже включает голы (Бс = сейвы вратаря соперника + пропущенные),
 *     поэтому «Голы + Броски в створ» = Г + (Бс − Г) = Бс;
 *   Броски мимо = Б − Бс (Б — все броски игрока);
 *   Заблокированные соперником = сумма БлБ игроков соперника.
 *   Итого: CF = Б(своя команда) + БлБ(соперник). Вклад вратарей учитывается так же,
 *   как в турнирной таблице (у вратаря тоже бывают Б / Бс / БлБ).
 */

export type CorsiSideInput = {
  shots: number; // Σ Б
  shotsOnGoal: number; // Σ Бс (включая голы)
  goals: number; // Σ голов игроков
  blocks: number; // Σ БлБ (блоки этой команды)
};

export type CorsiBreakdown = {
  goals: number;
  sogExGoals: number; // броски в створ без голов (отражённые)
  missed: number; // мимо
  blockedByOpp: number; // заблокированы соперником
  cf: number;
  ca: number;
  diff: number;
  pct: number | null;
};

export function corsiFromSides(own: CorsiSideInput, opp: CorsiSideInput): CorsiBreakdown {
  const goals = own.goals;
  const sogExGoals = Math.max(0, own.shotsOnGoal - own.goals);
  const missed = Math.max(0, own.shots - own.shotsOnGoal);
  const blockedByOpp = opp.blocks;
  const cf = goals + sogExGoals + missed + blockedByOpp;
  const oGoals = opp.goals;
  const oSog = Math.max(0, opp.shotsOnGoal - opp.goals);
  const oMissed = Math.max(0, opp.shots - opp.shotsOnGoal);
  const ca = oGoals + oSog + oMissed + own.blocks;
  return {
    goals, sogExGoals, missed, blockedByOpp, cf, ca,
    diff: cf - ca,
    pct: cf + ca > 0 ? (cf / (cf + ca)) * 100 : null,
  };
}

type StatLike = { shots: number; shotsOnGoal: number; goals: number; blocks: number };

export function sumSide(rows: StatLike[]): CorsiSideInput {
  return rows.reduce<CorsiSideInput>(
    (a, r) => ({
      shots: a.shots + (r.shots || 0),
      shotsOnGoal: a.shotsOnGoal + (r.shotsOnGoal || 0),
      goals: a.goals + (r.goals || 0),
      blocks: a.blocks + (r.blocks || 0),
    }),
    { shots: 0, shotsOnGoal: 0, goals: 0, blocks: 0 },
  );
}

type Row = StatLike & { matchId: number; side: "home" | "away" };
type MatchLite = { id: number; homeTeam: string; awayTeam: string };

/** Корси одного матча для обеих команд. */
export function matchCorsi(
  matchId: number,
  skaters: Row[],
  goalies: Row[],
): { home: CorsiBreakdown; away: CorsiBreakdown } {
  const side = (s: "home" | "away") =>
    sumSide([
      ...skaters.filter((k) => k.matchId === matchId && k.side === s),
      ...goalies.filter((g) => g.matchId === matchId && g.side === s),
    ]);
  const h = side("home");
  const a = side("away");
  return { home: corsiFromSides(h, a), away: corsiFromSides(a, h) };
}

export type TeamCorsi = { cf: number; ca: number; diff: number; pct: number | null; games: number };

/** Корси команд за все матчи (сумма CF и CA по матчам, CF% — от сумм). */
export function computeTeamCorsi(matches: MatchLite[], skaters: Row[], goalies: Row[]): Map<string, TeamCorsi> {
  const out = new Map<string, TeamCorsi>();
  const sk = new Map<number, Row[]>();
  const gk = new Map<number, Row[]>();
  for (const s of skaters) (sk.get(s.matchId) ?? sk.set(s.matchId, []).get(s.matchId)!).push(s);
  for (const g of goalies) (gk.get(g.matchId) ?? gk.set(g.matchId, []).get(g.matchId)!).push(g);
  const get = (t: string) => {
    const k = t.trim();
    let r = out.get(k);
    if (!r) {
      r = { cf: 0, ca: 0, diff: 0, pct: null, games: 0 };
      out.set(k, r);
    }
    return r;
  };
  for (const m of matches) {
    const c = matchCorsi(m.id, sk.get(m.id) ?? [], gk.get(m.id) ?? []);
    for (const [team, b] of [[m.homeTeam, c.home], [m.awayTeam, c.away]] as const) {
      const r = get(team);
      r.cf += b.cf;
      r.ca += b.ca;
      r.games += 1;
    }
  }
  for (const r of out.values()) {
    r.diff = r.cf - r.ca;
    r.pct = r.cf + r.ca > 0 ? (r.cf / (r.cf + r.ca)) * 100 : null;
  }
  return out;
}
