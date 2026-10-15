import type { Goal, GoalieGame, Match, Penalty, Side, SkaterGame } from "@/db/schema";
import { parseMMSS, periodFromTime } from "./clean";

export type StandingsRow = {
  team: string;
  gp: number;
  w: number; wot: number; wso: number;
  l: number; lot: number; lso: number;
  pts: number; ptsPct: number | null;
  gf: number; ga: number;
  blankGames: number; // Ибз: игры без заброшенных шайб
  cleanSheets: number; // И0: игры «на ноль» (соперник не забил)
  gfHome: number; gfAway: number; // голы дома / в гостях
  sog: number; sogHome: number; sogAway: number; // броски в створ: всего / дома / в гостях
  pimAll: number; oppPimAll: number; // ВСЕ штрафные минуты (включая обоюдные) — для колонок Штр./ШтрС
  pim: number; oppPim: number; // без обоюдных — для времени большинства/меньшинства (ВПБ/ВПМ)
  coinCount: number; coinMinutes: number; // свои обоюдные удаления: не дают большинства никому
  ppGoals: number; shGoals: number;
  gaShorthanded: number; // пропущенные в меньшинстве (соперник забил в большинстве)
  gaPowerplay: number; // пропущенные в большинстве (соперник забил в меньшинстве)
  ppOpp: number; pkOwn: number;
  ppPct: number | null; pkPct: number | null;
  // официальный метод ИИХФ (Official Stats): попытка = численное преимущество
  // хотя бы в одного игрока длительностью от 1 секунды
  offPpAttempts: number; offPkAttempts: number;
  offPpPct: number | null; offPkPct: number | null;
  hits: number; blocks: number; shots: number;
  hitsAgainst: number; // силовые приёмы соперников против этой команды
  blocksAgainst: number; // блокированные броски соперников против этой команды
  shotPct: number | null;
  enGoals: number;
};

