import * as cheerio from "cheerio";
import {
  GOALIE_HEADER_MAP,
  SKATER_HEADER_MAP,
  TIME_KEYS,
  guessStage,
  nameKey,
  normHeader,
  parseCell,
  type Stage,
  type Stats,
} from "./seasonStats";

export type ParsedPlayer = {
  name: string;
  nameKey: string;
  extId: string | null;
  jersey: number | null;
  position: string | null;
  birthDate: string | null;
  stats: Stats;
  extra: Record<string, string>;
};

export type ParsedTeamPage = {
  url: string;
  divisionId: number;
  commandId: number;
  season: string;
  league: string | null;
  divisionName: string | null;
  team: string;
  guessedStage: Stage;
  skaterColumns: string[];
  goalieColumns: string[];
  skaters: ParsedPlayer[];
  goalies: ParsedPlayer[];
};

/** Разбор ссылки вида https://hockey.by/statistic/competition/?division=493&command=4286 */
export function parseHockeyByUrl(raw: string): { url: string; division: number; command: number } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error(`Некорректная ссылка: ${raw}`);
  }
  if (!/hockey\.by$/i.test(u.hostname)) throw new Error("Ссылка должна вести на hockey.by");
  const division = parseInt(u.searchParams.get("division") ?? "", 10);
  const command = parseInt(u.searchParams.get("command") ?? "", 10);
  if (!division || !command) {
    throw new Error("В ссылке должны быть параметры division и command (выберите на сайте дивизион и команду)");
  }
  const url = `https://hockey.by/statistic/competition/?division=${division}&command=${command}`;
  return { url, division, command };
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export async function fetchHockeyByTeam(rawUrl: string): Promise<ParsedTeamPage> {
  const { url, division, command } = parseHockeyByUrl(rawUrl);
  let html = "";
  let lastStatus = 0;
  // сайт периодически отвечает 5xx — несколько повторных попыток
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1200 * attempt));
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
          "Accept-Language": "ru-RU,ru;q=0.9",
        },
        cache: "no-store",
      });
      lastStatus = res.status;
      if (res.ok) {
        html = await res.text();
        break;
      }
      if (res.status < 500) break;
    } catch {
      lastStatus = -1;
    }
  }
  if (!html) {
    throw new Error(
      lastStatus === -1
        ? "Не удалось связаться с hockey.by"
        : `hockey.by ответил ${lastStatus} (сайт временно недоступен — попробуйте позже)`,
    );
  }
  return parseHockeyByHtml(html, url, division, command);
}

export function parseHockeyByHtml(html: string, url: string, division: number, command: number): ParsedTeamPage {
  const $ = cheerio.load(html);
  const selectedText = (sel: string) => clean($(sel).find("option[selected]").first().text());

  const season = selectedText("#statFilter_season");
  const league = selectedText("#statFilter_league") || null;
  const divisionName = selectedText("#statFilter_division") || null;
  const team =
    clean($(`select[name=command] option[value="${command}"]`).first().text()) ||
    selectedText("select[name=command]");

  if (!/^\d{4}\D\d{4}$/.test(season)) throw new Error("Не удалось определить сезон на странице");
  if (!team) throw new Error("Не удалось определить команду на странице");

  const skaters: ParsedPlayer[] = [];
  const goalies: ParsedPlayer[] = [];
  let skaterColumns: string[] = [];
  let goalieColumns: string[] = [];

  $("table").each((_, table) => {
    const headers = $(table)
      .find("thead tr")
      .last()
      .find("th")
      .map((__, th) => clean($(th).text()))
      .get();
    if (!headers.length) return;
    const norm = headers.map(normHeader);
    if (!norm.includes("игрок")) return;
    const isGoalie = norm.includes("%об") || norm.includes("мин") || (norm.includes("пш") && !norm.includes("поз"));
    const map = isGoalie ? GOALIE_HEADER_MAP : SKATER_HEADER_MAP;
    const cols: string[] = [];

    $(table)
      .find("tbody tr")
      .each((__, tr) => {
        const tds = $(tr).find("td");
        if (tds.length < headers.length - 1) return;
        const p: ParsedPlayer = {
          name: "", nameKey: "", extId: null, jersey: null, position: null, birthDate: null, stats: {}, extra: {},
        };
        tds.each((i, td) => {
          const h = norm[i];
          const label = headers[i];
          const text = clean($(td).text());
          if (h === undefined) return;
          if (h === "№" || h === "#") {
            const n = parseInt(text, 10);
            p.jersey = Number.isNaN(n) ? null : n;
          } else if (h === "игрок") {
            p.name = text;
            const href = $(td).find("a").attr("href") ?? "";
            const m = /players\/(\d+)/.exec(href);
            p.extId = m ? m[1] : null;
          } else if (h === "возр" || h === "др" || h === "датарождения") {
            p.birthDate = text || null;
          } else if (h === "поз" || h === "амплуа") {
            p.position = text || null;
          } else {
            const key = map[h];
            if (key) {
              const v = parseCell(text, TIME_KEYS.has(key) || (isGoalie && key === "toi"));
              // ВБР одним числом (без ВБР−) и %, если уже есть «ВБР+» — не перетираем
              if (p.stats[key] == null) p.stats[key] = v;
              if (!cols.includes(key)) cols.push(key);
            } else if (label) {
              p.extra[label] = text;
            }
          }
        });
        if (!p.name) return;
        p.nameKey = nameKey(p.name);
        skaterOrGoalie(isGoalie ? goalies : skaters, p);
      });

    if (isGoalie) goalieColumns = cols;
    else skaterColumns = cols;
  });

  // на hockey.by в таблицу вратарей иногда попадают полевые игроки без игрового
  // времени (они же есть в таблице полевых) — такие строки отбрасываем
  const skaterKeys = new Set(skaters.map((p) => p.nameKey));
  for (let i = goalies.length - 1; i >= 0; i--) {
    const g = goalies[i].stats;
    const noPlay = !g.toi && !g.saves && !g.goalsAgainst && !g.shotsAgainst;
    if (noPlay && skaterKeys.has(goalies[i].nameKey)) goalies.splice(i, 1);
  }
  // %ОБ и КН при нуле бросков — показатель отсутствует, а не 0
  for (const p of goalies) {
    if (!p.stats.saves && !p.stats.goalsAgainst && !p.stats.shotsAgainst) {
      if ("savePct" in p.stats) p.stats.savePct = null;
      if ("gaa" in p.stats) p.stats.gaa = null;
    }
  }

  // столбцы, которые на странице есть, но у игроков не заполнены, тоже сохраняем
  for (const p of skaters) for (const k of skaterColumns) if (!(k in p.stats)) p.stats[k] = null;
  for (const p of goalies) for (const k of goalieColumns) if (!(k in p.stats)) p.stats[k] = null;

  return {
    url, divisionId: division, commandId: command, season: season.replace(/\D/, "-"), league, divisionName, team,
    guessedStage: guessStage(divisionName), skaterColumns, goalieColumns, skaters, goalies,
  };
}

function skaterOrGoalie(list: ParsedPlayer[], p: ParsedPlayer) {
  const dup = list.find((x) => x.nameKey === p.nameKey && x.extId === p.extId);
  if (!dup) list.push(p);
}
