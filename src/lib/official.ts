import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { cleanName, parseMMSS, periodFromTime, toInt } from "./clean";
import type { Side } from "@/db/schema";
import type { GoaliePayload, MatchPayload, PenaltyPayload } from "./api";

/**
 * Разбор ОФИЦИАЛЬНОГО протокола матча (формат хоккейной федерации,
 * например hockey.by/new-admin/games/<id>/?print=protocol).
 *
 * В отличие от статистического отчёта, здесь есть ВСЕ штрафы (включая
 * командные — в таблице удалений вместо номера игрока стоит «К»),
 * фактическое время вратарей (МВИ), сейвы (Обр.) и пропущенные шайбы (ПШ).
 * Игроки в таблице удалений указаны только номерами — имена берутся
 * из таблицы состава.
 */

export type OfficialPenalty = {
  side: Side;
  period: number;
  time: string;
  minutes: number;
  jersey: number | null; // null => командный штраф («К»)
  infraction: string; // аббревиатура, напр. ЗАД-КЛ
  infractionFull: string; // расшифровка, напр. «Задержка клюшкой»
  start: string; // фактическое начало отбывания
  end: string; // фактическое окончание
};

export type OfficialGoalie = {
  side: Side;
  jersey: number;
  toi: string; // МВИ — фактическое время в игре
  goalsAgainst: number; // ПШ
  saves: number | null; // Обр.
};

export type OfficialRosterEntry = {
  side: Side;
  jersey: number;
  name: string;
  position: string; // В | З | Н
};

export type OfficialProtocol = {
  homeTeam: string;
  awayTeam: string;
  penalties: OfficialPenalty[];
  goalies: OfficialGoalie[];
  roster: OfficialRosterEntry[];
};

type Row = string[];
type Table = Row[];

const TIME_RE = /^\d{1,2}:\d{2}$/;

function rowsOf($: cheerio.CheerioAPI, root: cheerio.Cheerio<AnyNode>): Row[] {
  const rows: Row[] = [];
  root.find("tr").each((_j, tr) => {
    const cells: string[] = [];
    $(tr)
      .find("td, th")
      .each((_k, td) => {
        cells.push($(td).text().replace(/\s+/g, " ").trim());
      });
    if (cells.length) rows.push(cells);
  });
  return rows;
}

function tablesFromHtml(html: string): Table[] {
  const $ = cheerio.load(html);
  const tables: Table[] = [];
  $("table").each((_i, el) => {
    // у таблиц-обёрток (с вложенными таблицами) читаем СОБСТВЕННЫЕ строки —
    // там названия команд и расшифровка аббревиатур; вложенные обработаются отдельно
    if ($(el).find("table").length > 0) {
      const clone = $(el).clone();
      clone.find("table").remove();
      const rows = rowsOf($, clone);
      if (rows.length) tables.push(rows);
      return;
    }
    const rows = rowsOf($, $(el));
    if (rows.length) tables.push(rows);
  });
  return tables;
}

/** Похож ли HTML на официальный протокол (для валидации на сервере). */
export function looksLikeOfficialProtocol(html: string): boolean {
  return /Нарушение/.test(html) && /МВИ|Вр\.\s*А/.test(html);
}