export function computeStandings(
  matches: Match[],
  goals: Goal[],
  penalties: Penalty[],
  skaters: SkaterGame[],
  goalies: GoalieGame[],
): StandingsRow[] {
  const map = new Map<string, StandingsRow>();
  const row = (team: string): StandingsRow => {
    const key = team.trim();
    let r = map.get(key);
    if (!r) {
      r = {
        team: key, gp: 0, w: 0, wot: 0, wso: 0, l: 0, lot: 0, lso: 0, pts: 0, ptsPct: null,
        gf: 0, ga: 0, blankGames: 0, cleanSheets: 0,
        gfHome: 0, gfAway: 0, sog: 0, sogHome: 0, sogAway: 0,
        pimAll: 0, oppPimAll: 0,
        pim: 0, oppPim: 0, coinCount: 0, coinMinutes: 0,
        ppGoals: 0, shGoals: 0, gaShorthanded: 0, gaPowerplay: 0,
        ppOpp: 0, pkOwn: 0, ppPct: null, pkPct: null,
        offPpAttempts: 0, offPkAttempts: 0, offPpPct: null, offPkPct: null,
        hits: 0, blocks: 0, shots: 0,
        hitsAgainst: 0, blocksAgainst: 0, shotPct: null, enGoals: 0,
      };
      map.set(key, r);
    }
    return r;
  };

  for (const m of matches) {
    const sides: { side: Side; team: string; gf: number; ga: number; opp: string }[] = [
      { side: "home", team: m.homeTeam, gf: m.homeScore, ga: m.awayScore, opp: m.awayTeam },
      { side: "away", team: m.awayTeam, gf: m.awayScore, ga: m.homeScore, opp: m.homeTeam },
    ];
    const winnerSide: Side = m.homeScore > m.awayScore ? "home" : "away";
    // попытки большинства/меньшинства по методу ИИХФ (один расчёт на матч)
    const adv = iihfPowerPlayAdvances(
      penalties.filter((p) => p.matchId === m.id),
      goals.filter((g) => g.matchId === m.id),
    );
    for (const s of sides) {
      const r = row(s.team);
      row(s.opp); // команда соперника тоже появляется в таблице
      r.gp += 1;
      r.gf += s.gf;
      r.ga += s.ga;
      // Система очков: любая победа = 2 очка, поражение в ОТ/по буллитам = 1, в основное время = 0
      const won = s.side === winnerSide;
      if (won) {
        if (m.winType === "reg") { r.w += 1; r.pts += 2; }
        else if (m.winType === "ot") { r.wot += 1; r.pts += 2; }
        else { r.wso += 1; r.pts += 2; }
      } else {
        if (m.winType === "reg") { r.l += 1; }
        else if (m.winType === "ot") { r.lot += 1; r.pts += 1; }
        else { r.lso += 1; r.pts += 1; }
      }
      // Штр./ШтрС считают ВСЕ минуты (включая обоюдные).
      // Обоюдные удаления не создают численного преимущества, поэтому из попыток
      // большинства/меньшинства (%Б/%М) и из ВПБ/ВПМ они исключаются;
      // штрафные броски (0 минут) тоже не дают большинства/меньшинства.
      const myPens = penalties.filter((p) => p.matchId === m.id && p.side === s.side);
      const oppPens = penalties.filter((p) => p.matchId === m.id && p.side !== s.side);
      const myGoals = goals.filter((g) => g.matchId === m.id && g.side === s.side);
      const oppGoals = goals.filter((g) => g.matchId === m.id && g.side !== s.side);
      r.pimAll += myPens.reduce((a, p) => a + p.minutes, 0);
      r.oppPimAll += oppPens.reduce((a, p) => a + p.minutes, 0);
      // попытки и время большинства/меньшинства — по правилам ИИХФ:
      // двойной малый = 2 попытки; гол в большинстве аннулирует первый малый штраф
      // (на большие не распространяется); обоюдные и ШБ преимущества не создают.
      // Малые штрафы нашей команды закрываются голами СОПЕРНИКА в его большинстве, и наоборот.
      const myPPGoals = myGoals.filter((g) => g.strength === "pp");
      const oppPPGoals = oppGoals.filter((g) => g.strength === "pp");
      const myPK = powerPlayFrom(myPens, oppPPGoals); // наши удаления → наше меньшинство
      const oppPK = powerPlayFrom(oppPens, myPPGoals); // удаления соперника → наше большинство
      r.pim += myPK.minutes; // ВПМ
      r.oppPim += oppPK.minutes; // ВПБ
      r.coinCount += myPens.filter((p) => p.coincidental).length;
      r.coinMinutes += myPens.filter((p) => p.coincidental).reduce((a, p) => a + p.minutes, 0);
      r.pkOwn += myPK.attempts;
      r.ppOpp += oppPK.attempts;
      // официальный метод ИИХФ (Official Stats): попытка = любое численное
      // преимущество хотя бы в одного игрока длительностью от 1 секунды
      // (считается симуляцией составов по таймлайну матча, ниже вызов один
      // раз на матч — см. iihfPowerPlayAdvances)
      r.offPpAttempts += s.side === "home" ? adv.home : adv.away;
      r.offPkAttempts += s.side === "home" ? adv.away : adv.home;
      // голы в большинстве/пропущенные в меньшинстве (включая овертайм — там 4х3)
      r.ppGoals += myGoals.filter((g) => g.strength === "pp").length;
      r.shGoals += myGoals.filter((g) => g.strength === "sh").length;
      r.enGoals += myGoals.filter((g) => g.emptyNet).length;
      r.gaShorthanded += oppGoals.filter((g) => g.strength === "pp").length;
      r.gaPowerplay += oppGoals.filter((g) => g.strength === "sh").length;
      const mySk = skaters.filter((k) => k.matchId === m.id && k.side === s.side);
      r.hits += mySk.reduce((a, k) => a + k.hits, 0);
      r.blocks += mySk.reduce((a, k) => a + k.blocks, 0);
      r.shots += mySk.reduce((a, k) => a + k.shots, 0);
      const sogFor = mySk.reduce((a, k) => a + k.shotsOnGoal, 0);
      r.sog += sogFor;
      if (s.side === "home") {
        r.sogHome += sogFor;
        r.gfHome += s.gf;
      } else {
        r.sogAway += sogFor;
        r.gfAway += s.gf;
      }
      if (s.gf === 0) r.blankGames += 1; // Ибз: не забросили ни одной шайбы
      if (s.ga === 0) r.cleanSheets += 1; // И0: сыграли «на ноль»
      // силовые и блоки соперника в матчах против этой команды
      const oppSk = skaters.filter((k) => k.matchId === m.id && k.side !== s.side);
      r.hitsAgainst += oppSk.reduce((a, k) => a + k.hits, 0);
      r.blocksAgainst += oppSk.reduce((a, k) => a + k.blocks, 0);
      // вклад вратарей (у вратаря тоже могут быть силовые, блоки, броски)
      const myGoalies = goalies.filter((g) => g.matchId === m.id && g.side === s.side);
      const gSog = myGoalies.reduce((a, g) => a + g.shotsOnGoal, 0);
      r.hits += myGoalies.reduce((a, g) => a + g.hits, 0);
      r.blocks += myGoalies.reduce((a, g) => a + g.blocks, 0);
      r.shots += myGoalies.reduce((a, g) => a + g.shots, 0);
      r.sog += gSog;
      if (s.side === "home") r.sogHome += gSog;
      else r.sogAway += gSog;
    }
  }

  const list = [...map.values()];
  for (const r of list) {
    // %О — процент очков от максимума: максимум 2 очка за игру
    r.ptsPct = r.gp ? (r.pts / (r.gp * 2)) * 100 : null;
    r.ppPct = r.ppOpp ? (r.ppGoals / r.ppOpp) * 100 : null;
    r.pkPct = r.pkOwn ? (1 - r.gaShorthanded / r.pkOwn) * 100 : null;
    // официальные проценты — от «протокольных» попыток
    r.offPpPct = r.offPpAttempts ? (r.ppGoals / r.offPpAttempts) * 100 : null;
    r.offPkPct = r.offPkAttempts ? (1 - r.gaShorthanded / r.offPkAttempts) * 100 : null;
    r.shotPct = r.shots ? (r.gf / r.shots) * 100 : null;
  }
  list.sort(
    (a, b) =>
      b.pts - a.pts ||
      b.gf - b.ga - (a.gf - a.ga) ||
      b.gf - a.gf ||
      a.team.localeCompare(b.team, "ru"),
  );
  return list;
}

export type PlayerSeasonRow = {
  name: string;
  teams: string[];
  gp: number;
  goals: number; assists: number; points: number;
  plusMinus: number; // сумма показателей +/− за все матчи
  shots: number; shotsOnGoal: number;
  hits: number; hitsPer60: number | null;
  blocks: number; blocksPer60: number | null;
  shotPct: number | null;
  pim: number;
  toi: number; avgToi: number;
  faceoffs: number; faceoffWins: number; foPct: number | null;
};

