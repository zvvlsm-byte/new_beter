import { cleanName, parseMMSS, parseRuDate, periodFromTime, toInt, todayISO } from "./clean";
import { markCoincidental } from "./parse";
import { stageFromText } from "./seasonStats";
import type { ParsedGoal, ParsedGoalie, ParsedMatch, ParsedPenalty, ParsedSkater, Side } from "./types";
import { emptyParsed } from "./types";

export type TextItem = { s: string; x: number; y: number };

type Row = { y: number; items: { s: string; x: number }[] };

const PLAYER_ANCHORS: { key: string; labels: string[] }[] = [
  { key: "goals", labels: ["Ш"] },
  { key: "assists", labels: ["А"] },
  { key: "plusMinus", labels: ["+/-"] },
  { key: "pim", labels: ["Штр"] },
  { key: "toi", labels: ["Всего"] },
  { key: "shifts", labels: ["См"] },
  { key: "shots", labels: ["Б"] },
  { key: "sog", labels: ["Бс"] },
  { key: "blocks", labels: ["БлБ"] },
  { key: "hits", labels: ["Сп"] },
  { key: "fo", labels: ["Вбр"] },
  { key: "fow", labels: ["ВВбр"] },
];

function buildRows(items: TextItem[]): Row[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Row[] = [];
  for (const it of sorted) {
    const s = it.s.replace(/\s+/g, " ").trim();
    if (!s) continue;
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - it.y) <= 4) last.items.push({ s, x: it.x });
    else rows.push({ y: it.y, items: [{ s, x: it.x }] });
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

function rowText(r: Row): string {
  return r.items.map((i) => i.s).join(" ");
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, "е");
}

