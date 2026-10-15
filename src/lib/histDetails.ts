/**
 * Подробная статистика старого (официального) протокола hockey.by
 * (/new-admin/games/<id>/?print=protocol) для карточки матча в архиве:
 * счёт и броски по периодам, голы с авторами и ассистентами, все удаления
 * с расшифровкой, вратари, броски игроков (столбец «Бр.»), тренеры.
 *
 * НОВЫЙ модуль: существующий разбор (parseHistoricProtocol) и все расчёты
 * не меняются — здесь только дополнительная информация для отображения.
 */
import * as cheerio from "cheerio";
import { parseMMSS, periodFromTime, toInt } from "./clean";
import { parseOfficialProtocolHtml } from "./official";

type Side = "home" | "away";

export type HistPeriodRow = {
  label: string; // 1 | 2 | 3 | ОТ | СПБ | Всего
  hGoals: number; aGoals: number;
  hShots: number | null; aShots: number | null;
  hPim: number | null; aPim: number | null;
  hPpg: number | null; aPpg: number | null;
  hShg: number | null; aShg: number | null;
  hFo: number | null; aFo: number | null;
};

export type HistGoalRow = {
  side: Side;
  n: string; // порядковый номер («–» — нереализованный штрафной бросок)
  time: string;
  period: number;
  scorerNo: number | null;
  scorer: string | null;
  a1No: number | null;
  a1: string | null;
  a2No: number | null;
  a2: string | null;
  situation: string; // РС, +1, -1, ПВ, ШБ, СПБ …
  shootout: boolean;
};

export type HistPenaltyRow = {
  side: Side;
  time: string;
  period: number;
  jersey: number | null; // null — командный штраф
  player: string | null;
  minutes: number;
  infraction: string;
  infractionFull: string;
  start: string;
  end: string;
};

export type HistDetailGoalie = {
  side: Side;
  jersey: number;
  name: string;
  toi: string;
  toiSeconds: number;
  goalsAgainst: number;
  saves: number | null;
  shotsAgainst: number | null;
};

export type HistDetailPlayer = {
  side: Side;
  jersey: number | null;
  name: string;
  position: string;
  played: boolean;
  best: boolean; // (ЛИ) — лучший игрок
  shots: number; // «Бр.» в составе
  goals: number;
  assists: number;
  pim: number;
  penalties: number;
};

export type HistDetails = {
  version: 1;
  arena: string | null;
  startTime: string | null;
  periods: HistPeriodRow[];
  totals: HistPeriodRow | null;
  goals: HistGoalRow[];
  penalties: HistPenaltyRow[];
  goalies: HistDetailGoalie[];
  players: HistDetailPlayer[];
  coaches: { home: string | null; away: string | null };
};

type Row = string[];

function tables(html: string): Row[][] {
  const $ = cheerio.load(html);
  const out: Row[][] = [];
  $("table").each((_i, el) => {
    const nested = $(el).find("table").length > 0;
    const root = nested ? $(el).clone() : $(el);
    if (nested) root.find("table").remove();
    const rows: Row[] = [];
    root.find("tr").each((_j, tr) => {
      const cells: string[] = [];
      $(tr).find("td, th").each((_k, td) => {
        cells.push($(td).text().replace(/\s+/g, " ").trim());
      });
      if (cells.length) rows.push(cells);
    });
    if (rows.length) out.push(rows);
  });
  return out;
}