export function computePlayerSeason(matches: Match[], skaters: SkaterGame[]): PlayerSeasonRow[] {
  const byName = new Map<string, PlayerSeasonRow & { matchIds: Set<number> }>();
  const matchById = new Map(matches.map((m) => [m.id, m]));
  for (const s of skaters) {
    const key = s.name.trim().toLowerCase();
    if (!key) continue;
    let r = byName.get(key);
    if (!r) {
      r = {
        name: s.name.trim(), teams: [], gp: 0, goals: 0, assists: 0, points: 0, plusMinus: 0,
        shots: 0, shotsOnGoal: 0, hits: 0, hitsPer60: null, blocks: 0, blocksPer60: null,
        shotPct: null, pim: 0, toi: 0, avgToi: 0, faceoffs: 0, faceoffWins: 0, foPct: null,
        matchIds: new Set(),
      };
      byName.set(key, r);
    }
    const m = matchById.get(s.matchId);
    const team = m ? (s.side === "home" ? m.homeTeam : m.awayTeam) : "?";
    if (!r.teams.includes(team)) r.teams.push(team);
    if (!r.matchIds.has(s.matchId)) {
      r.matchIds.add(s.matchId);
      r.gp += 1;
    }
    r.goals += s.goals; r.assists += s.assists; r.points += s.goals + s.assists;
    // +/− суммируется простым сложением значений за каждый матч
    r.plusMinus += s.plusMinus;
    r.shots += s.shots; r.shotsOnGoal += s.shotsOnGoal;
    r.hits += s.hits; r.blocks += s.blocks; r.pim += s.pim;
    r.toi += s.toiSeconds;
    r.faceoffs += s.faceoffs; r.faceoffWins += s.faceoffWins;
  }
  const list = [...byName.values()];
  for (const r of list) {
    const hours = r.toi / 3600;
    r.hitsPer60 = hours > 0 ? r.hits / hours : null;
    r.blocksPer60 = hours > 0 ? r.blocks / hours : null;
    r.shotPct = r.shotsOnGoal ? (r.goals / r.shotsOnGoal) * 100 : null;
    r.avgToi = r.gp ? r.toi / r.gp : 0;
    r.foPct = r.faceoffs ? (r.faceoffWins / r.faceoffs) * 100 : null;
  }
  list.sort((a, b) => b.points - a.points || b.goals - a.goals || a.name.localeCompare(b.name, "ru"));
  return list;
}

export type GoalieSeasonRow = {
  name: string;
  teams: string[];
  rostered: number; // З — сколько раз был в заявке
  gp: number; // И — сколько раз реально играл (было игровое время)
  wins: number; losses: number;
  toi: number; avgToi: number;
  saves: number; shotsAgainst: number; goalsAgainst: number;
  savePct: number | null; gaa: number | null;
  shutouts: number;
  hits: number; // силовые приёмы вратаря
  blocks: number; // заблокированные броски вратаря
  assists: number; // голевые передачи вратаря
};

export function computeGoalieSeason(matches: Match[], goalies: GoalieGame[]): GoalieSeasonRow[] {
  const byName = new Map<string, GoalieSeasonRow & { matchIds: Set<number> }>();
  const matchById = new Map(matches.map((m) => [m.id, m]));
  for (const g of goalies) {
    const key = g.name.trim().toLowerCase();
    if (!key) continue;
    let r = byName.get(key);
    if (!r) {
      r = {
        name: g.name.trim(), teams: [], rostered: 0, gp: 0, wins: 0, losses: 0, toi: 0, avgToi: 0,
        saves: 0, shotsAgainst: 0, goalsAgainst: 0, savePct: null, gaa: null, shutouts: 0,
        hits: 0, blocks: 0, assists: 0,
        matchIds: new Set(),
      };
      byName.set(key, r);
    }
    const m = matchById.get(g.matchId);
    const team = m ? (g.side === "home" ? m.homeTeam : m.awayTeam) : "?";
    if (!r.teams.includes(team)) r.teams.push(team);
    if (!r.matchIds.has(g.matchId)) {
      r.matchIds.add(g.matchId);
      r.rostered += 1; // был в заявке
      if (g.toiSeconds > 0) {
        // реально выходил на лёд — считаем игрой, В/П и сухим матчем
        r.gp += 1;
        if (m) {
          const won = (g.side === "home" && m.homeScore > m.awayScore) || (g.side === "away" && m.awayScore > m.homeScore);
          if (won) r.wins += 1;
          else r.losses += 1;
        }
      }
    }
    r.toi += g.toiSeconds;
    r.saves += g.saves;
    r.goalsAgainst += g.goalsAgainst;
    r.shotsAgainst += g.saves + g.goalsAgainst;
    r.hits += g.hits;
    r.blocks += g.blocks;
    r.assists += g.assists;
    if (g.toiSeconds > 0 && g.goalsAgainst === 0) r.shutouts += 1;
  }
  const list = [...byName.values()];
  for (const r of list) {
    r.avgToi = r.gp ? r.toi / r.gp : 0;
    r.savePct = r.shotsAgainst ? (r.saves / r.shotsAgainst) * 100 : null;
    r.gaa = r.toi > 0 ? (r.goalsAgainst / (r.toi / 60)) * 60 : null;
  }
  list.sort((a, b) => b.toi - a.toi || a.name.localeCompare(b.name, "ru"));
  return list;
}

export type PeriodStatsEntry = {
  gp: number;
  gf: number; // заброшенные шайбы (Ш)
  ga: number; // пропущенные шайбы (ПШ)
  sogFor: number | null; // броски в створ
  sogAgainst: number | null; // броски в створ от соперника (БсС)
  pens: number;
  pim: number;
  w: number;
  d: number;
  l: number;
};

export type TeamPeriodRow = {
  team: string;
  gp: number;
  periods: PeriodStatsEntry[]; // индекс 0..3 = 1-й, 2-й, 3-й периоды и овертайм
  total: {
    gf: number; ga: number;
    sogFor: number | null; sogAgainst: number | null;
    pens: number; pim: number;
  };
};

