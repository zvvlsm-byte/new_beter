/**
 * Анализ предстоящего матча: серии игроков, статистика против соперника
 * (архив старых протоколов + текущий сезон), личные встречи и форма команд.
 * Новый модуль: использует существующие расчёты только для чтения.
 */
import { db } from "@/db";
import { goalieGames, goals, histGames, matches, penalties, skaterGames } from "@/db/schema";
import { computeStandings } from "./compute";
import { computeTeamCorsi } from "./corsi";
import { sameTeam, seasonOf, type UpcomingGame } from "./history";
import { loadGoalieLogs, loadSkaterLogs, type GoalieLog, type SkaterLog } from "./historyDb";
import { nameKey, seasonLabel } from "./seasonStats";
import { orderFacts, swapNames } from "./factsLayout";

export type Fact = {
  tone: "good" | "bad" | "neutral"; tag: string; text: string; score: number;
  /** Чья это заметка: хозяева / гости; null — общее по матчу (новое, только для раскладки). */
  side?: "home" | "away" | null;
  /** Игроки, упомянутые в тексте (для показа «Имя Фамилия»). */
  who?: string[];
};

export type PreviewPlayer = {
  side: "home" | "away";
  name: string;
  jersey: number | null;
  position: string;
  season: { gp: number; g: number; a: number; p: number };
  streak: { kind: "points" | "goals" | "drought"; len: number; g: number; a: number } | null;
  vsOpp: { gp: number; g: number; a: number; p: number; pim: number; seasons: number; lastDate: string | null; lastLine: string | null };
  archiveGp: number;
};

export type PreviewGoalie = {
  side: "home" | "away";
  name: string;
  jersey: number | null;
  season: { gp: number; svPct: number | null; gaa: number | null; w: number };
  vsOpp: { gp: number; w: number; l: number; svPct: number | null; gaa: number | null; shutouts: number };
};

export type PreviewTeam = {
  side: "home" | "away";
  name: string;
  dbName: string | null;
  standing: {
    place: number; gp: number; pts: number; gf: number; ga: number;
    ppPct: number | null; pkPct: number | null; corsiPct: number | null;
  } | null;
  last5: { date: string; opp: string; score: string; won: boolean; home: boolean }[];
};

export type Meeting = {
  date: string; season: string; home: string; away: string; score: string; source: "archive" | "current";
  /** id матча в архиве (hist_games) — для карточки матча; id текущего матча — для ссылки. */
  histId?: number; matchId?: number;
};

export type PreviewResult = {
  game: Omit<UpcomingGame, "roster"> & { rosterCount: { home: number; away: number } };
  season: string;
  teams: PreviewTeam[];
  h2h: { total: number; winsHome: number; winsAway: number; goalsHome: number; goalsAway: number; meetings: Meeting[] };
  facts: Fact[];
  players: PreviewPlayer[];
  goalies: PreviewGoalie[];
  archive: { games: number; seasons: string[] };
};