/** Парсинг протокола из текста (вытащенного из PDF или вставленного вручную). */
export function parseProtocolText(rawItems: TextItem[] | string[], sourceUrl = ""): ParsedMatch {
  const res = emptyParsed();
  res.sourceUrl = sourceUrl;
  const items: TextItem[] =
    typeof (rawItems as TextItem[])[0] === "string"
      ? (rawItems as string[]).map((line, i) => ({ s: line, x: 0, y: i * 10 }))
      : (rawItems as TextItem[]);
  const rows = buildRows(items);
  const text = rows.map(rowText).join("\n");

  // ---- дата и тип времени ----
  res.date = parseRuDate(text) ?? todayISO();
  const attM = text.match(/(\d[\d\s]{0,7})\s*зрител/i);
  res.attendance = attM ? parseInt(attM[1].replace(/\s/g, ""), 10) || null : null;
  if (/буллит/i.test(text)) res.winType = "so";
  else if (/овертайм|дополнительное время/i.test(text)) res.winType = "ot";
  res.stage = stageFromText(text.slice(0, 8000), "regular");

  // ---- команды и счёт из шапки ----
  const broskiIdx = rows.findIndex((r) => /БРОСКИ/.test(rowText(r)));
  const headRows = broskiIdx > 0 ? rows.slice(0, broskiIdx) : rows.slice(0, 25);
  const scores: number[] = [];
  for (const r of headRows) {
    const t = rowText(r);
    if (/^\d{1,2}$/.test(t) && scores.length < 2) scores.push(toInt(t));
  }
  if (scores.length >= 2) {
    res.homeScore = scores[0];
    res.awayScore = scores[1];
  }
  const teamCandidates = headRows
    .map(rowText)
    .filter((t) => /^[А-ЯЁA-Z][а-яёА-ЯЁA-Za-z\- ]{2,30}$/.test(t.trim()))
    .filter((t) => !/ХОЗЯЕВА|ГОСТИ|этап|Игра|статистич|отчет|отчёт|этапа|турнир|лига|кубок/i.test(t));
  if (teamCandidates.length >= 2) {
    res.homeTeam = teamCandidates[0].trim();
    res.awayTeam = teamCandidates[1].trim();
  }

  const home = norm(res.homeTeam);
  const away = norm(res.awayTeam);
  let seenPlayerTables = 0;
  const sideByOrder = (order: number): Side => (order === 0 ? "home" : "away");
  const sideOfName = (name: string, order: number): Side => {
    const n = norm(name);
    if (n && n === home) return "home";
    if (n && n === away) return "away";
    return sideByOrder(order);
  };

  const anchorsBySection = new Map<number, { key: string; x: number }[]>();

  for (let ri = 0; ri < rows.length; ri++) {
    const t = rowText(rows[ri]);

    // ---- голы: "1 1 - 0 02:07 РС Шахтер 19 Рядченко Владислав ..." ----
    const goalM = t.match(
      /^(\d+)\s+(\d+)\s*-\s*(\d+)\s+(\d{1,2}:\d{2})\s+(\S+)\s+(\S+)\s+(.+)$/,
    );
    if (goalM && /^\d+$/.test(goalM[1])) {
      const teamCell = goalM[5];
      const rest = goalM[7];
      const players = [...rest.matchAll(/(\d{1,2})\s+([А-ЯЁ][^,|]*?)(?=\s+\d{1,2}\s+[А-ЯЁ]|$)/g)]
        .map((m) => cleanName(m[2]))
        .filter(Boolean);
      const rawStrength = goalM[6];
      let strength: ParsedGoal["strength"] = "eq";
      if (/^\+/.test(rawStrength)) strength = "pp";
      else if (/^-/.test(rawStrength)) strength = "sh";
      res.goals.push({
        side: sideOfName(teamCell, res.goals.length ? 99 : 0),
        period: periodFromTime(goalM[4]),
        time: goalM[4],
        strength,
        emptyNet: /пв|п\.в|пуст/i.test(rawStrength),
        scorer: players[0] ?? "",
        assist1: players[1] ?? "",
        assist2: players[2] ?? "",
        rawStrength,
      });
      continue;
    }

    // ---- удаления: "1 3 42:34 22 Ярута Кирилл 2 Задержка клюшкой" ----
    const penM = t.match(/^(\d+)\s+(\d)\s+(\d{1,2}:\d{2})\s+(.+?)\s+(\d{1,2})\s+(.+)$/);
    if (penM && rows.slice(Math.max(0, ri - 14), ri).some((r) => /УДАЛЕНИЯ|Причина/.test(rowText(r)))) {
      // определить команду: ближайшая строка выше, совпадающая с именем команды
      let side: Side = "home";
      for (let k = ri - 1; k >= Math.max(0, ri - 20); k--) {
        const tk = norm(rowText(rows[k]));
        if (home && tk.includes(home)) {
          side = "home";
          break;
        }
        if (away && tk.includes(away)) {
          side = "away";
          break;
        }
      }
      const playerRaw = penM[4].trim();
      const isTeam = /командн|тренер/i.test(playerRaw);
      const minutesVal = toInt(penM[5]);
      res.penalties.push({
        side,
        // период — из игрового времени удаления, колонка протокола как запасной вариант
        period: periodFromTime(penM[3]) || toInt(penM[2]),
        time: penM[3],
        // «0» минут = штрафной бросок (ШБ)
        minutes: minutesVal,
        player: isTeam ? "" : cleanName(playerRaw),
        infraction: penM[6].trim(),
        coincidental: false,
        penaltyShot: minutesVal === 0,
      } satisfies ParsedPenalty);
      continue;
    }

    // ---- периоды: "1 1 21 0 0 1 0 9 0 0" (Пер Голы Бс У Штр Пер Голы Бс У Штр) ----
    const perM = t.match(/^(\d)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/);
    if (perM && rows.slice(Math.max(0, ri - 10), ri).some((r) => /ПЕРИОДЫ/.test(rowText(r)))) {
      if (parseInt(perM[1], 10) === res.periods.length + 1) {
        res.periods.push({ h: toInt(perM[2]), hSog: toInt(perM[3]), a: toInt(perM[7]), aSog: toInt(perM[8]) });
      }
      continue;
    }

    // ---- заголовок таблицы игроков: запомнить x-координаты колонок ----
    if (rows[ri].items.some((i) => i.s === "БлБ") && rows[ri].items.some((i) => i.s === "Штр")) {
      const anchors: { key: string; x: number }[] = [];
      for (const a of PLAYER_ANCHORS) {
        const it = rows[ri].items.find((i) => a.labels.includes(i.s));
        if (it) anchors.push({ key: a.key, x: it.x });
      }
      if (anchors.length >= 4) {
        anchorsBySection.set(ri, anchors);
        seenPlayerTables += 1;
        // команда: строка выше с именем
        let teamRow = "";
        for (let k = ri - 1; k >= Math.max(0, ri - 3); k--) {
          const cand = rowText(rows[k]).trim();
          if (/^[А-ЯЁA-Z][а-яёА-ЯЁA-Za-z\- ]{2,30}$/i.test(cand) && !/СТАТИСТИКА|Всего|Игроков/i.test(cand)) {
            teamRow = cand;
            break;
          }
        }
        (rows[ri] as Row & { team?: string }).team = teamRow;
      }
      continue;
    }

    // ---- строка игрока/вратаря внутри секции ----
    const active = [...anchorsBySection.entries()]
      .filter(([hr]) => ri > hr && ri - hr < 60)
      .sort((a, b) => b[0] - a[0])[0];
    if (active && /^\d{1,2}$/.test(rows[ri].items[0]?.s ?? "")) {
      const [headerRow, anchors] = active;
      const section = rows[headerRow] as Row & { team?: string };
      const side = sideOfName(section.team ?? "", seenPlayerTables <= 1 && headerRow < ri ? seenPlayerTables - 1 : 1);
      const its = rows[ri].items;
      const jersey = toInt(its[0].s);
      const pos = its[1]?.s ?? "";
      if (!/^[ВЗН]$/.test(pos)) continue;
      // имя: самая длинная ячейка до первого якоря
      const minX = Math.min(...anchors.map((a) => a.x)) - 6;
      const nameItems = its.slice(2).filter((i) => i.x < minX);
      const rawName = nameItems.map((i) => i.s).join(" ").trim();
      if (!rawName) continue;
      const vals: Record<string, string> = {};
      for (const it of its) {
        if (it.x < minX) continue;
        if (/^\d:\d{2}\s*\(\d+\)$/.test(it.s)) continue; // смены по периодам
        let best: { key: string; d: number } | null = null;
        for (const a of anchors) {
          const d = Math.abs(it.x - a.x);
          if (d <= 14 && (!best || d < best.d)) best = { key: a.key, d };
        }
        if (best) vals[best.key] = it.s;
      }
      const toiSec = parseMMSS(vals.toi);
      if (pos === "В") {
        // у вратаря тоже могут быть силовые, блоки, броски, передачи — учитываем
        res.goalies[side].push({
          jersey,
          rawName,
          name: cleanName(rawName),
          toi: `${Math.floor(toiSec / 60)}:${String(toiSec % 60).padStart(2, "0")}`,
          saves: 0,
          goalsAgainst: 0,
          result: "",
          goals: toInt(vals.goals),
          assists: toInt(vals.assists),
          shots: toInt(vals.shots),
          shotsOnGoal: toInt(vals.sog),
          hits: toInt(vals.hits),
          blocks: toInt(vals.blocks),
          pim: toInt(vals.pim),
          periodToi: [],
        } satisfies ParsedGoalie);
      } else {
        res.skaters[side].push({
          jersey,
          position: pos,
          rawName,
          name: cleanName(rawName),
          goals: toInt(vals.goals),
          assists: toInt(vals.assists),
          plusMinus: toInt((vals.plusMinus ?? "").replace("+", "")),
          shots: toInt(vals.shots),
          shotsOnGoal: toInt(vals.sog),
          hits: toInt(vals.hits),
          blocks: toInt(vals.blocks),
          pim: toInt(vals.pim),
          toi: vals.toi ?? "",
          faceoffs: toInt(vals.fo),
          faceoffWins: toInt(vals.fow),
          periodToi: [],
        } satisfies ParsedSkater);
      }
      continue;
    }
  }

  markCoincidental(res.penalties);

  // ---- контрольные проверки ----
  if (!res.homeTeam || !res.awayTeam)
    res.warnings.push("Названия команд не распознаны автоматически — укажите вручную.");
  if (!res.skaters.home.length && !res.skaters.away.length)
    res.warnings.push("Составы не распознаны — заполните таблицу вручную.");
  const gH = res.goals.filter((g) => g.side === "home").length;
  const gA = res.goals.filter((g) => g.side === "away").length;
  if ((gH || gA) && (gH !== res.homeScore || gA !== res.awayScore))
    res.warnings.push(`Голы (${gH}:${gA}) не сходятся со счётом (${res.homeScore}:${res.awayScore}).`);
  return res;
}