const emptyPeriodEntry = (): PeriodStatsEntry => ({
  gp: 0, gf: 0, ga: 0, sogFor: null, sogAgainst: null,
  pens: 0, pim: 0, w: 0, d: 0, l: 0,
});

type PeriodGoals = { h: number; a: number; hSog?: number; aSog?: number };

const TIME_RE = /^\d{1,2}:\d{2}$/;

/** Период удаления — по игровому времени (надёжнее колонки протокола):
 *  00:00–20:00 → 1, 20:00–40:00 → 2, 40:00–60:00 → 3, после 60:00 → 4 (ОТ).
 *  Если времени нет — используем сохранённый период. */
function penaltyPeriod(p: Penalty): number {
  if (p.time && TIME_RE.test(p.time)) return periodFromTime(p.time) || p.period;
  return p.period;
}

/**
 * Подсчёт попыток численного большинства (как в официальной системе лиги):
 * счётчик привязан к ИНДИВИДУАЛЬНЫМ штрафам, а не к непрерывным интервалам
 * неравенства составов.
 *
 *  - каждый малый штраф (2′) — одна попытка;
 *  - каждый большой штраф (5′) — одна попытка (голом не закрывается);
 *  - двойной малый одного игрока (2+2 или 4′ одной записью) — ДВЕ попытки
 *    (идут последовательно: гол закрывает только первую двухминутку);
 *  - два игрока одной команды удалены в одну секунду — ДВЕ ПАРАЛЛЕЛЬНЫЕ
 *    попытки (соперник играет 5х3) — не склеиваются в одну;
 *  - 5+20 и 2+10 одной секунды — учитывается только «малая/большая» часть
 *    (одна попытка), дисциплинарная часть состава не меняет;
 *  - ИСКЛЮЧАЮТСЯ: обоюдные удаления (игроки обеих команд в одну секунду —
 *    составы равны) и дисциплинарные штрафы 10′ / 20′ / 25′ — они не меняют
 *    численность игроков на льду;
 *  - штрафной бросок (0′) — большинства не возникает;
 *  - в овертайме удаление даёт большинство 4х3 — учитывается.
 *
 * Возвращает сегменты для расчёта времени ВПБ/ВПМ.
 */
export interface PenaltySegment {
  startSec: number;
  endSec: number;
  cancelable: boolean; // малые части закрываются голом в большинстве
}

export function penaltySegments(pens: Penalty[]): {
  segments: PenaltySegment[];
  fixedMinutes: number; // штрафы без времени: считаем номинально
} {
  // штрафы одного игрока (или командные), выписанные в одну секунду: 2+2, 5+20, 2+10…
  const groups = new Map<string, Penalty[]>();
  for (const p of pens) {
    const k = `${(p.player ?? "team").toLowerCase()}|${p.time ?? ""}`;
    const g = groups.get(k);
    if (g) g.push(p);
    else groups.set(k, [p]);
  }
  const segments: PenaltySegment[] = [];
  let fixedMinutes = 0;
  for (const group of groups.values()) {
    if (group.some((p) => p.coincidental)) continue; // обоюдные — составы равны
    let minors = 0; // количество 2-минутных частей (каждая = отдельная попытка)
    let bigs = 0; // 5-минутные части (каждая = отдельная попытка)
    for (const p of group) {
      if (p.minutes === 2) minors += 1;
      else if (p.minutes === 4) minors += 2; // двойной малый одной записью = 2 попытки
      else if (p.minutes === 5) bigs += 1; // большой штраф
      // дисциплинарные 10′ / 20′ / 25′ и ШБ (0′) численность на льду не меняют —
      // попытки не дают
    }
    if (!minors && !bigs) continue;
    const start = Math.max(
      ...group.map((p) => (p.time && TIME_RE.test(p.time) ? parseMMSS(p.time) : -1)),
    );
    if (start < 0) {
      // время не указано — считаем номинально (голами такие отрезки не закрыть)
      fixedMinutes += minors * 2 + bigs * 5;
      for (let i = 0; i < minors + bigs; i++) {
        segments.push({ startSec: Number.NaN, endSec: Number.NaN, cancelable: false });
      }
      continue;
    }
    let offset = 0;
    for (let i = 0; i < minors; i++) {
      segments.push({ startSec: start + offset, endSec: start + offset + 120, cancelable: true });
      offset += 120;
    }
    for (let i = 0; i < bigs; i++) {
      segments.push({ startSec: start + offset, endSec: start + offset + 300, cancelable: false });
      offset += 300;
    }
  }
  return { segments, fixedMinutes };
}

