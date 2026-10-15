import * as cheerio from "cheerio";
import { cleanName, parseMMSS, parseRuDate, periodFromTime, toInt, todayISO } from "./clean";
import { stageFromText } from "./seasonStats";
import type { ParsedGoal, ParsedMatch, ParsedPenalty, ParsedSkater, ParsedGoalie, Side } from "./types";
import { emptyParsed } from "./types";

type Row = string[];
type Table = Row[];

function tablesFromHtml(html: string): { $: cheerio.CheerioAPI; tables: Table[] } {
  const $ = cheerio.load(html);
  const tables: Table[] = [];
  $("table").each((_i, el) => {
    if ($(el).find("table").length > 0) return; // пропускаем таблицы-обёртки с вложенными
    const rows: Row[] = [];
    $(el)
      .find("tr")
      .each((_j, tr) => {
        const cells: string[] = [];
        $(tr)
          .find("td, th")
          .each((_k, td) => {
            cells.push($(td).text().replace(/\s+/g, " ").trim());
          });
        if (cells.length) rows.push(cells);
      });
    if (rows.length) tables.push(rows);
  });
  return { $, tables };
}

function normTeam(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, "е");
}

/** Помечает обоюдные удаления: пара штрафов разных команд, наложенных в одну
 *  остановку игры (время на табло одинаковое, допуск 2 секунды на округление)
 *  и одинаковой длительности. По ИИХФ они взаимно компенсируются — команды
 *  продолжают играть в равных составах, большинство никто не получает. */
export function markCoincidental(pens: ParsedPenalty[]): void {
  for (const p of pens) p.coincidental = false;
  const home = pens.filter((p) => p.side === "home");
  const away = pens.filter((p) => p.side === "away");
  const THRESHOLD_SEC = 2;
  for (const h of home) {
    if (h.coincidental || h.penaltyShot || !h.time) continue;
    const hs = parseMMSS(h.time);
    let best: ParsedPenalty | null = null;
    let bestDiff = Infinity;
    for (const a of away) {
      if (a.coincidental || a.penaltyShot || !a.time || a.minutes !== h.minutes) continue;
      const diff = Math.abs(parseMMSS(a.time) - hs);
      if (diff <= THRESHOLD_SEC && diff < bestDiff) {
        best = a;
        bestDiff = diff;
      }
    }
    if (best) {
      h.coincidental = true;
      best.coincidental = true;
    }
  }
}

/** Быстро достаёт только количество зрителей из HTML протокола (для догрузки). */
export function extractAttendance(html: string): number | null {
  const $ = cheerio.load(html);
  const m = $("body").text().match(/(\d[\d\s]{0,7})\s*зрител/i);
  return m ? parseInt(m[1].replace(/\s/g, ""), 10) || null : null;
}

