/**
 * «Статистика дня» → анализ каждого матча дня: интересные факты по хозяевам,
 * гостям и общее по матчу. НОВЫЙ модуль: читает данные матчей и ничего
 * не пересчитывает в существующих таблицах.
 */
import type { Goal, GoalieGame, Match, Penalty, SkaterGame } from "@/db/schema";
import { parseMMSS } from "./clean";
import { firstLast, orderFacts, type LayoutFact } from "./factsLayout";

type Side = "home" | "away";

const word = (n: number, one: string, few: string, many: string) => {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
};
const fl = firstLast;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export type DayMatchFacts = {
  match: Pick<Match, "id" | "date" | "homeTeam" | "awayTeam" | "homeScore" | "awayScore" | "winType" | "attendance">;
  facts: LayoutFact[];
};

export function computeMatchFacts(
  m: Match,
  skaters: SkaterGame[],
  goalies: GoalieGame[],
  goalList: Goal[],
  pens: Penalty[],
): LayoutFact[] {
  const facts: LayoutFact[] = [];
  const team = (s: Side) => (s === "home" ? m.homeTeam : m.awayTeam);
  const other = (s: Side): Side => (s === "home" ? "away" : "home");
  const gs = [...goalList].sort((a, b) => parseMMSS(a.time) - parseMMSS(b.time));
  const winner: Side | null = m.homeScore > m.awayScore ? "home" : m.awayScore > m.homeScore ? "away" : null;

  // ---- игроки ----
  for (const p of skaters) {
    const s = p.side;
    const pts = p.goals + p.assists;
    const nm = fl(p.name);
    if (p.goals >= 3) facts.push({ tone: "good", tag: "Хет-трик", score: 95 + p.goals, side: s, text: `${nm} оформил хет-трик — ${p.goals} ${word(p.goals, "шайба", "шайбы", "шайб")}${p.assists ? ` и ${p.assists} ${word(p.assists, "передача", "передачи", "передач")}` : ""}.` });
    else if (p.goals === 2) facts.push({ tone: "good", tag: "Дубль", score: 75 + p.assists * 3, side: s, text: `${nm} оформил дубль${p.assists ? ` и добавил ${p.assists} ${word(p.assists, "передачу", "передачи", "передач")}` : ""}.` });
    if (pts >= 3 && p.goals < 2) facts.push({ tone: "good", tag: "Бомбардир", score: 70 + pts * 3, side: s, text: `${nm} набрал ${pts} ${word(pts, "очко", "очка", "очков")} (${p.goals}+${p.assists}).` });
    else if (pts === 2 && p.goals < 2) facts.push({ tone: "good", tag: "Очки", score: 45 + p.goals * 3, side: s, text: `${nm} — ${p.goals}+${p.assists} за матч.` });
    if (p.plusMinus >= 3) facts.push({ tone: "good", tag: "+/-", score: 38 + p.plusMinus * 2, side: s, text: `${nm} закончил матч с показателем +${p.plusMinus}.` });
    if (p.plusMinus <= -3) facts.push({ tone: "bad", tag: "+/-", score: 25 + Math.abs(p.plusMinus) * 2, side: s, text: `${nm} — показатель полезности ${p.plusMinus}.` });
    if (p.shotsOnGoal >= 6) facts.push({ tone: "good", tag: "Броски", score: 36 + p.shotsOnGoal, side: s, text: `${nm} нанёс ${p.shotsOnGoal} ${word(p.shotsOnGoal, "бросок", "броска", "бросков")} в створ${p.goals ? "" : ", но не забил"}.` });
    if (p.hits >= 6) facts.push({ tone: "good", tag: "Силовые", score: 32 + p.hits, side: s, text: `${nm} провёл ${p.hits} силовых ${word(p.hits, "приём", "приёма", "приёмов")}.` });
    if (p.blocks >= 4) facts.push({ tone: "good", tag: "Блоки", score: 32 + p.blocks * 2, side: s, text: `${nm} заблокировал ${p.blocks} ${word(p.blocks, "бросок", "броска", "бросков")}.` });
    if (p.faceoffs >= 15) {
      const pct = (p.faceoffWins / p.faceoffs) * 100;
      if (pct >= 65) facts.push({ tone: "good", tag: "Вбрасывания", score: 34 + Math.round(pct / 10), side: s, text: `${nm} выиграл ${p.faceoffWins} из ${p.faceoffs} вбрасываний (${pct.toFixed(0)}%).` });
      else if (pct <= 35) facts.push({ tone: "bad", tag: "Вбрасывания", score: 18 + Math.round((50 - pct) / 5), side: s, text: `${nm} выиграл лишь ${p.faceoffWins} из ${p.faceoffs} вбрасываний (${pct.toFixed(0)}%).` });
    }
  }

  // победная шайба (кроме побед по буллитам)
  if (winner && m.winType !== "so") {
    const loserScore = winner === "home" ? m.awayScore : m.homeScore;
    const wGoals = gs.filter((g) => g.side === winner);
    const gwg = wGoals[loserScore];
    if (gwg) facts.push({ tone: "good", tag: "Победная шайба", score: 80, side: winner, text: `Победную шайбу забросил ${fl(gwg.scorer)}${gwg.time ? ` (${gwg.time})` : ""}${gwg.strength === "pp" ? " в большинстве" : gwg.strength === "sh" ? " в меньшинстве" : ""}${m.winType === "ot" ? " в овертайме" : ""}.` });
  }

  // ---- вратари ----
  for (const g of goalies) {
    if (g.toiSeconds <= 0) continue;
    const s = g.side;
    const nm = fl(g.name);
    const sa = g.saves + g.goalsAgainst;
    const sv = sa > 0 ? (g.saves / sa) * 100 : null;
    const won = winner === s;
    const replaced = goalies.some((x) => x.side === s && x !== g && x.toiSeconds > 0) && g.toiSeconds < 2400;
    if (won && g.goalsAgainst === 0 && g.toiSeconds >= 3000) facts.push({ tone: "good", tag: "Сухой матч", score: 98, side: s, text: `${nm} сыграл «на ноль» — ${g.saves} ${word(g.saves, "сейв", "сейва", "сейвов")}.` });
    else if (g.saves >= 35) facts.push({ tone: "good", tag: "Вратарь", score: 70 + (g.saves - 35), side: s, text: `${nm} отразил ${g.saves} ${word(g.saves, "бросок", "броска", "бросков")} из ${sa}${sv !== null ? ` (${sv.toFixed(1)}%)` : ""}.` });
    else if (sv !== null && sv >= 93 && sa >= 20) facts.push({ tone: "good", tag: "Вратарь", score: 55, side: s, text: `${nm}: ${g.saves} сейвов из ${sa} (${sv.toFixed(1)}%).` });
    if (replaced && g.goalsAgainst >= 2) facts.push({ tone: "bad", tag: "Вратарь", score: 40 + g.goalsAgainst * 3, side: s, text: `${nm} был заменён: ${g.goalsAgainst} ${word(g.goalsAgainst, "пропущенная шайба", "пропущенные шайбы", "пропущенных шайб")} за ${mmss(g.toiSeconds)}.` });
    else if (sv !== null && sv < 85 && sa >= 10) facts.push({ tone: "bad", tag: "Вратарь", score: 30 + Math.round(85 - sv), side: s, text: `${nm}: ${sv.toFixed(1)}% отражённых — ${g.goalsAgainst} ${word(g.goalsAgainst, "гол", "гола", "голов")} с ${sa} ${word(sa, "броска", "бросков", "бросков")}.` });
  }

  // ---- удаления игроков (в минус) ----
  const byPlayer = new Map<string, Penalty[]>();
  for (const p of pens) {
    const k = `${p.side}|${p.player ?? ""}`;
    (byPlayer.get(k) ?? byPlayer.set(k, []).get(k)!).push(p);
  }
  for (const [k, list] of byPlayer) {
    const [side, player] = k.split("|") as [Side, string];
    const min = list.reduce((a, p) => a + p.minutes, 0);
    // голы соперника в большинстве во время его штрафов
    let costly = 0;
    for (const p of list) {
      if (p.coincidental || p.penaltyShot || !p.time || p.minutes <= 0 || p.minutes >= 10) continue;
      const t0 = parseMMSS(p.time);
      const t1 = t0 + Math.min(p.minutes, 5) * 60;
      if (gs.some((g) => g.side === other(side) && g.strength === "pp" && parseMMSS(g.time) > t0 && parseMMSS(g.time) <= t1)) costly++;
    }
    const inf = [...new Set(list.map((p) => p.infraction).filter(Boolean))].join(", ");
    const who = player ? fl(player) : `«${team(side)}» (командный штраф)`;
    facts.push({
      tone: "bad", tag: "Удаления", score: 10 + min * 2 + costly * 12 + (list.length - 1) * 4, side,
      text: `${who} — ${list.length} ${word(list.length, "удаление", "удаления", "удалений")}, ${min} ${word(min, "минута", "минуты", "минут")}${inf ? `: ${inf}` : ""}${costly ? `. Соперник реализовал большинство ${costly === 1 ? "после этого удаления" : `${costly} раза`}` : ""}.`,
    });
  }

  // ---- командные ----
  // камбэк
  if (winner) {
    let h = 0, a = 0, maxDeficit = 0;
    for (const g of gs) {
      if (g.side === "home") h++;
      else a++;
      const diff = winner === "home" ? a - h : h - a;
      if (diff > maxDeficit) maxDeficit = diff;
    }
    if (maxDeficit >= 2) facts.push({ tone: "good", tag: "Камбэк", score: 85 + maxDeficit * 3, side: winner, text: `«${team(winner)}» отыгрался, уступая в ${maxDeficit} ${word(maxDeficit, "шайбу", "шайбы", "шайб")}, и победил.` });
    if (maxDeficit >= 2) facts.push({ tone: "bad", tag: "Упущенное преимущество", score: 40 + maxDeficit * 3, side: other(winner), text: `«${team(other(winner))}» вёл в ${maxDeficit} ${word(maxDeficit, "шайбу", "шайбы", "шайб")}, но проиграл.` });
  }
  for (const s of ["home", "away"] as const) {
    const pp = gs.filter((g) => g.side === s && g.strength === "pp").length;
    const sh = gs.filter((g) => g.side === s && g.strength === "sh").length;
    const en = gs.filter((g) => g.side === s && g.emptyNet).length;
    if (pp >= 2) facts.push({ tone: "good", tag: "Большинство", score: 50 + pp * 4, side: s, text: `«${team(s)}» забросил ${pp} ${word(pp, "шайбу", "шайбы", "шайб")} в большинстве.` });
    if (sh >= 1) facts.push({ tone: "good", tag: "Меньшинство", score: 55 + sh * 5, side: s, text: `«${team(s)}» забил в меньшинстве${sh > 1 ? ` ${sh} раза` : ""}.` });
    if (en >= 1) facts.push({ tone: "neutral", tag: "Пустые ворота", score: 20, side: s, text: `«${team(s)}» забросил ${en} ${word(en, "шайбу", "шайбы", "шайб")} в пустые ворота.` });
    const teamPim = pens.filter((p) => p.side === s).reduce((a, p) => a + p.minutes, 0);
    if (teamPim >= 20) facts.push({ tone: "bad", tag: "Дисциплина", score: 20 + teamPim, side: s, text: `«${team(s)}» набрал ${teamPim} штрафных минут.` });
  }

  // ---- общее по матчу ----
  const per = (m.periods ?? []).map((p) => `${p.h}:${p.a}`).join(", ");
  facts.push({
    tone: "neutral", tag: "Итог", score: 100, side: null,
    text: `${m.homeTeam} ${m.homeScore}:${m.awayScore} ${m.awayTeam}${m.winType === "ot" ? " (ОТ)" : m.winType === "so" ? " (Б)" : ""}${per ? ` — по периодам ${per}` : ""}.`,
  });
  const hS = (m.periods ?? []).reduce((a, p) => a + (p.hSog ?? 0), 0);
  const aS = (m.periods ?? []).reduce((a, p) => a + (p.aSog ?? 0), 0);
  if (hS + aS > 0) {
    const lead: Side | null = hS > aS ? "home" : aS > hS ? "away" : null;
    facts.push({
      tone: "neutral", tag: "Броски", score: 70, side: null,
      text: `Броски в створ ${hS}:${aS}${lead && Math.abs(hS - aS) >= 10 ? ` — «${team(lead)}» заметно перебросал соперника` : ""}${lead && winner && lead !== winner && Math.abs(hS - aS) >= 5 ? `, но победил «${team(winner)}»` : ""}.`,
    });
  }
  const pimH = pens.filter((p) => p.side === "home").reduce((a, p) => a + p.minutes, 0);
  const pimA = pens.filter((p) => p.side === "away").reduce((a, p) => a + p.minutes, 0);
  const nH = pens.filter((p) => p.side === "home").length;
  const nA = pens.filter((p) => p.side === "away").length;
  if (nH + nA > 0) facts.push({ tone: "neutral", tag: "Удаления", score: 60, side: null, text: `Удаления ${nH}:${nA}, штрафное время ${pimH}:${pimA} мин.` });
  const ppH = gs.filter((g) => g.side === "home" && g.strength === "pp").length;
  const ppA = gs.filter((g) => g.side === "away" && g.strength === "pp").length;
  if (ppH + ppA > 0) facts.push({ tone: "neutral", tag: "Спецбригады", score: 55, side: null, text: `Голы в большинстве ${ppH}:${ppA}.` });
  const first = gs[0];
  if (first) facts.push({ tone: "neutral", tag: "Первый гол", score: 50, side: null, text: `Счёт открыл ${fl(first.scorer)} («${team(first.side)}»)${first.time ? ` на ${first.time}` : ""}.` });
  if (m.attendance) facts.push({ tone: "neutral", tag: "Зрители", score: 30, side: null, text: `На матче ${m.attendance} ${word(m.attendance, "зритель", "зрителя", "зрителей")}.` });

  return orderFacts(facts);
}

export function computeDayFacts(
  date: string,
  allMatches: Match[],
  skaters: SkaterGame[],
  goalies: GoalieGame[],
  goalList: Goal[],
  pens: Penalty[],
): DayMatchFacts[] {
  return allMatches
    .filter((m) => m.date === date)
    .sort((a, b) => a.id - b.id)
    .map((m) => ({
      match: {
        id: m.id, date: m.date, homeTeam: m.homeTeam, awayTeam: m.awayTeam, homeScore: m.homeScore,
        awayScore: m.awayScore, winType: m.winType, attendance: m.attendance,
      },
      facts: computeMatchFacts(
        m,
        skaters.filter((x) => x.matchId === m.id),
        goalies.filter((x) => x.matchId === m.id),
        goalList.filter((x) => x.matchId === m.id),
        pens.filter((x) => x.matchId === m.id),
      ),
    }));
}