/**
 * Попытки большинства по методу ИИХФ (таблица «Протокол» — Official Stats).
 *
 * ИИХФ засчитывает попытку большинства (ADV) каждый раз, когда команда
 * получает численное преимущество на льду хотя бы в одного игрока на любое
 * время (достаточно даже 1 секунды). Правила подсчёта:
 *
 *  - малый штраф (2′) = ровно 1 попытка; гол в большинстве закрывает её
 *    со статусом «реализовано», без гола — «не реализовано»;
 *  - двойной малый (4′ или 2+2) = ДВЕ последовательные попытки по 2 минуты;
 *    гол в первые две минуты реализует первую и открывает вторую;
 *  - большой штраф (5′) не сгорает после гола: попытки = ГОЛЫ В ОКНО + 1
 *    (не забили за 5 минут → 1 попытка «0 из 1»; забили 2 → 3 попытки «2 из 3»);
 *  - формат 5х3: каждое удаление соперника — отдельная попытка; гол при 5х3
 *    закрывает удаление, ближайшее к окончанию (1 гол → «1 из 2»);
 *  - обоюдные штрафы: если составы равны (4х4 / 3х3), попытки не получает
 *    никто; если штрафы разошлись во времени и одна команда хотя бы секунду
 *    играет с преимуществом — ей засчитывается полноценная попытка;
 *  - формат 6х5 (смена вратаря при отложенном штрафе или в конце матча)
 *    попыткой НЕ считается — у соперника нет удалённого в штрафном боксе;
 *  - штрафной бросок (0′) и дисциплинарные 10′/20′/25′ численность на льду
 *    не меняют — не считаются (в сочетаниях 5+20 и 2+10 учитывается только
 *    малая/большая часть);
 *  - в овертайме удаление даёт большинство (4х3) — учитывается.
 *
 * Реализация: симуляция составов по таймлайну матча. Штрафы образуют
 * сегменты «нехватки» игроков, голы в большинстве закрывают ближайший
 * к окончанию малый сегмент, затем для каждого сегмента проверяется, имела
 * ли пострадавшая сторона численное преимущество хотя бы 1 секунду.
 * Возвращает попытки для хозяев и гостей.
 */
export function iihfPowerPlayAdvances(
  matchPens: Penalty[],
  matchGoals: Goal[],
): { home: number; away: number } {
  const opp = (s: Side): Side => (s === "home" ? "away" : "home");
  const adv = { home: 0, away: 0 };

  // сегменты «нехватки» игроков: сторона — команда УДАЛЁННОГО игрока
  const segs: { side: Side; start: number; end: number; major: boolean }[] = [];
  for (const p of matchPens) {
    if (p.penaltyShot) continue; // штрафной бросок (0′) большинства не даёт
    if (p.minutes !== 2 && p.minutes !== 4 && p.minutes !== 5) continue; // 10/20/25 состав не меняют
    const hasTime = !!p.time && TIME_RE.test(p.time);
    if (!hasTime) {
      // время не указано: считаем номинально (преимущество было по определению)
      adv[opp(p.side)] += p.minutes === 4 ? 2 : 1;
      continue;
    }
    const start = parseMMSS(p.time as string);
    if (p.minutes === 2) {
      segs.push({ side: p.side, start, end: start + 120, major: false });
    } else if (p.minutes === 4) {
      // двойной малый: два последовательных сегмента по 2 минуты
      segs.push({ side: p.side, start, end: start + 120, major: false });
      segs.push({ side: p.side, start: start + 120, end: start + 240, major: false });
    } else {
      segs.push({ side: p.side, start, end: start + 300, major: true });
    }
  }

  // голы в большинстве закрывают ближайший к окончанию АКТИВНЫЙ малый сегмент
  // соперника (на большие штрафы не распространяется)
  const ppGoals = matchGoals
    .filter((g) => g.strength === "pp" && g.time && TIME_RE.test(g.time))
    .map((g) => ({ side: g.side, t: parseMMSS(g.time as string) }))
    .sort((a, b) => a.t - b.t);
  for (const g of ppGoals) {
    let best: (typeof segs)[number] | null = null;
    for (const s of segs) {
      if (s.major || s.side === g.side) continue;
      if (s.start <= g.t && g.t < s.end && (!best || s.end < best.end)) best = s;
    }
    if (best) best.end = g.t;
  }

  // таймлайн: интервалы между событиями с флагом численного преимущества;
  // на льду не может быть меньше 3 полевых, поэтому учитываем максимум
  // два активных штрафа на команду (остальные ждут очереди)
  const points = Array.from(new Set(segs.flatMap((s) => [s.start, s.end]))).sort(
    (a, b) => a - b,
  );
  const intervals: { from: number; to: number; homeAdv: boolean; awayAdv: boolean }[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const from = points[i];
    const to = points[i + 1];
    if (to <= from) continue;
    const homeDown = segs.filter((s) => s.side === "home" && s.start <= from && s.end > from).length;
    const awayDown = segs.filter((s) => s.side === "away" && s.start <= from && s.end > from).length;
    const homeSk = 5 - Math.min(homeDown, 2);
    const awaySk = 5 - Math.min(awayDown, 2);
    intervals.push({ from, to, homeAdv: homeSk > awaySk, awayAdv: awaySk > homeSk });
  }

  // атрибуция попыток по сегментам штрафов
  for (const s of segs) {
    const beneficiary = opp(s.side); // команда, играющая в большинстве
    let advSec = 0;
    let goalsInWindow = 0;
    for (const iv of intervals) {
      const lo = Math.max(iv.from, s.start);
      const hi = Math.min(iv.to, s.end);
      if (hi <= lo) continue;
      if (beneficiary === "home" ? iv.homeAdv : iv.awayAdv) advSec += hi - lo;
    }
    if (s.major) {
      for (const g of ppGoals) {
        if (g.side === beneficiary && s.start <= g.t && g.t < s.end) goalsInWindow += 1;
      }
      // преимущество было (хоть секунду) — попыток = голы + 1;
      // если преимущества не было вовсе, учитываем только голы (краевой случай)
      adv[beneficiary] += goalsInWindow + (advSec > 0 ? 1 : 0);
    } else if (advSec > 0) {
      // малый штраф: преимущество хотя бы на 1 секунду = полноценная попытка
      adv[beneficiary] += 1;
    }
  }

  return adv;
}



/**
 * Попытки большинства и время большинства/меньшинства, которые создаёт набор
 * удалений ОДНОЙ команды. `cancelingGoals` — голы соперника в большинстве:
 * по правилам ИИХФ гол аннулирует первый (ближайший к окончанию) малый штраф,
 * на большие штрафы это не распространяется.
 */