export function parseProtocolHtml(html: string, sourceUrl = ""): ParsedMatch {
  const res = emptyParsed();
  res.sourceUrl = sourceUrl;
  const { $, tables } = tablesFromHtml(html);
  const bodyText = $("body").text();

  // ---- шапка: счёт, команды, дата, тип победы ----
  const scores: number[] = [];
  $('div[style*="font-size:36px"] b, td div b').each((_i, el) => {
    const st = ($(el).attr("style") || $(el).parent().attr("style") || "") as string;
    const t = $(el).text().trim();
    if (/^\d{1,2}$/.test(t) && st.includes("36px")) scores.push(toInt(t));
  });
  if (scores.length >= 2) {
    res.homeScore = scores[0];
    res.awayScore = scores[1];
  }

  const teamNodes = $('b[style*="text-transform:uppercase"]:not([style*="color"])');
  const teamNames: string[] = [];
  teamNodes.each((_i, el) => {
    const t = $(el).text().trim();
    if (t && !teamNames.includes(t)) teamNames.push(t);
  });
  if (teamNames.length >= 2) {
    res.homeTeam = teamNames[0];
    res.awayTeam = teamNames[1];
  }

  const dateMatch = parseRuDate(bodyText);
  res.date = dateMatch ?? todayISO();

  // «732 зрителей, ...» в шапке протокола
  const attM = bodyText.match(/(\d[\d\s]{0,7})\s*зрител/i);
  res.attendance = attM ? parseInt(attM[1].replace(/\s/g, ""), 10) || null : null;

  if (/буллит/i.test(bodyText.slice(0, 4000))) res.winType = "so";
  else if (/овертайм/i.test(bodyText.slice(0, 4000))) res.winType = "ot";

  res.stage = stageFromText(bodyText.slice(0, 8000), "regular");

  // удаления по периодам из таблицы «ПЕРИОДЫ» протокола (для сверки со списком удалений)
  const protoPenPer: { hU: number; hPim: number; aU: number; aPim: number }[] = [];

  const home = normTeam(res.homeTeam);
  const away = normTeam(res.awayTeam);
  const sideOf = (teamCell: string): Side => {
    const t = normTeam(teamCell);
    if (t === away && t !== home) return "away";
    if (t === home) return "home";
    // fallback: если имя не совпало, первая таблица = хозяева
    return "home";
  };

  // вклад вратарей из строк состава (силовые, блоки, броски, передачи) —
  // таблица состава идёт раньше таблицы вратарей, поэтому сначала копим, потом сливаем
  const goalieFromSkaters: Record<
    Side,
    {
      jersey: number; name: string; toi: string; goals: number; assists: number;
      pim: number; shots: number; shotsOnGoal: number; hits: number; blocks: number;
      periodToi: number[];
    }[]
  > = { home: [], away: [] };

  // ---- таблицы ----
  for (const table of tables) {
    const flat = table.map((r) => r.join("|"));
    const headStr = flat.slice(0, 3).join("§");

    // --- статистика игроков ---
    if (headStr.includes("Ш|А|О") && headStr.includes("БлБ")) {
      const teamCell = table[0][0] ?? "";
      const side = sideOf(teamCell);
      for (const row of table.slice(2)) {
        if (!row.length || row[0] === "ВСЕГО" || !/^\d{1,2}$/.test(row[0] ?? "")) continue;
        const pos = (row[1] ?? "").trim();
        if (row.length < 20) continue;
        // Хвост строки — всегда последние 8 ячеек: Б, Бс, Бм, БлБ, Сп, Вбр, ВВбр, Вбр%.
        // У матчей с овертаймом перед ними добавляется колонка времени ОТ,
        // поэтому все индексы считаем от конца строки, а не фиксированно.
        const t0 = row.length - 8;
        // посменное время по периодам: после «См» (индекс 10) и до хвоста (3 колонки или 4 с ОТ)
        const periodCells = row.slice(11, t0);
        const periodToi: number[] = [];
        for (const cell of periodCells) {
          const m = (cell ?? "").match(/^(\d{1,2}:\d{2})/);
          periodToi.push(m ? parseMMSS(m[1]) : 0);
        }
        if (pos === "В") {
          // вратарская строка в составе: у вратаря тоже могут быть силовые, блоки, броски, передачи
          const name = cleanName(row[2]);
          if (name) {
            goalieFromSkaters[side].push({
              jersey: toInt(row[0]),
              name,
              toi: (row[9] ?? "").trim(),
              goals: toInt(row[3]),
              assists: toInt(row[4]),
              pim: toInt(row[8]),
              shots: toInt(row[t0]),
              shotsOnGoal: toInt(row[t0 + 1]),
              blocks: toInt(row[t0 + 3]),
              hits: toInt(row[t0 + 4]),
              periodToi,
            });
          }
          continue;
        }
        const sk: ParsedSkater = {
          jersey: toInt(row[0]),
          position: pos,
          rawName: row[2] ?? "",
          name: cleanName(row[2]),
          goals: toInt(row[3]),
          assists: toInt(row[4]),
          plusMinus: toInt((row[6] ?? "").replace("+", "")),
          pim: toInt(row[8]),
          toi: (row[9] ?? "").trim(),
          shots: toInt(row[t0]),
          shotsOnGoal: toInt(row[t0 + 1]),
          blocks: toInt(row[t0 + 3]),
          hits: toInt(row[t0 + 4]),
          faceoffs: toInt(row[t0 + 5]),
          faceoffWins: toInt(row[t0 + 6]),
          periodToi,
        };
        if (!sk.name) continue;
        res.skaters[side].push(sk);
      }
      continue;
    }

    // --- вратари ---
    if (headStr.includes("Сейвы")) {
      const teamCell = table[0][0] ?? "";
      const side = sideOf(teamCell);
      for (const row of table.slice(1)) {
        if (!row.length || !/^\d{1,2}$/.test(row[0] ?? "")) continue;
        const nameIdx = 2;
        const rawName = row[nameIdx] ?? "";
        if (!rawName.trim()) continue;
        // тотал сейвов: последняя ячейка вида "31 - 2"
        let saves = 0;
        let ga = 0;
        for (let i = row.length - 1; i >= nameIdx + 1; i--) {
          const m = (row[i] ?? "").match(/^(\d+)\s*-\s*(\d+)$/);
          if (m) {
            saves = toInt(m[1]);
            ga = toInt(m[2]);
            break;
          }
        }
        // общее время: максимальное значение ММ:СС в строке
        let toiSec = 0;
        for (const c of row.slice(nameIdx + 1)) {
          if (/^\d+:\d{2}$/.test(c)) toiSec = Math.max(toiSec, parseMMSS(c));
        }
        const g: ParsedGoalie = {
          jersey: toInt(row[0]),
          rawName,
          name: cleanName(rawName),
          toi: `${Math.floor(toiSec / 60)}:${String(toiSec % 60).padStart(2, "0")}`,
          saves,
          goalsAgainst: ga,
          result: "",
          goals: 0, assists: 0, shots: 0, shotsOnGoal: 0, hits: 0, blocks: 0, pim: 0,
          periodToi: [],
        };
        res.goalies[side].push(g);
      }
      continue;
    }

    // --- голы ---
    if (headStr.includes("Счет") && headStr.includes("Гол")) {
      for (const row of table.slice(1)) {
        if (!/^\d+$/.test(row[0] ?? "")) continue;
        const teamCell = row[4] ?? "";
        const side = sideOf(teamCell);
        const rawStrength = (row[3] ?? "").trim();
        let strength: ParsedGoal["strength"] = "eq";
        let emptyNet = false;
        if (/^\+/.test(rawStrength)) strength = "pp";
        else if (/^-/.test(rawStrength)) strength = "sh";
        if (/пв|п\.в|пуст/i.test(rawStrength)) emptyNet = true;
        const time = (row[2] ?? "").trim();
        res.goals.push({
          side,
          period: periodFromTime(time),
          time,
          strength,
          emptyNet,
          scorer: cleanName(row[5]),
          assist1: cleanName(row[6]),
          assist2: cleanName(row[7]),
          rawStrength,
        });
      }
      continue;
    }

    // --- удаления ---
    if (headStr.includes("Период") && headStr.includes("Причина")) {
      const teamCell = table[0][0] ?? "";
      const side = sideOf(teamCell);
      for (const row of table.slice(2)) {
        if (!/^\d+$/.test(row[0] ?? "")) continue;
        const playerRaw = (row[3] ?? "").trim();
        const isTeam = /командн|тренер|штаб/i.test(playerRaw);
        const time = (row[2] ?? "").trim();
        // период берём из игрового времени (00:00–20:00 → 1, 20:00–40:00 → 2,
        // 40:00–60:00 → 3, дальше → ОТ); колонка «Период» — запасной вариант
        const period = (/^\d{1,2}:\d{2}$/.test(time) ? periodFromTime(time) : 0) || toInt(row[1]);
        // «0» минут в протоколе = штрафной бросок (ШБ), а не отсутствие значения
        const minutesCell = (row[4] ?? "").trim();
        const minutes = minutesCell === "" ? 2 : toInt(minutesCell);
        const penaltyShot = minutes === 0;
        res.penalties.push({
          side,
          period,
          time,
          minutes,
          player: isTeam ? "" : cleanName(playerRaw),
          infraction: (row[5] ?? "").trim(),
          coincidental: false,
          penaltyShot,
        });
      }
      continue;
    }

    // --- периоды (голы, броски в створ, штраф по периодам) ---
    // колонки: Пер | Голы | Бс | У | Штр | Пер | Голы | Бс | У | Штр
    if (headStr.includes("Голы") && headStr.includes("Штр") && headStr.includes("Пер")) {
      const periods: { h: number; a: number; hSog?: number; aSog?: number }[] = [];
      for (const row of table.slice(2)) {
        if (!/^\d$/.test(row[0] ?? "")) continue;
        periods.push({
          h: toInt(row[1]),
          hSog: toInt(row[2]),
          a: toInt(row[6] ?? row[5]),
          aSog: toInt(row[7]),
        });
        // У и Штр по периодам: хозяева — колонки 3,4; гости — 8,9
        protoPenPer.push({ hU: toInt(row[3]), hPim: toInt(row[4]), aU: toInt(row[8]), aPim: toInt(row[9]) });
      }
      if (periods.length) res.periods = periods;
      continue;
    }
  }

  // ---- сливаем вклад вратарей из строк состава с вратарскими записями ----
  (["home", "away"] as Side[]).forEach((side) => {
    for (const gs of goalieFromSkaters[side]) {
      const g =
        res.goalies[side].find((x) => x.jersey !== null && x.jersey === gs.jersey) ??
        res.goalies[side].find((x) => x.name === gs.name);
      if (g) {
        g.goals += gs.goals;
        g.assists += gs.assists;
        g.shots += gs.shots;
        g.shotsOnGoal += gs.shotsOnGoal;
        g.hits += gs.hits;
        g.blocks += gs.blocks;
        g.pim += gs.pim;
        if (gs.periodToi.length) g.periodToi = gs.periodToi;
        if (!g.toi && gs.toi) g.toi = gs.toi;
      } else {
        // вратарь есть в составе, но отсутствует в таблице вратарей
        res.goalies[side].push({
          jersey: gs.jersey, name: gs.name, rawName: gs.name,
          toi: gs.toi, saves: 0, goalsAgainst: 0, result: "",
          goals: gs.goals, assists: gs.assists, shots: gs.shots,
          shotsOnGoal: gs.shotsOnGoal, hits: gs.hits, blocks: gs.blocks,
          pim: gs.pim, periodToi: gs.periodToi,
        });
      }
    }
  });

  markCoincidental(res.penalties);

  // ---- сверка удалений с таблицей периодов протокола ----
  if (protoPenPer.length) {
    const perOf = (t: string) => (/^\d{1,2}:\d{2}$/.test(t) ? periodFromTime(t) : 0);
    (["home", "away"] as Side[]).forEach((side) => {
      const teamName = side === "home" ? res.homeTeam : res.awayTeam;
      protoPenPer.forEach((pp, idx) => {
        const want = side === "home" ? { u: pp.hU, pim: pp.hPim } : { u: pp.aU, pim: pp.aPim };
        if (!want.u && !want.pim) return;
        const got = res.penalties.filter((p) => p.side === side && (perOf(p.time) || p.period) === idx + 1);
        const gotU = got.length;
        const gotPim = got.reduce((a, p) => a + p.minutes, 0);
        if (gotU !== want.u || gotPim !== want.pim) {
          res.warnings.push(
            `${idx + 1}-й период, ${teamName || (side === "home" ? "хозяева" : "гости")}: по протоколу ${want.u} удал. / ${want.pim} мин, распознано ${gotU} / ${gotPim}. Добавьте недостающие удаления вручную.`,
          );
        }
      });
    });
  }

  // ---- контрольные суммы ----
  if (!res.homeTeam || !res.awayTeam) {
    res.warnings.push("Не удалось определить названия команд из шапки — проверьте и укажите вручную.");
  }
  const gH = res.goals.filter((g) => g.side === "home").length;
  const gA = res.goals.filter((g) => g.side === "away").length;
  if ((gH || gA) && (gH !== res.homeScore || gA !== res.awayScore)) {
    res.warnings.push(
      `Список голов (${gH}:${gA}) не сходится со счётом (${res.homeScore}:${res.awayScore}) — проверьте голы.`,
    );
  }
  if (!res.skaters.home.length && !res.skaters.away.length) {
    res.warnings.push("Составы игроков не распознаны — заполните вручную.");
  }
  return res;
}