const word = (n: number, one: string, few: string, many: string) => {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
};
const matchesW = (n: number) => `${n} ${word(n, "матч", "матча", "матчей")}`;
const goalsW = (n: number) => `${n} ${word(n, "шайбу", "шайбы", "шайб")}`;
const pointsW = (n: number) => `${n} ${word(n, "очко", "очка", "очков")}`;
const ddmmyy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`;

function tailCount<T>(arr: T[], pred: (x: T) => boolean): T[] {
  const out: T[] = [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) out.unshift(arr[i]);
    else break;
  }
  return out;
}

export async function buildPreview(game: UpcomingGame): Promise<PreviewResult> {
  const curSeason = seasonOf(game.date ?? new Date().toISOString().slice(0, 10));
  const [allMatches, allGoals, allPens, allSk, allGk, allHist] = await Promise.all([
    db.select().from(matches),
    db.select().from(goals),
    db.select().from(penalties),
    db.select().from(skaterGames),
    db.select().from(goalieGames),
    db.select().from(histGames),
  ]);
  const sides = ["home", "away"] as const;
  const teamName = (s: "home" | "away") => (s === "home" ? game.homeTeam : game.awayTeam);
  const oppName = (s: "home" | "away") => (s === "home" ? game.awayTeam : game.homeTeam);

  // ---- команды: место, очки, спецбригады, Корси, форма ----
  const dbTeams = [...new Set(allMatches.flatMap((m) => [m.homeTeam, m.awayTeam]))];
  const standings = computeStandings(allMatches, allGoals, allPens, allSk, allGk);
  const corsi = computeTeamCorsi(allMatches, allSk, allGk);
  const teams: PreviewTeam[] = sides.map((side) => {
    const dbName = dbTeams.find((t) => sameTeam(t, teamName(side))) ?? null;
    const idx = dbName ? standings.findIndex((r) => r.team === dbName) : -1;
    const r = idx >= 0 ? standings[idx] : null;
    const games = dbName
      ? allMatches
          .filter((m) => m.homeTeam === dbName || m.awayTeam === dbName)
          .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
      : [];
    const last5 = games.slice(-5).map((m) => {
      const home = m.homeTeam === dbName;
      const gf = home ? m.homeScore : m.awayScore;
      const ga = home ? m.awayScore : m.homeScore;
      return { date: m.date, opp: home ? m.awayTeam : m.homeTeam, score: `${gf}:${ga}${m.winType === "ot" ? " ОТ" : m.winType === "so" ? " Б" : ""}`, won: gf > ga, home };
    });
    return {
      side,
      name: teamName(side),
      dbName,
      standing: r
        ? { place: idx + 1, gp: r.gp, pts: r.pts, gf: r.gf, ga: r.ga, ppPct: r.ppPct, pkPct: r.pkPct, corsiPct: corsi.get(r.team)?.pct ?? null }
        : null,
      last5,
    };
  });

  // ---- личные встречи: архив + текущий сезон (без дублей) ----
  const meetings: Meeting[] = [];
  for (const m of allMatches) {
    const a = sameTeam(m.homeTeam, game.homeTeam) && sameTeam(m.awayTeam, game.awayTeam);
    const b = sameTeam(m.homeTeam, game.awayTeam) && sameTeam(m.awayTeam, game.homeTeam);
    if (a || b) meetings.push({ date: m.date, season: seasonOf(m.date), home: m.homeTeam, away: m.awayTeam, score: `${m.homeScore}:${m.awayScore}`, source: "current", matchId: m.id });
  }
  for (const h of allHist) {
    const a = sameTeam(h.homeTeam, game.homeTeam) && sameTeam(h.awayTeam, game.awayTeam);
    const b = sameTeam(h.homeTeam, game.awayTeam) && sameTeam(h.awayTeam, game.homeTeam);
    if (!a && !b) continue;
    if (meetings.some((x) => x.date === h.date && x.source === "current")) continue;
    meetings.push({ date: h.date, season: h.season, home: h.homeTeam, away: h.awayTeam, score: `${h.homeScore}:${h.awayScore}`, source: "archive", histId: h.id });
  }
  meetings.sort((a, b) => b.date.localeCompare(a.date));
  let winsHome = 0, winsAway = 0, goalsHome = 0, goalsAway = 0;
  for (const m of meetings) {
    const [x, y] = m.score.split(":").map((v) => parseInt(v, 10));
    const ourHomeIsHome = sameTeam(m.home, game.homeTeam);
    const gH = ourHomeIsHome ? x : y;
    const gA = ourHomeIsHome ? y : x;
    goalsHome += gH;
    goalsAway += gA;
    if (gH > gA) winsHome += 1;
    else if (gA > gH) winsAway += 1;
  }

  // ---- игроки ----
  const facts: Fact[] = [];
  const skRoster = sides.flatMap((side) => game.roster[side].filter((p) => p.position !== "В").map((p) => ({ ...p, side })));
  const gkRoster = sides.flatMap((side) => game.roster[side].filter((p) => p.position === "В").map((p) => ({ ...p, side })));
  const [skLogs, gkLogs] = await Promise.all([
    loadSkaterLogs([...new Set(skRoster.map((p) => p.key))]),
    loadGoalieLogs([...new Set(gkRoster.map((p) => p.key))]),
  ]);

  // привязка новых фактов к стороне и игроку (для раскладки: хозяева / гости / общее)
  const tagFrom = (from: number, side: "home" | "away", who?: string) => {
    for (let i = from; i < facts.length; i++) {
      if (facts[i].side === undefined) facts[i].side = side;
      if (who && !facts[i].who) facts[i].who = [who];
    }
  };
  // удаления игроков (идут в минус): отдельный список, чтобы не менять отбор прежних фактов
  const penFacts: Fact[] = [];
  const matchById = new Map(allMatches.map((m) => [m.id, m]));
  const pensByKey = new Map<string, typeof allPens>();
  for (const pen of allPens) {
    if (!pen.player) continue;
    const k = nameKey(pen.player);
    (pensByKey.get(k) ?? pensByKey.set(k, []).get(k)!).push(pen);
  }

  const players: PreviewPlayer[] = [];
  for (const p of skRoster) {
    const f0 = facts.length;
    const logs: SkaterLog[] = (skLogs.get(p.key) ?? []).filter((l) => l.played);
    const opp = oppName(p.side);
    const season = logs.filter((l) => l.season === curSeason);
    const sg = season.reduce((a, l) => a + l.goals, 0);
    const sa = season.reduce((a, l) => a + l.assists, 0);
    const vs = logs.filter((l) => sameTeam(l.opponent, opp));
    const vg = vs.reduce((a, l) => a + l.goals, 0);
    const va = vs.reduce((a, l) => a + l.assists, 0);
    const vpim = vs.reduce((a, l) => a + l.pim, 0);
    const last = vs[vs.length - 1];
    let streak: PreviewPlayer["streak"] = null;
    const ptsRun = tailCount(season, (l) => l.points > 0);
    const goalRun = tailCount(season, (l) => l.goals > 0);
    const dryRun = tailCount(season, (l) => l.points === 0);
    if (goalRun.length >= 2 && goalRun.length >= ptsRun.length - 1) {
      streak = { kind: "goals", len: goalRun.length, g: goalRun.reduce((a, l) => a + l.goals, 0), a: goalRun.reduce((a, l) => a + l.assists, 0) };
    } else if (ptsRun.length >= 3) {
      streak = { kind: "points", len: ptsRun.length, g: ptsRun.reduce((a, l) => a + l.goals, 0), a: ptsRun.reduce((a, l) => a + l.assists, 0) };
    } else if (dryRun.length >= 3 && season.length >= 6 && (sg + sa) / season.length >= 0.5) {
      streak = { kind: "drought", len: dryRun.length, g: 0, a: 0 };
    }
    const row: PreviewPlayer = {
      side: p.side, name: p.name, jersey: p.jersey, position: p.position,
      season: { gp: season.length, g: sg, a: sa, p: sg + sa },
      streak,
      vsOpp: {
        gp: vs.length, g: vg, a: va, p: vg + va, pim: vpim,
        seasons: new Set(vs.map((l) => l.season)).size,
        lastDate: last?.date ?? null,
        lastLine: last ? `${ddmmyy(last.date)}: ${last.goals}+${last.assists} (${last.score})` : null,
      },
      archiveGp: logs.length,
    };
    players.push(row);
    const team = teamName(p.side);

    // факты: серии текущего сезона
    if (streak?.kind === "points") {
      facts.push({ tone: "good", tag: "Серия", score: 50 + streak.len * 6, text: `${p.name} (${team}) набирает очки ${streak.len} ${word(streak.len, "матч", "матча", "матчей")} подряд — ${streak.g}+${streak.a}.` });
    } else if (streak?.kind === "goals") {
      facts.push({ tone: "good", tag: "Серия", score: 55 + streak.len * 8, text: `${p.name} (${team}) забивает ${streak.len} ${word(streak.len, "матч", "матча", "матчей")} подряд — ${goalsW(streak.g)} за серию.` });
    } else if (streak?.kind === "drought") {
      facts.push({ tone: "bad", tag: "Спад", score: 30 + streak.len * 4, text: `${p.name} (${team}) без очков ${streak.len} ${word(streak.len, "матч", "матча", "матчей")} подряд, хотя в сезоне в среднем набирает ${((sg + sa) / season.length).toFixed(2)} очка за игру.` });
    }
    // факты: против соперника
    if (vs.length >= 2 && vg + va >= 3) {
      const ppg = (vg + va) / vs.length;
      facts.push({
        tone: "good", tag: "Против соперника", score: 40 + (vg + va) * 3 + ppg * 10,
        text: `${p.name} (${team}) в ${vs.length} ${word(vs.length, "матче", "матчах", "матчах")} против «${opp}» набрал ${pointsW(vg + va)} (${vg}+${va})${row.vsOpp.seasons > 1 ? ` за ${row.vsOpp.seasons} ${word(row.vsOpp.seasons, "сезон", "сезона", "сезонов")}` : ""}.`,
      });
    } else if (vg >= 2) {
      facts.push({ tone: "good", tag: "Против соперника", score: 35 + vg * 5, text: `${p.name} (${team}) забросил «${opp}» ${goalsW(vg)} в ${matchesW(vs.length)}.` });
    }
    const vsRun = tailCount(vs, (l) => l.points > 0);
    if (vsRun.length >= 3) {
      facts.push({ tone: "good", tag: "Против соперника", score: 60 + vsRun.length * 5, text: `${p.name} набирал очки в ${vsRun.length} последних встречах с «${opp}» подряд.` });
    }
    if (vs.length >= 5 && vg + va === 0) {
      facts.push({ tone: "bad", tag: "Против соперника", score: 25 + vs.length, text: `${p.name} (${team}) ни разу не набирал очков против «${opp}» — ${matchesW(vs.length)} без результативных действий.` });
    }
    if (last && last.goals >= 2) {
      facts.push({ tone: "neutral", tag: "Прошлая встреча", score: 45, text: `В прошлой встрече с «${opp}» (${ddmmyy(last.date)}) ${p.name} оформил ${last.goals >= 3 ? "хет-трик" : "дубль"}.` });
    }
    tagFrom(f0, p.side, p.name);

    // ---- новое: удаления конкретного игрока (в минус) ----
    const spim = season.reduce((a, l) => a + l.pim, 0);
    const myPens = (pensByKey.get(p.key) ?? []).filter((pen) => {
      const m = matchById.get(pen.matchId);
      return !!m && seasonOf(m.date) === curSeason && sameTeam(pen.side === "home" ? m.homeTeam : m.awayTeam, team);
    });
    const penMin = myPens.reduce((a, x) => a + x.minutes, 0);
    const minutes = Math.max(spim, penMin);
    if (season.length >= 3 && (minutes >= 10 || minutes / season.length >= 1.5 || myPens.length >= 4)) {
      const byInf = new Map<string, number>();
      for (const x of myPens) if (x.infraction) byInf.set(x.infraction, (byInf.get(x.infraction) ?? 0) + 1);
      const top = [...byInf.entries()].sort((a, b) => b[1] - a[1])[0];
      penFacts.push({
        tone: "bad", tag: "Удаления", score: 20 + minutes, side: p.side, who: [p.name],
        text: `${p.name} (${team}) в сезоне${myPens.length ? ` — ${myPens.length} ${word(myPens.length, "удаление", "удаления", "удалений")},` : ""} ${minutes} штрафных ${word(minutes, "минута", "минуты", "минут")} за ${matchesW(season.length)} (${(minutes / season.length).toFixed(1)} мин за игру)${top && top[1] >= 2 ? `; чаще всего — «${top[0]}» (${top[1]})` : ""}.`,
      });
    }
    if (vs.length && (vpim >= 6 || (vpim >= 4 && vs.length <= 3))) {
      penFacts.push({
        tone: "bad", tag: "Удаления", score: 15 + vpim, side: p.side, who: [p.name],
        text: `${p.name} (${team}) против «${opp}» — ${vpim} штрафных ${word(vpim, "минута", "минуты", "минут")} в ${vs.length} ${word(vs.length, "матче", "матчах", "матчах")}.`,
      });
    }
    if (last && last.pim >= 4) {
      penFacts.push({
        tone: "bad", tag: "Удаления", score: 12 + last.pim, side: p.side, who: [p.name],
        text: `В прошлой встрече с «${opp}» (${ddmmyy(last.date)}) ${p.name} получил ${last.pim} ${word(last.pim, "минуту", "минуты", "минут")} штрафа.`,
      });
    }
  }
  players.sort((a, b) => b.season.p - a.season.p || b.vsOpp.p - a.vsOpp.p || a.name.localeCompare(b.name, "ru"));

  // ---- вратари ----
  const goaliesOut: PreviewGoalie[] = [];
  for (const p of gkRoster) {
    const gf0 = facts.length;
    const logs: GoalieLog[] = gkLogs.get(p.key) ?? [];
    const opp = oppName(p.side);
    const sum = (ls: GoalieLog[]) => {
      const sv = ls.filter((l) => l.saves !== null);
      const saves = sv.reduce((a, l) => a + (l.saves ?? 0), 0);
      const svGa = sv.reduce((a, l) => a + l.goalsAgainst, 0);
      const toi = ls.reduce((a, l) => a + l.toiSeconds, 0);
      const ga = ls.reduce((a, l) => a + l.goalsAgainst, 0);
      return {
        gp: ls.length,
        w: ls.filter((l) => l.won).length,
        l: ls.filter((l) => !l.won).length,
        svPct: saves + svGa > 0 ? (saves / (saves + svGa)) * 100 : null,
        gaa: toi > 0 ? (ga / toi) * 3600 : null,
        shutouts: ls.filter((l) => l.goalsAgainst === 0 && l.toiSeconds >= 3000).length,
      };
    };
    const s = sum(logs.filter((l) => l.season === curSeason));
    const v = sum(logs.filter((l) => sameTeam(l.opponent, opp)));
    if (!s.gp && !v.gp) continue;
    goaliesOut.push({
      side: p.side, name: p.name, jersey: p.jersey,
      season: { gp: s.gp, svPct: s.svPct, gaa: s.gaa, w: s.w },
      vsOpp: { gp: v.gp, w: v.w, l: v.l, svPct: v.svPct, gaa: v.gaa, shutouts: v.shutouts },
    });
    if (v.gp >= 2) {
      const good = v.w > v.l;
      facts.push({
        tone: good ? "good" : v.w < v.l ? "bad" : "neutral", tag: "Вратарь", score: 35 + v.gp * 2 + (v.shutouts ? 15 : 0),
        text: `${p.name} (${teamName(p.side)}) против «${opp}»: ${v.w}–${v.l} в ${matchesW(v.gp)}${v.svPct !== null ? `, %ОБ ${v.svPct.toFixed(1)}` : ""}${v.gaa !== null ? `, КН ${v.gaa.toFixed(2)}` : ""}${v.shutouts ? `, ${v.shutouts} ${word(v.shutouts, "сухарь", "сухаря", "сухарей")}` : ""}.`,
      });
    }
    const seasonLogs = logs.filter((l) => l.season === curSeason);
    const winRun = tailCount(seasonLogs, (l) => l.won);
    if (winRun.length >= 3) facts.push({ tone: "good", tag: "Вратарь", score: 50 + winRun.length * 5, text: `${p.name} выиграл ${winRun.length} последних ${word(winRun.length, "матч", "матча", "матчей")} подряд.` });
    tagFrom(gf0, p.side, p.name);
  }

  // ---- командные факты ----
  if (meetings.length) {
    const seasons = new Set(meetings.map((m) => m.season));
    facts.push({
      tone: "neutral", tag: "Личные встречи", score: 70,
      text: `Команды встречались ${meetings.length} ${word(meetings.length, "раз", "раза", "раз")}${seasons.size > 1 ? ` (сезонов в базе: ${seasons.size})` : ""}: «${game.homeTeam}» выиграл ${winsHome}, «${game.awayTeam}» — ${winsAway}; шайбы ${goalsHome}:${goalsAway}.`,
    });
    const lm = meetings[0];
    facts.push({ tone: "neutral", tag: "Личные встречи", score: 65, text: `Последняя встреча — ${ddmmyy(lm.date)} (${seasonLabel(lm.season)}): ${lm.home} ${lm.score} ${lm.away}.` });
    // серия побед в личных встречах
    const winnerOf = (m: Meeting) => {
      const [x, y] = m.score.split(":").map((v) => parseInt(v, 10));
      return x === y ? null : x > y ? m.home : m.away;
    };
    const first = winnerOf(meetings[0]);
    if (first) {
      let n = 0;
      for (const m of meetings) {
        const w = winnerOf(m);
        if (w && sameTeam(w, first)) n++;
        else break;
      }
      if (n >= 3) facts.push({ tone: "neutral", tag: "Личные встречи", score: 75 + n, text: `«${first}» выиграл ${n} последних ${word(n, "встречу", "встречи", "встреч")} подряд.` });
    }
  }
  // личные встречи — общее по матчу
  for (const f of facts) if (f.side === undefined) f.side = null;
  for (const t of teams) {
    if (!t.last5.length) continue;
    const tf0 = facts.length;
    const run = tailCount(t.last5, (g) => g.won);
    const lrun = tailCount(t.last5, (g) => !g.won);
    if (run.length >= 3) facts.push({ tone: "good", tag: "Форма", score: 55 + run.length * 4, text: `«${t.name}» выиграл ${run.length} последних ${word(run.length, "матч", "матча", "матчей")} подряд.` });
    if (lrun.length >= 3) facts.push({ tone: "bad", tag: "Форма", score: 50 + lrun.length * 4, text: `«${t.name}» проиграл ${lrun.length} последних ${word(lrun.length, "матч", "матча", "матчей")} подряд.` });
    tagFrom(tf0, t.side);
  }

  // юбилеи и существенные карьерные цифры (архив сезонов + текущие протоколы)
  const jubileeMarks: { from: number; side: "home" | "away"; who: string }[] = [];
  try {
    const { loadSeasonsPayload } = await import("./seasonsDb");
    const { aggregateSkaters, aggregateGoalies } = await import("./seasonStats");
    const seasons = await loadSeasonsPayload();
    const impById = new Map(seasons.imports.map((i) => [i.id, i]));
    const nextMs = (n: number, steps: number[]) => steps.find((x) => x > n) ?? null;
    const isMs = (n: number, steps: number[]) => steps.includes(n);

    const skStepsGp = [100, 200, 300, 400, 500, 600, 700, 800, 1000];
    const skStepsG = [50, 100, 150, 200, 250, 300, 400, 500];
    const skStepsP = [100, 150, 200, 250, 300, 400, 500, 600, 800, 1000];
    const gkStepsGp = [100, 200, 300, 400, 500];
    const gkStepsW = [50, 100, 150, 200, 250, 300];
    const gkStepsSo = [10, 20, 25, 50, 75, 100];

    for (const p of skRoster) {
      const rows = seasons.skaters.filter((r) => r.nameKey === p.key && impById.has(r.importId));
      if (!rows.length) continue;
      jubileeMarks.push({ from: facts.length, side: p.side, who: p.name });
      const tot = aggregateSkaters(rows.map((r) => r.stats));
      const gp = tot.gp ?? 0;
      const g = tot.goals ?? 0;
      const pts = tot.points ?? 0;
      const team = teamName(p.side);
      const nxtG = nextMs(g, skStepsG);
      const nxtP = nextMs(pts, skStepsP);
      const nxtGp = nextMs(gp, skStepsGp);
      if (nxtGp && nxtGp - gp === 1) {
        facts.push({ tone: "neutral", tag: "Юбилей", score: 80, text: `${p.name} (${team}) проведёт ${nxtGp}-й матч в чемпионатах (все сезоны).` });
      } else if (isMs(gp, skStepsGp)) {
        facts.push({ tone: "neutral", tag: "Юбилей", score: 55, text: `${p.name} (${team}) уже сыграл ${gp} матчей в чемпионатах.` });
      }
      if (nxtG && nxtG - g <= 2 && nxtG - g >= 1) {
        facts.push({ tone: "good", tag: "Юбилей", score: 78, text: `${p.name} (${team}) до юбилейной ${nxtG}-й шайбы в карьере — ${nxtG - g} ${nxtG - g === 1 ? "гол" : "гола"}.` });
      } else if (isMs(g, skStepsG)) {
        facts.push({ tone: "good", tag: "Юбилей", score: 60, text: `${p.name} (${team}) набрал ${g} шайб за все сезоны.` });
      }
      if (nxtP && nxtP - pts <= 2 && nxtP - pts >= 1) {
        facts.push({ tone: "good", tag: "Юбилей", score: 76, text: `${p.name} (${team}) до ${nxtP} очков за карьеру осталось ${nxtP - pts}.` });
      } else if (isMs(pts, skStepsP)) {
        facts.push({ tone: "good", tag: "Юбилей", score: 58, text: `${p.name} (${team}) — ${pts} очков за все сезоны.` });
      }
    }
    for (const p of gkRoster) {
      const rows = seasons.goalies.filter((r) => r.nameKey === p.key && impById.has(r.importId));
      if (!rows.length) continue;
      jubileeMarks.push({ from: facts.length, side: p.side, who: p.name });
      const tot = aggregateGoalies(rows.map((r) => r.stats));
      const gp = tot.gp ?? 0;
      const w = tot.wins ?? 0;
      const so = tot.shutouts ?? 0;
      const team = teamName(p.side);
      const nxtGp = nextMs(gp, gkStepsGp);
      const nxtW = nextMs(w, gkStepsW);
      const nxtSo = nextMs(so, gkStepsSo);
      if (nxtGp && nxtGp - gp === 1) {
        facts.push({ tone: "neutral", tag: "Юбилей", score: 80, text: `${p.name} (${team}) проведёт ${nxtGp}-й матч в воротах за карьеру.` });
      }
      if (nxtW && nxtW - w === 1) {
        facts.push({ tone: "good", tag: "Юбилей", score: 77, text: `${p.name} (${team}) в одном выигрыше от ${nxtW}-й победы за карьеру.` });
      } else if (isMs(w, gkStepsW)) {
        facts.push({ tone: "good", tag: "Юбилей", score: 56, text: `${p.name} (${team}) — ${w} побед за все сезоны.` });
      }
      if (nxtSo && nxtSo - so === 1) {
        facts.push({ tone: "good", tag: "Юбилей", score: 74, text: `${p.name} (${team}) в одном сухом матче от юбилея: ${nxtSo} «на ноль» за карьеру.` });
      }
    }
  } catch (e) {
    console.error("[preview] юбилеи:", e);
  }
  // сторона и игрок для юбилейных фактов: диапазоны между отметками
  jubileeMarks.forEach((mk, i) => {
    const end = i + 1 < jubileeMarks.length ? jubileeMarks[i + 1].from : facts.length;
    for (let j = mk.from; j < end; j++) {
      if (facts[j].side === undefined || facts[j].side === null) facts[j].side = mk.side;
      if (!facts[j].who) facts[j].who = [mk.who];
    }
  });

  facts.sort((a, b) => b.score - a.score);
  // на всякий случай: факты про корси в анализ не попадают
  const factsNoCorsi = facts.filter((f) => !/корси|corsi|cf%/i.test(`${f.tag} ${f.text}`));
  // новое: прежний отбор (топ-40) не меняется; удаления игроков добавляются отдельно (в минус),
  // имена — «Имя Фамилия», порядок — положительные вверху, отрицательные внизу
  const shownFacts = orderFacts([
    ...factsNoCorsi.slice(0, 40),
    ...penFacts.sort((a, b) => b.score - a.score).slice(0, 12),
  ]).map((f) => ({ ...f, side: f.side ?? null, text: swapNames(f.text, f.who) }));

  const archSeasons = [...new Set(allHist.map((h) => h.season))].sort();
  const { roster, ...gameInfo } = game;
  return {
    game: { ...gameInfo, rosterCount: { home: roster.home.length, away: roster.away.length } },
    season: curSeason,
    teams,
    h2h: { total: meetings.length, winsHome, winsAway, goalsHome, goalsAway, meetings: meetings.slice(0, 15) },
    facts: shownFacts,
    players,
    goalies: goaliesOut,
    archive: { games: allHist.length, seasons: archSeasons },
  };
}