export function powerPlayFrom(
  pens: Penalty[],
  cancelingGoals: { time: string | null }[] = [],
): { attempts: number; minutes: number } {
  const { segments, fixedMinutes } = penaltySegments(pens);
  const goalTimes = cancelingGoals
    .map((g) => (g.time && TIME_RE.test(g.time) ? parseMMSS(g.time) : -1))
    .filter((t) => t >= 0)
    .sort((a, b) => a - b);
  for (const t of goalTimes) {
    // закрывается активный малый сегмент с ближайшим окончанием
    let best: PenaltySegment | null = null;
    for (const s of segments) {
      if (!s.cancelable || Number.isNaN(s.startSec)) continue;
      if (s.startSec <= t && t < s.endSec) {
        if (!best || s.endSec < best.endSec) best = s;
      }
    }
    if (best) best.endSec = t;
  }
  let minutes = fixedMinutes;
  for (const s of segments) {
    if (!Number.isNaN(s.startSec)) minutes += Math.max(0, s.endSec - s.startSec) / 60;
  }
  return { attempts: segments.length, minutes: Math.round(minutes * 100) / 100 };
}

function periodGoalsFromGoals(goals: Goal[], matchId: number): PeriodGoals[] {
  const list = goals.filter((g) => g.matchId === matchId && g.period >= 1 && g.period <= 4);
  if (!list.length) return [];
  const maxP = Math.max(...list.map((g) => g.period));
  const arr: PeriodGoals[] = [];
  for (let p = 1; p <= maxP; p++) {
    arr.push({
      h: list.filter((g) => g.period === p && g.side === "home").length,
      a: list.filter((g) => g.period === p && g.side === "away").length,
    });
  }
  return arr;
}

/** Статистика команд по периодам за весь сезон. */
export function computePeriodStats(
  matches: Match[],
  penalties: Penalty[],
  goals: Goal[],
): TeamPeriodRow[] {
  const map = new Map<string, TeamPeriodRow>();
  const row = (team: string): TeamPeriodRow => {
    const key = team.trim();
    let r = map.get(key);
    if (!r) {
      r = {
        team: key,
        gp: 0,
        periods: [emptyPeriodEntry(), emptyPeriodEntry(), emptyPeriodEntry(), emptyPeriodEntry()],
        total: { gf: 0, ga: 0, sogFor: null, sogAgainst: null, pens: 0, pim: 0 },
      };
      map.set(key, r);
    }
    return r;
  };

  for (const m of matches) {
    const sides: { side: Side; team: string; opp: string }[] = [
      { side: "home", team: m.homeTeam, opp: m.awayTeam },
      { side: "away", team: m.awayTeam, opp: m.homeTeam },
    ];
    const perGoals: PeriodGoals[] =
      m.periods && m.periods.length ? m.periods : periodGoalsFromGoals(goals, m.id);
    for (const s of sides) {
      const r = row(s.team);
      row(s.opp);
      r.gp += 1;
      for (let pi = 0; pi < 4; pi++) {
        const e = r.periods[pi];
        const myPens = penalties.filter(
          (p) => p.matchId === m.id && p.side === s.side && penaltyPeriod(p) === pi + 1,
        );
        e.pens += myPens.length;
        e.pim += myPens.reduce((a, p) => a + p.minutes, 0);
        const pg = perGoals[pi];
        // период считается сыгранным, даже если голов нет, но были удаления (например, в ОТ)
        if (!pg && myPens.length === 0) continue;
        e.gp += 1;
        if (!pg) continue;
        const gf = s.side === "home" ? pg.h : pg.a;
        const ga = s.side === "home" ? pg.a : pg.h;
        const sf = s.side === "home" ? pg.hSog : pg.aSog;
        const sa = s.side === "home" ? pg.aSog : pg.hSog;
        e.gf += gf;
        e.ga += ga;
        if (typeof sf === "number") e.sogFor = (e.sogFor ?? 0) + sf;
        if (typeof sa === "number") e.sogAgainst = (e.sogAgainst ?? 0) + sa;
        if (gf > ga) e.w += 1;
        else if (gf === ga) e.d += 1;
        else e.l += 1;
      }
    }
  }

  const list = [...map.values()];
  for (const r of list) {
    r.total.gf = r.periods.reduce((a, p) => a + p.gf, 0);
    r.total.ga = r.periods.reduce((a, p) => a + p.ga, 0);
    r.total.pens = r.periods.reduce((a, p) => a + p.pens, 0);
    r.total.pim = r.periods.reduce((a, p) => a + p.pim, 0);
    const sogs = r.periods.filter((p) => p.sogFor !== null);
    r.total.sogFor = sogs.length ? sogs.reduce((a, p) => a + (p.sogFor ?? 0), 0) : null;
    const sags = r.periods.filter((p) => p.sogAgainst !== null);
    r.total.sogAgainst = sags.length ? sags.reduce((a, p) => a + (p.sogAgainst ?? 0), 0) : null;
  }
  list.sort(
    (a, b) =>
      b.total.gf - b.total.ga - (a.total.gf - a.total.ga) ||
      b.total.gf - a.total.gf ||
      a.team.localeCompare(b.team, "ru"),
  );
  return list;
}

export type PlayerDayRow = {
  date: string;
  name: string;
  teams: string[];
  gp: number;
  goals: number;
  assists: number;
  points: number;
  plusMinus: number;
  shots: number;
  sog: number;
  hits: number;
  blocks: number;
  pim: number;
  toi: number;
};