export function parseOfficialProtocolHtml(html: string): OfficialProtocol {
  const tables = tablesFromHtml(html);
  const res: OfficialProtocol = {
    homeTeam: "",
    awayTeam: "",
    penalties: [],
    goalies: [],
    roster: [],
  };

  // расшифровка аббревиатур нарушений: строки вида [№, «Задержка клюшкой», «ЗАД-КЛ»]
  const infractionMap = new Map<string, string>();
  for (const table of tables) {
    const headStr = table.slice(0, 2).map((r) => r.join("|")).join("§");
    if (!headStr.includes("Расшифровка аббревиатуры нарушения")) continue;
    for (const row of table) {
      if (row.length < 3) continue;
      const abbr = row[row.length - 1].trim().toUpperCase();
      const full = row[row.length - 2].trim();
      if (abbr && /^[А-ЯЁ0-9\-]{2,12}$/.test(abbr) && full && !/аббревиатур/i.test(full)) {
        infractionMap.set(abbr, full);
      }
    }
  }

  // идём по таблицам в порядке документа: составы задают команду,
  // ближайшую к последующей таблице удалений
  let currentSide: Side | null = null;
  let rosterCount = 0;
  let pendingTeamName = "";
  for (const table of tables) {
    // ---- шапка секции команды: строка вида [«Шахтер», «Взятие ворот», «Удаления»] ----
    for (const row of table.slice(0, 2)) {
      if (row.some((c) => /Взятие ворот/.test(c))) {
        const name = row.find((c) => c.trim() && !/Взятие ворот|Удаления/.test(c));
        if (name) pendingTeamName = name.trim();
      }
    }

    const headStr = table.slice(0, 3).map((r) => r.join("|")).join("§");

    // ---- состав команды: заголовок «№ | Фамилия, Имя… | Поз. | Бр. | Игр.» ----
    if (headStr.includes("Фамилия") && headStr.includes("Поз") && headStr.includes("Игр")) {
      rosterCount += 1;
      currentSide = rosterCount === 1 ? "home" : "away";
      if (pendingTeamName) {
        if (currentSide === "home") res.homeTeam = pendingTeamName;
        else res.awayTeam = pendingTeamName;
        pendingTeamName = "";
      }
      const headerIdx = table.findIndex((r) => /^№$/.test(r[0] ?? "") && /Фамилия/.test(r[1] ?? ""));
      for (const row of table.slice(headerIdx >= 0 ? headerIdx + 1 : 2)) {
        if (!/^\d{1,2}$/.test(row[0] ?? "")) continue;
        const pos = (row[2] ?? "").trim();
        if (!/^[ВЗН]$/.test(pos)) continue;
        res.roster.push({
          side: currentSide,
          jersey: toInt(row[0]),
          name: cleanName(row[1]),
          position: pos,
        });
      }
      continue;
    }

    // ---- удаления: заголовок «Время | № | Мин. | Нарушение | Нач. | Оконч.» ----
    if (headStr.includes("Нарушение") && /Мин/.test(headStr) && headStr.includes("Оконч")) {
      const side: Side = currentSide ?? (res.penalties.length ? "away" : "home");
      const headerIdx = table.findIndex(
        (r) => (r[0] ?? "") === "Время" && /Мин/.test(r[2] ?? "") && (r[3] ?? "") === "Нарушение",
      );
      for (const row of table.slice(headerIdx >= 0 ? headerIdx + 1 : 1)) {
        const time = (row[0] ?? "").trim();
        if (!TIME_RE.test(time)) continue; // пустые строки и итоги
        const jerseyCell = (row[1] ?? "").trim();
        const isTeam = /^К$|^КШ|командн/i.test(jerseyCell);
        const minutesCell = (row[2] ?? "").replace(/[′']/g, "").trim();
        const minutes = minutesCell === "" ? 2 : toInt(minutesCell);
        const abbr = (row[3] ?? "").trim().toUpperCase();
        res.penalties.push({
          side,
          period: periodFromTime(time),
          time,
          minutes,
          jersey: isTeam ? null : toInt(jerseyCell) || null,
          infraction: abbr,
          infractionFull: infractionMap.get(abbr) ?? "",
          start: (row[4] ?? "").trim(),
          end: (row[5] ?? "").trim(),
        });
      }
      continue;
    }

    // ---- вратари: заголовок «Вр. А | МВИ | ПШ | Обр. | Вр. Б | МВИ | ПШ | Обр.» ----
    if (/Вр\.\s*А/.test(headStr) && headStr.includes("МВИ") && headStr.includes("ПШ")) {
      const headerIdx = table.findIndex((r) => /Вр\.\s*А/.test(r[0] ?? "") && (r[1] ?? "") === "МВИ");
      for (const row of table.slice(headerIdx >= 0 ? headerIdx + 1 : 1)) {
        const readHalf = (off: number): OfficialGoalie | null => {
          const jerseyCell = (row[off] ?? "").trim();
          if (!/^\d{1,2}$/.test(jerseyCell)) return null;
          const toi = (row[off + 1] ?? "").trim();
          if (!TIME_RE.test(toi)) return null;
          const savesCell = (row[off + 3] ?? "").trim();
          return {
            side: off === 0 ? "home" : "away",
            jersey: toInt(jerseyCell),
            toi,
            goalsAgainst: toInt(row[off + 2]),
            saves: /^\d+$/.test(savesCell) ? toInt(savesCell) : null,
          };
        };
        const h = readHalf(0);
        const a = readHalf(4);
        if (h) res.goalies.push(h);
        if (a) res.goalies.push(a);
      }
      continue;
    }
  }

  return res;
}

// ---------------------------------------------------------------------------
// Сверка официального протокола с данными в базе
// ---------------------------------------------------------------------------

export type CurrentGoalie = {
  index: number;
  side: Side;
  jersey: number | null;
  name: string;
  toiSeconds: number;
  saves: number;
  goalsAgainst: number;
};

export type CurrentPenalty = MatchPayload["penalties"][number];

export type ReconcileItem =
  | { kind: "add-penalty"; pen: PenaltyPayload; reason: string }
  | { kind: "update-penalty"; index: number; changes: Partial<PenaltyPayload>; reason: string }
  | { kind: "remove-penalty"; index: number; reason: string }
  | {
      kind: "goalie-update";
      goalieIndex: number;
      changes: Partial<Pick<GoaliePayload, "toi" | "saves" | "goalsAgainst">>;
      reason: string;
    }
  | { kind: "add-goalie"; goalie: GoaliePayload; reason: string };

export type ReconcileItemWithStatus = ReconcileItem & {
  status: "pending" | "accepted" | "rejected";
};

export function buildReconcileDiff(
  official: OfficialProtocol,
  current: {
    penalties: CurrentPenalty[];
    goalies: CurrentGoalie[];
    homeTeam: string;
    awayTeam: string;
  },
): { items: ReconcileItem[]; matched: number } {
  const items: ReconcileItem[] = [];
  let matched = 0;

  const toSec = (t: string | null | undefined): number | null =>
    t && TIME_RE.test(t) ? parseMMSS(t) : null;

  const teamName = (side: Side) => (side === "home" ? current.homeTeam || "Хозяева" : current.awayTeam || "Гости");

  const playerByJersey = (side: Side, jersey: number | null): string => {
    if (jersey === null) return "";
    const r = official.roster.find((x) => x.side === side && x.jersey === jersey);
    return r ? r.name : `№${jersey}`;
  };

  const fmtPen = (p: { time: string; minutes: number; player: string }): string =>
    `${p.time || "—"}, ${p.minutes} мин${p.player ? `, ${p.player}` : ", командный штраф"}`;

  // ---- удаления ----
  for (const side of ["home", "away"] as Side[]) {
    const curIdx = current.penalties
      .map((p, index) => ({ p, index }))
      .filter((x) => x.p.side === side);
    const used = new Set<number>();

    const officials = official.penalties.filter((p) => p.side === side);
    for (const o of officials) {
      const oSec = toSec(o.time);
      const oName = playerByJersey(side, o.jersey);
      const oPlayer = o.jersey === null ? "" : oName;
      const label = `«${teamName(side)}» ${fmtPen({ time: o.time, minutes: o.minutes, player: oPlayer })}${
        o.infraction ? ` (${o.infraction}${o.infractionFull ? ` — ${o.infractionFull}` : ""})` : ""
      }`;

      // 1) точное совпадение: время ±2с и те же минуты
      let exact: { p: CurrentPenalty; index: number } | null = null;
      let best: { p: CurrentPenalty; index: number; diff: number } | null = null;
      for (const c of curIdx) {
        if (used.has(c.index)) continue;
        const cSec = toSec(c.p.time);
        if (oSec === null || cSec === null) continue;
        const diff = Math.abs(cSec - oSec);
        if (c.p.minutes === o.minutes && diff <= 2) {
          exact = c;
          break;
        }
        if (c.p.minutes === o.minutes && diff <= 180 && (!best || diff < best.diff)) {
          best = { p: c.p, index: c.index, diff };
        }
      }

      if (exact) {
        used.add(exact.index);
        matched += 1;
        // при точном совпадении времени подскажем заполнить игрока, если его не было
        if (o.jersey !== null && !exact.p.player && oName && !/^№\d+$/.test(oName)) {
          items.push({
            kind: "update-penalty",
            index: exact.index,
            changes: { player: oName },
            reason: `Для удаления ${label} в базе не указан игрок. Заполнить по номеру ${o.jersey}?`,
          });
        }
        continue;
      }

      if (best) {
        used.add(best.index);
        matched += 1;
        items.push({
          kind: "update-penalty",
          index: best.index,
          changes: { time: o.time, period: o.period },
          reason: `Время удаления не совпадает: в базе ${best.p.time || "—"}, в официальном протоколе ${o.time}. ${label}. Принять изменение?`,
        });
        continue;
      }

      // 2) нового наказания нет в базе — например, командный штраф
      const isTeamPen = o.jersey === null;
      items.push({
        kind: "add-penalty",
        pen: {
          side,
          period: o.period,
          time: o.time,
          minutes: o.minutes,
          player: oPlayer,
          infraction: o.infractionFull || o.infraction,
          coincidental: false,
          penaltyShot: o.minutes === 0,
        },
        reason: `${isTeamPen ? "Найден КОМАНДНЫЙ штраф" : "Найдено удаление"}, которого нет в базе: ${label}. Добавить?`,
      });
    }

    // 3) удаления в базе, которых нет в официальном протоколе
    for (const c of curIdx) {
      if (used.has(c.index)) continue;
      items.push({
        kind: "remove-penalty",
        index: c.index,
        reason: `Удаление ${teamName(side)} ${fmtPen(c.p)} есть в базе, но отсутствует в официальном протоколе. Удалить?`,
      });
    }
  }

  // ---- вратари: фактическое время (МВИ), сейвы и пропущенные ----
  for (const og of official.goalies) {
    const dbGoalie = current.goalies.find(
      (g) => g.side === og.side && (g.jersey === og.jersey || (g.jersey === null && current.goalies.filter((x) => x.side === og.side).length === 1)),
    );
    const gName =
      official.roster.find((r) => r.side === og.side && r.jersey === og.jersey)?.name ?? `№${og.jersey}`;
    const label = `вратарь ${gName} («${teamName(og.side)}», №${og.jersey})`;

    if (!dbGoalie) {
      const rosterEntry = official.roster.find((r) => r.side === og.side && r.jersey === og.jersey);
      items.push({
        kind: "add-goalie",
        goalie: {
          side: og.side,
          jersey: og.jersey,
          name: rosterEntry?.name ?? `№${og.jersey}`,
          toi: og.toi,
          saves: og.saves ?? 0,
          goalsAgainst: og.goalsAgainst,
          result: "",
          goals: 0,
          assists: 0,
          shots: 0,
          shotsOnGoal: 0,
          hits: 0,
          blocks: 0,
          pim: 0,
          periodToi: [],
        },
        reason: `${label} есть в официальном протоколе (МВИ ${og.toi}), но отсутствует в базе. Добавить?`,
      });
      continue;
    }

    const changes: Partial<Pick<GoaliePayload, "toi" | "saves" | "goalsAgainst">> = {};
    const notes: string[] = [];
    if (parseMMSS(og.toi) !== dbGoalie.toiSeconds) {
      changes.toi = og.toi;
      const cur = `${Math.floor(dbGoalie.toiSeconds / 60)}:${String(dbGoalie.toiSeconds % 60).padStart(2, "0")}`;
      notes.push(`время: в базе ${cur}, по протоколу (МВИ) ${og.toi}`);
    }
    if (og.saves !== null && og.saves !== dbGoalie.saves) {
      changes.saves = og.saves;
      notes.push(`сейвы: в базе ${dbGoalie.saves}, по протоколу ${og.saves}`);
    }
    if (og.goalsAgainst !== dbGoalie.goalsAgainst) {
      changes.goalsAgainst = og.goalsAgainst;
      notes.push(`пропущено: в базе ${dbGoalie.goalsAgainst}, по протоколу ${og.goalsAgainst}`);
    }
    if (notes.length) {
      items.push({
        kind: "goalie-update",
        goalieIndex: dbGoalie.index,
        changes,
        reason: `Расхождения для ${label}: ${notes.join("; ")}. Принять значения из официального протокола?`,
      });
    }
  }

  // сортировка: сначала новые/изменения по времени, затем удаления, затем вратари
  const order: Record<ReconcileItem["kind"], number> = {
    "add-penalty": 0,
    "update-penalty": 1,
    "remove-penalty": 2,
    "goalie-update": 3,
    "add-goalie": 4,
  };
  items.sort((a, b) => order[a.kind] - order[b.kind]);

  return { items, matched };
}

/**
 * Перемаркировка обоюдных удалений после изменений (то же правило, что в парсере:
 * пара штрафов разных команд в одно время (±2 с) одинаковой длительности).
 */
export function remarkCoincidental<T extends { side: Side; time: string; minutes: number; coincidental: boolean; penaltyShot: boolean }>(
  pens: T[],
): T[] {
  const out = pens.map((q) => ({ ...q, coincidental: false }));
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    if (a.penaltyShot || !TIME_RE.test(a.time)) continue;
    for (let j = i + 1; j < out.length; j++) {
      const b = out[j];
      if (b.penaltyShot || b.side === a.side || b.minutes !== a.minutes || !TIME_RE.test(b.time)) continue;
      if (Math.abs(parseMMSS(a.time) - parseMMSS(b.time)) <= 2) {
        a.coincidental = true;
        b.coincidental = true;
      }
    }
  }
  return out;
}