/** «Кибо Владлен (ЛИ), (Л)» → «Кибо Владлен» (без ударений и пометок). */
function plain(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0301\u0300]/g, "")
    .normalize("NFC")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[,.;:*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** «10 :9» → [10, 9]; пусто → null */
function pair(cell: string | undefined): [number, number] | null {
  const m = /(\d+)\s*:\s*(\d+)/.exec(cell ?? "");
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null;
}

export function parseHistoricDetails(html: string): HistDetails {
  const off = parseOfficialProtocolHtml(html);
  const ts = tables(html);

  let arena: string | null = null;
  let startTime: string | null = null;
  for (const t of ts) {
    for (const r of t) {
      for (let i = 0; i + 1 < r.length; i++) {
        if (r[i] === "Место проведения" && !arena) arena = r[i + 1] || null;
        if (r[i] === "Время" && !startTime && /^\d{1,2}:\d{2}$/.test(r[i + 1] ?? "") && r.includes("Место проведения")) startTime = r[i + 1];
      }
    }
  }

  const players: HistDetailPlayer[] = [];
  const goalsOut: HistGoalRow[] = [];
  const periods: HistPeriodRow[] = [];
  let totals: HistPeriodRow | null = null;
  const coachList: string[] = [];
  let rosterCount = 0;
  let side: Side = "home";

  for (const t of ts) {
    const head = t.slice(0, 2).map((r) => r.join("|")).join("§");

    // состав
    if (/Фамилия/.test(head) && /Поз/.test(head) && /Игр/.test(head)) {
      rosterCount += 1;
      side = rosterCount === 1 ? "home" : "away";
      for (const r of t) {
        if (!/^\d{1,2}$/.test(r[0] ?? "")) continue;
        const pos = (r[2] ?? "").trim();
        if (!/^[ВЗН]$/.test(pos)) continue;
        const name = plain(r[1] ?? "");
        if (!name) continue;
        players.push({
          side, jersey: toInt(r[0]), name, position: pos,
          played: !/^нет$/i.test((r[r.length - 1] ?? "").trim()),
          best: /\(ЛИ\)/.test(r[1] ?? ""),
          shots: /^\d+$/.test((r[3] ?? "").trim()) ? toInt(r[3]) : 0,
          goals: 0, assists: 0, pim: 0, penalties: 0,
        });
      }
      continue;
    }

    // взятие ворот
    if (/^#\|Время\|Г\|[AА]1/.test(t[0]?.join("|") ?? "")) {
      for (const r of t.slice(1)) {
        const time = (r[1] ?? "").trim();
        if (!/^\d{1,3}:\d{2}$/.test(time)) continue;
        const sit = (r[5] ?? "").trim().toUpperCase();
        const num = (c: string | undefined) => (/^\d{1,2}$/.test((c ?? "").trim()) ? toInt(c) : null);
        goalsOut.push({
          side, n: (r[0] ?? "").trim(), time, period: periodFromTime(time),
          scorerNo: num(r[2]), scorer: null, a1No: num(r[3]), a1: null, a2No: num(r[4]), a2: null,
          situation: sit, shootout: /СПБ|БУЛ/.test(sit),
        });
      }
      continue;
    }

    // статистика игры по периодам
    if (/^Период/.test(t[0]?.[0] ?? "") && /Г\s*А\s*:\s*Б/.test(t[0]?.join("|") ?? "")) {
      const h = t[0];
      const col = (re: RegExp) => h.findIndex((c) => re.test(c));
      const ci = { g: col(/^Г\s*А/), b: col(/^Бр/), s: col(/^Штр/), pp: col(/^ГБ/), sh: col(/^ГМ/), fo: col(/^Вбр/) };
      for (const r of t.slice(1)) {
        const label = (r[0] ?? "").trim();
        if (!label) continue;
        const g = pair(r[ci.g]);
        if (!g) continue;
        const get = (i: number) => (i >= 0 ? pair(r[i]) : null);
        const b = get(ci.b), s = get(ci.s), pp = get(ci.pp), sh = get(ci.sh), fo = get(ci.fo);
        const row: HistPeriodRow = {
          label, hGoals: g[0], aGoals: g[1],
          hShots: b?.[0] ?? null, aShots: b?.[1] ?? null,
          hPim: s?.[0] ?? null, aPim: s?.[1] ?? null,
          hPpg: pp?.[0] ?? null, aPpg: pp?.[1] ?? null,
          hShg: sh?.[0] ?? null, aShg: sh?.[1] ?? null,
          hFo: fo?.[0] ?? null, aFo: fo?.[1] ?? null,
        };
        if (/^Всего/i.test(label)) totals = row;
        else periods.push(row);
      }
      continue;
    }

    // тренеры
    for (const r of t) {
      const c = r.find((x) => /^Гл\.\s*тренер:/.test(x));
      if (c) coachList.push(c.replace(/^Гл\.\s*тренер:\s*/, "").trim());
    }
  }

  const byNo = (s: Side, no: number | null) => (no === null ? undefined : players.find((p) => p.side === s && p.jersey === no));
  for (const g of goalsOut) {
    const sc = byNo(g.side, g.scorerNo);
    const a1 = byNo(g.side, g.a1No);
    const a2 = byNo(g.side, g.a2No);
    g.scorer = sc?.name ?? (g.scorerNo !== null ? `№${g.scorerNo}` : null);
    g.a1 = a1?.name ?? (g.a1No !== null ? `№${g.a1No}` : null);
    g.a2 = a2?.name ?? (g.a2No !== null ? `№${g.a2No}` : null);
    if (g.shootout || g.n === "–" || g.n === "-") continue;
    if (sc) sc.goals += 1;
    if (a1) a1.assists += 1;
    if (a2) a2.assists += 1;
  }

  const penalties: HistPenaltyRow[] = off.penalties.map((p) => {
    const pl = byNo(p.side, p.jersey);
    if (pl) {
      pl.pim += p.minutes;
      pl.penalties += 1;
    }
    return {
      side: p.side, time: p.time, period: p.period, jersey: p.jersey,
      player: p.jersey === null ? null : pl?.name ?? `№${p.jersey}`,
      minutes: p.minutes, infraction: p.infraction, infractionFull: p.infractionFull, start: p.start, end: p.end,
    };
  });

  const goalies: HistDetailGoalie[] = off.goalies.map((g) => ({
    side: g.side, jersey: g.jersey, name: byNo(g.side, g.jersey)?.name ?? `Вратарь №${g.jersey}`,
    toi: g.toi, toiSeconds: parseMMSS(g.toi), goalsAgainst: g.goalsAgainst, saves: g.saves,
    shotsAgainst: g.saves !== null ? g.saves + g.goalsAgainst : null,
  }));

  return {
    version: 1, arena, startTime, periods, totals, goals: goalsOut, penalties, goalies, players,
    coaches: { home: coachList[0] || null, away: coachList[1] || null },
  };
}