/** Показатели игроков, сгруппированные по дню (в рамках дня суммируются все матчи). */
export function computePlayerDays(matches: Match[], skaters: SkaterGame[]): PlayerDayRow[] {
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const byKey = new Map<string, PlayerDayRow & { matchIds: Set<number> }>();
  for (const s of skaters) {
    const m = matchById.get(s.matchId);
    if (!m) continue;
    const key = `${m.date}|${s.name.trim().toLowerCase()}`;
    let r = byKey.get(key);
    if (!r) {
      r = {
        date: m.date, name: s.name.trim(), teams: [], gp: 0, goals: 0, assists: 0, points: 0,
        plusMinus: 0, shots: 0, sog: 0, hits: 0, blocks: 0, pim: 0, toi: 0,
        matchIds: new Set(),
      };
      byKey.set(key, r);
    }
    const team = s.side === "home" ? m.homeTeam : m.awayTeam;
    if (!r.teams.includes(team)) r.teams.push(team);
    if (!r.matchIds.has(s.matchId)) {
      r.matchIds.add(s.matchId);
      r.gp += 1;
    }
    r.goals += s.goals;
    r.assists += s.assists;
    r.points += s.goals + s.assists;
    r.plusMinus += s.plusMinus;
    r.shots += s.shots;
    r.sog += s.shotsOnGoal;
    r.hits += s.hits;
    r.blocks += s.blocks;
    r.pim += s.pim;
    r.toi += s.toiSeconds;
  }
  return [...byKey.values()];
}

export type GoalieDayRow = {
  date: string;
  name: string;
  teams: string[];
  gp: number;
  toi: number;
  saves: number;
  goalsAgainst: number;
  shotsAgainst: number;
  savePct: number | null;
};

export function computeGoalieDays(matches: Match[], goalies: GoalieGame[]): GoalieDayRow[] {
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const byKey = new Map<string, GoalieDayRow & { matchIds: Set<number> }>();
  for (const g of goalies) {
    const m = matchById.get(g.matchId);
    if (!m) continue;
    const key = `${m.date}|${g.name.trim().toLowerCase()}`;
    let r = byKey.get(key);
    if (!r) {
      r = {
        date: m.date, name: g.name.trim(), teams: [], gp: 0, toi: 0,
        saves: 0, goalsAgainst: 0, shotsAgainst: 0, savePct: null,
        matchIds: new Set(),
      };
      byKey.set(key, r);
    }
    const team = g.side === "home" ? m.homeTeam : m.awayTeam;
    if (!r.teams.includes(team)) r.teams.push(team);
    if (!r.matchIds.has(g.matchId)) {
      r.matchIds.add(g.matchId);
      r.gp += 1;
    }
    r.toi += g.toiSeconds;
    r.saves += g.saves;
    r.goalsAgainst += g.goalsAgainst;
    r.shotsAgainst += g.saves + g.goalsAgainst;
  }
  for (const r of byKey.values()) {
    r.savePct = r.shotsAgainst ? (r.saves / r.shotsAgainst) * 100 : null;
  }
  return [...byKey.values()];
}

export type AttendanceTeamRow = {
  team: string;
  games: number; // домашние матчи с данными о зрителях
  total: number;
  avg: number | null;
};

export function computeAttendance(matches: Match[]): {
  teams: AttendanceTeamRow[];
  gamesWithData: number;
  totalAll: number;
  avgAll: number | null;
  top: Match | null;
  bottom: Match | null;
} {
  const byTeam = new Map<string, AttendanceTeamRow>();
  let gamesWithData = 0;
  let totalAll = 0;
  let top: Match | null = null;
  let bottom: Match | null = null;
  for (const m of matches) {
    if (m.attendance === null || m.attendance === undefined) continue;
    gamesWithData += 1;
    totalAll += m.attendance;
    if (!top || m.attendance > (top.attendance ?? 0)) top = m;
    if (!bottom || m.attendance < (bottom.attendance ?? 0)) bottom = m;
    const key = m.homeTeam.trim();
    let r = byTeam.get(key);
    if (!r) {
      r = { team: key, games: 0, total: 0, avg: null };
      byTeam.set(key, r);
    }
    r.games += 1;
    r.total += m.attendance;
  }
  const teams = [...byTeam.values()];
  for (const r of teams) r.avg = r.games ? Math.round(r.total / r.games) : null;
  teams.sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0) || b.total - a.total);
  return {
    teams,
    gamesWithData,
    totalAll,
    avgAll: gamesWithData ? Math.round(totalAll / gamesWithData) : null,
    top,
    bottom,
  };
}

export type TeamPenaltyTableRow = {
  team: string;
  gp: number; // И
  b2: number; b5: number; b10: number; b20: number; b25: number; // кол-во удалений по длительности
  penaltyShots: number; // ШБр — штрафные броски
  teamPim: number; // ШтрК — командные (скамеечные) штрафы, мин
  goaliePim: number; // ШтрВ — штрафы вратарей, мин
  homePim: number; // Штр_Д — дома, мин
  awayPim: number; // Штр_В — в гостях, мин
  pim: number; // Штр — всего мин
  oppPim: number; // ШтрС — штрафное время соперников
};

