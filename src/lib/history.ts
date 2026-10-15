/**
 * Архив старых протоколов hockey.by (официальный протокол
 * /new-admin/games/<id>/?print=protocol) и составы на предстоящий матч
 * (/new-admin/games/<id>/?print=teams). Только разбор — существующие
 * расчёты не используются и не меняются.
 */
import * as cheerio from "cheerio";
import { cleanName, parseMMSS, toInt } from "./clean";
import { parseOfficialProtocolHtml } from "./official";
import { nameKey } from "./seasonStats";
import { parseHistoricDetails, type HistDetails } from "./histDetails";

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

/** Имя без ударений (на hockey.by в составах встречаются «Левко́ Алекса́ндр») и без пометок (Л)/(Д). */
export function plainName(raw: string): string {
  return cleanName(raw.normalize("NFD").replace(/[\u0301\u0300]/g, "").normalize("NFC"));
}
export const playerKey = (raw: string) => nameKey(plainName(raw));

/** Ключ команды для сопоставления названий разных лет: «Динамо-Молодечно» ≈ «ДНМ-Молодечно». */
export function teamKey(t: string): string {
  return t
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/["«»']/g, "")
    .replace(/\bг\.\s*/g, "")
    .replace(/^динамо-/, "днм-")
    .replace(/\s+/g, " ")
    .trim();
}
export function sameTeam(a: string, b: string): boolean {
  const x = teamKey(a);
  const y = teamKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const fx = x.split(/[\s-]/)[0];
  const fy = y.split(/[\s-]/)[0];
  // «Металлург» ≈ «Металлург Жлобин», «Юность» ≈ «Юность-Минск»; «днм-…» сравниваем целиком
  if (fx === "днм" || fy === "днм") return x.startsWith(y) || y.startsWith(x);
  return fx === fy && fx.length >= 4;
}

/** «2018-2019» по дате матча (сезон начинается в августе). */
export function seasonOf(isoDate: string): string {
  const y = parseInt(isoDate.slice(0, 4), 10);
  const m = parseInt(isoDate.slice(5, 7), 10);
  return m >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

const ruDate = (s: string): string | null => {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

export async function fetchHtml(url: string, timeoutMs = 20000): Promise<string> {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { "User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9", Accept: "text/html" },
        cache: "no-store",
      });
      if (res.status === 404) throw new Error("страница не найдена (404)");
      if (!res.ok) {
        last = `HTTP ${res.status}`;
        continue;
      }
      return await res.text();
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      if (/404/.test(last)) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(last || "не удалось загрузить страницу");
}

type Row = string[];
function tables(html: string): Row[][] {
  const $ = cheerio.load(html);
  const out: Row[][] = [];
  $("table").each((_i, el) => {
    const root = $(el).find("table").length ? $(el).clone() : $(el);
    if ($(el).find("table").length) root.find("table").remove();
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

// ---------------------------------------------------------------------------
// Старый (официальный) протокол
// ---------------------------------------------------------------------------

export type HistParsed = {
  extId: number;
  sourceUrl: string;
  date: string;
  season: string;
  competition: string | null;
  gameNo: string | null;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  attendance: number | null;
  players: {
    side: "home" | "away"; name: string; nameKey: string; jersey: number | null; position: string;
    played: boolean; goals: number; assists: number; ppGoals: number; shGoals: number; pim: number;
  }[];
  goalies: {
    side: "home" | "away"; name: string; nameKey: string; jersey: number | null;
    toiSeconds: number; goalsAgainst: number; saves: number | null; won: boolean;
  }[];
  /** Подробности для карточки матча (новое поле, на расчёты не влияет). */
  details?: HistDetails | null;
};

/** id игры из ссылки …/new-admin/games/11575/?print=protocol */
export function protocolIdFromUrl(raw: string): number | null {
  const m = /games\/(\d+)/.exec(raw);
  if (m) return parseInt(m[1], 10);
  const n = parseInt(raw.trim(), 10);
  return Number.isFinite(n) && /^\d+$/.test(raw.trim()) ? n : null;
}
export const protocolUrl = (id: number) => `https://hockey.by/new-admin/games/${id}/?print=protocol`;

export function parseHistoricProtocol(html: string, extId: number, sourceUrl: string): HistParsed {
  if (!/ОФИЦИАЛЬНЫЙ ПРОТОКОЛ|Взятие ворот/i.test(html)) throw new Error("не похоже на официальный протокол");
  const off = parseOfficialProtocolHtml(html);
  const ts = tables(html);

  let competition: string | null = null;
  let date: string | null = null;
  let gameNo: string | null = null;
  let attendance: number | null = null;
  for (const t of ts) {
    for (const r of t) {
      for (let i = 0; i + 1 < r.length; i++) {
        if (r[i] === "Вид соревнования" && !competition) competition = r[i + 1] || null;
        if (r[i] === "Дата" && !date) date = ruDate(r[i + 1]);
        if (r[i] === "Игра №" && !gameNo) gameNo = r[i + 1] || null;
        if (r[i] === "Зрители" && attendance === null) {
          const n = parseInt(r[i + 1].replace(/\D/g, ""), 10);
          attendance = Number.isFinite(n) ? n : null;
        }
      }
    }
  }
  if (!date) throw new Error("в протоколе нет даты");

  // составы (с флагом «Игр.») и голы — по порядку таблиц документа
  type P = HistParsed["players"][number];
  const players: P[] = [];
  let rosterCount = 0;
  let side: "home" | "away" = "home";
  let score: { h: number; a: number } | null = null;
  const goalRows: { side: "home" | "away"; g: number; a1: number; a2: number; is: string }[] = [];
  for (const t of ts) {
    const head = t.slice(0, 2).map((r) => r.join("|")).join("§");
    if (/Фамилия/.test(head) && /Поз/.test(head) && /Игр/.test(head)) {
      rosterCount += 1;
      side = rosterCount === 1 ? "home" : "away";
      for (const r of t) {
        if (!/^\d{1,2}$/.test(r[0] ?? "")) continue;
        const pos = (r[2] ?? "").trim();
        if (!/^[ВЗН]$/.test(pos)) continue;
        const name = plainName(r[1] ?? "");
        if (!name) continue;
        players.push({
          side, name, nameKey: nameKey(name), jersey: toInt(r[0]), position: pos,
          played: !/^нет$/i.test((r[r.length - 1] ?? "").trim()),
          goals: 0, assists: 0, ppGoals: 0, shGoals: 0, pim: 0,
        });
      }
      continue;
    }
    if (/^#\|Время\|Г\|A1|^#\|Время\|Г\|А1/.test(t[0]?.join("|") ?? "")) {
      for (const r of t.slice(1)) {
        if (!/^\d+$/.test(r[0] ?? "") || !/^\d{1,3}:\d{2}$/.test(r[1] ?? "")) continue;
        const is = (r[5] ?? "").toUpperCase();
        if (/СПБ|БУЛ/.test(is)) continue;
        goalRows.push({ side, g: toInt(r[2]), a1: toInt(r[3]), a2: toInt(r[4]), is });
      }
      continue;
    }
    for (const r of t) {
      if (r[0] === "Всего" && r[1] && /\d+\s*:\s*\d+/.test(r[1]) && !score) {
        const m = /(\d+)\s*:\s*(\d+)/.exec(r[1])!;
        score = { h: parseInt(m[1], 10), a: parseInt(m[2], 10) };
      }
    }
  }
  const find = (s: "home" | "away", jersey: number) => players.find((p) => p.side === s && p.jersey === jersey);
  for (const g of goalRows) {
    const sc = g.g ? find(g.side, g.g) : undefined;
    if (sc) {
      sc.goals += 1;
      if (/^\+/.test(g.is)) sc.ppGoals += 1;
      if (/^[-–−]\d/.test(g.is)) sc.shGoals += 1;
    }
    for (const a of [g.a1, g.a2]) {
      const p = a ? find(g.side, a) : undefined;
      if (p) p.assists += 1;
    }
  }
  for (const pen of off.penalties) {
    if (pen.jersey === null) continue;
    const p = find(pen.side, pen.jersey);
    if (p) p.pim += pen.minutes;
  }
  if (!score) {
    score = {
      h: goalRows.filter((g) => g.side === "home").length,
      a: goalRows.filter((g) => g.side === "away").length,
    };
  }
  const homeTeam = off.homeTeam || "Хозяева";
  const awayTeam = off.awayTeam || "Гости";
  const goalies: HistParsed["goalies"] = off.goalies.map((g) => {
    const p = find(g.side, g.jersey);
    const name = p?.name ?? `Вратарь №${g.jersey}`;
    const won = g.side === "home" ? score!.h > score!.a : score!.a > score!.h;
    return {
      side: g.side, name, nameKey: nameKey(name), jersey: g.jersey,
      toiSeconds: parseMMSS(g.toi), goalsAgainst: g.goalsAgainst, saves: g.saves, won,
    };
  });
  // вратари в составе — это не полевые игроки
  const fieldPlayers = players.filter((p) => p.position !== "В");
  // подробности для карточки матча — отдельно, ошибки разбора не мешают импорту
  let details: HistDetails | null = null;
  try {
    details = parseHistoricDetails(html);
  } catch (e) {
    console.error("[history] подробности протокола:", e);
  }
  return {
    extId, sourceUrl, date, season: seasonOf(date), competition, gameNo,
    homeTeam, awayTeam, homeScore: score.h, awayScore: score.a, attendance,
    players: fieldPlayers, goalies, details,
  };
}

// ---------------------------------------------------------------------------
// Предстоящий матч: gamecenter → составы (print=teams)
// ---------------------------------------------------------------------------

export type RosterPlayer = { name: string; key: string; jersey: number | null; position: string; birthDate: string | null };
export type UpcomingGame = {
  gamecenterUrl: string;
  gameId: number | null;
  homeTeam: string;
  awayTeam: string;
  date: string | null;
  time: string | null;
  arena: string | null;
  competition: string | null;
  gameNo: string | null;
  roster: { home: RosterPlayer[]; away: RosterPlayer[] };
};

export function parseTeamsPage(html: string): Omit<UpcomingGame, "gamecenterUrl" | "gameId"> {
  const ts = tables(html);
  let homeTeam = "";
  let awayTeam = "";
  let date: string | null = null;
  let time: string | null = null;
  let arena: string | null = null;
  let gameNo: string | null = null;
  const roster: UpcomingGame["roster"] = { home: [], away: [] };
  let rc = 0;
  for (const t of ts) {
    const head = t[0]?.join("|") ?? "";
    if (/Хозяева/.test(head)) {
      for (const r of t) {
        for (const c of r) {
          if (/^Хозяева\s/.test(c) && !homeTeam) homeTeam = c.replace(/^Хозяева\s+/, "").trim();
          if (/^Гости\s/.test(c) && !awayTeam) awayTeam = c.replace(/^Гости\s+/, "").trim();
          if (/^Дата\s/.test(c) && !date) date = ruDate(c);
          if (/^Время\s/.test(c) && !time) time = c.replace(/^Время\s+/, "").trim() || null;
          if (/^Арена\s/.test(c) && !arena) arena = c.replace(/^Арена\s+/, "").trim() || null;
          if (/^Игра №/.test(c) && !gameNo) gameNo = c.replace(/^Игра №\s*/, "").trim() || null;
        }
      }
      continue;
    }
    if (/Фамилия/.test(head) && /^П\./.test(head)) {
      rc += 1;
      const side = rc === 1 ? "home" : "away";
      for (const r of t.slice(1)) {
        const pos = (r[0] ?? "").trim();
        if (!/^[ВЗН]$/.test(pos)) continue;
        const name = plainName(r[2] ?? "");
        if (!name) continue;
        roster[side].push({
          name, key: nameKey(name), jersey: /^\d+$/.test(r[1] ?? "") ? toInt(r[1]) : null, position: pos,
          birthDate: ruDate(r[4] ?? ""),
        });
      }
    }
  }
  const $ = cheerio.load(html);
  $("style, script").remove();
  const title = $("body").text().replace(/\s+/g, " ");
  const comp = /^\s*(.+?)\s+-\s+Составы команд/.exec(title);
  return { homeTeam, awayTeam, date, time, arena, gameNo, competition: comp ? comp[1].trim() : null, roster };
}

export async function fetchUpcomingGame(rawUrl: string): Promise<UpcomingGame> {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    throw new Error("Некорректная ссылка");
  }
  if (!/hockey\.by$/i.test(u.hostname)) throw new Error("Ссылка должна вести на hockey.by");
  let gameId: number | null = null;
  const direct = /new-admin\/games\/(\d+)/.exec(u.pathname);
  if (direct) gameId = parseInt(direct[1], 10);
  else {
    const html = await fetchHtml(u.toString());
    const m = /new-admin\/games\/(\d+)\/\?print=(?:teams|protocol|pdfstat)/.exec(html);
    if (m) gameId = parseInt(m[1], 10);
    if (!gameId) throw new Error("На странице матча не нашлась ссылка на составы (print=teams)");
  }
  const teamsHtml = await fetchHtml(`https://hockey.by/new-admin/games/${gameId}/?print=teams`);
  const parsed = parseTeamsPage(teamsHtml);
  if (!parsed.homeTeam || !parsed.awayTeam) throw new Error("Не удалось определить команды матча");
  return { gamecenterUrl: u.toString(), gameId, ...parsed };
}