/** Сводная таблица штрафов по командам (Штр_2..25, ШБр, ШтрК, ШтрВ, дом/выезд, средние, соперник). */
export function computeTeamPenaltyTable(
  matches: Match[],
  penalties: Penalty[],
  goalies: GoalieGame[],
): TeamPenaltyTableRow[] {
  const matchById = new Map(matches.map((m) => [m.id, m]));
  // имена вратарей по матчу и стороне — чтобы отличать штрафы вратарей (ШтрВ)
  const goalieNames = new Map<string, Set<string>>();
  for (const g of goalies) {
    const key = `${g.matchId}|${g.side}`;
    let s = goalieNames.get(key);
    if (!s) {
      s = new Set();
      goalieNames.set(key, s);
    }
    s.add(g.name.trim().toLowerCase());
  }

  const map = new Map<string, TeamPenaltyTableRow>();
  const row = (team: string): TeamPenaltyTableRow => {
    const key = team.trim();
    let r = map.get(key);
    if (!r) {
      r = {
        team: key, gp: 0, b2: 0, b5: 0, b10: 0, b20: 0, b25: 0, penaltyShots: 0,
        teamPim: 0, goaliePim: 0, homePim: 0, awayPim: 0, pim: 0, oppPim: 0,
      };
      map.set(key, r);
    }
    return r;
  };

  for (const m of matches) {
    row(m.homeTeam).gp += 1;
    row(m.awayTeam).gp += 1;
  }

  for (const p of penalties) {
    const m = matchById.get(p.matchId);
    if (!m) continue;
    const team = p.side === "home" ? m.homeTeam : m.awayTeam;
    const r = row(team);
    if (p.penaltyShot) r.penaltyShots += 1;
    else if (p.minutes === 2) r.b2 += 1;
    else if (p.minutes === 5) r.b5 += 1;
    else if (p.minutes === 10) r.b10 += 1;
    else if (p.minutes === 20) r.b20 += 1;
    else if (p.minutes === 25) r.b25 += 1;

    r.pim += p.minutes;
    if (p.side === "home") r.homePim += p.minutes;
    else r.awayPim += p.minutes;

    if (!p.player || !p.player.trim()) {
      r.teamPim += p.minutes; // командный (скамеечный) штраф
    } else {
      const gset = goalieNames.get(`${p.matchId}|${p.side}`);
      if (gset && gset.has(p.player.trim().toLowerCase())) r.goaliePim += p.minutes;
    }

    // штраф этой команды = штрафное время для соперника
    const oppTeam = p.side === "home" ? m.awayTeam : m.homeTeam;
    row(oppTeam).oppPim += p.minutes;
  }

  return [...map.values()].sort(
    (a, b) => b.pim - a.pim || a.team.localeCompare(b.team, "ru"),
  );
}

export type TeamPenaltyRow = {
  team: string;
  count: number; minutes: number;
  b2: number; m2: number; b4: number; m4: number; b5: number; m5: number;
  b10: number; m10: number; b20: number; m20: number; bOther: number; mOther: number;
  teamPenCount: number; teamPenMinutes: number;
  coinCount: number; coinMinutes: number;
};

export type PlayerPenaltyRow = {
  player: string;
  teams: string[];
  count: number; minutes: number;
  b2: number; b4: number; b5: number; b10: number; b20: number; bOther: number;
};

export function computePenaltyStats(matches: Match[], penalties: Penalty[]) {
  const byTeam = new Map<string, TeamPenaltyRow>();
  const byPlayer = new Map<string, PlayerPenaltyRow>();
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const list = penalties.map((p) => {
    const m = matchById.get(p.matchId);
    const team = m ? (p.side === "home" ? m.homeTeam : m.awayTeam) : "?";
    if (p.player && p.player.trim()) {
      const key = p.player.trim().toLowerCase();
      let pr = byPlayer.get(key);
      if (!pr) {
        pr = { player: p.player.trim(), teams: [], count: 0, minutes: 0, b2: 0, b4: 0, b5: 0, b10: 0, b20: 0, bOther: 0 };
        byPlayer.set(key, pr);
      }
      if (!pr.teams.includes(team)) pr.teams.push(team);
      pr.count += 1;
      pr.minutes += p.minutes;
      if (p.minutes === 2) pr.b2 += 1;
      else if (p.minutes === 4) pr.b4 += 1;
      else if (p.minutes === 5) pr.b5 += 1;
      else if (p.minutes === 10) pr.b10 += 1;
      else if (p.minutes >= 20) pr.b20 += 1;
      else pr.bOther += 1;
    }
    let r = byTeam.get(team);
    if (!r) {
      r = {
        team, count: 0, minutes: 0, b2: 0, m2: 0, b4: 0, m4: 0, b5: 0, m5: 0,
        b10: 0, m10: 0, b20: 0, m20: 0, bOther: 0, mOther: 0, teamPenCount: 0, teamPenMinutes: 0,
        coinCount: 0, coinMinutes: 0,
      };
      byTeam.set(team, r);
    }
    r.count += 1;
    r.minutes += p.minutes;
    if (p.coincidental) {
      r.coinCount += 1;
      r.coinMinutes += p.minutes;
    }
    if (!p.player) {
      r.teamPenCount += 1;
      r.teamPenMinutes += p.minutes;
    }
    if (p.minutes === 2) { r.b2 += 1; r.m2 += p.minutes; }
    else if (p.minutes === 4) { r.b4 += 1; r.m4 += p.minutes; }
    else if (p.minutes === 5) { r.b5 += 1; r.m5 += p.minutes; }
    else if (p.minutes === 10) { r.b10 += 1; r.m10 += p.minutes; }
    else if (p.minutes >= 20) { r.b20 += 1; r.m20 += p.minutes; }
    else { r.bOther += 1; r.mOther += p.minutes; }
    return { ...p, team, match: m };
  });
  return {
    byTeam: [...byTeam.values()].sort((a, b) => b.minutes - a.minutes),
    byPlayer: [...byPlayer.values()].sort((a, b) => b.minutes - a.minutes || b.count - a.count),
    list,
  };
}
