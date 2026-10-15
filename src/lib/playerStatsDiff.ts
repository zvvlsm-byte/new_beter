/**
 * «Обновить статистику игроков»: сравнение сохранённых строк полевых игроков
 * с протоколом по ссылке. Затрагиваются ТОЛЬКО полевые игроки (статистика и
 * время на льду). Удаления (включая командные штрафы, вбитые вручную), голы,
 * вратари, счёт и зрители не трогаются.
 */
import type { SkaterGame, StatChange, StatFieldChange } from "@/db/schema";
import type { ParsedMatch } from "./types";
import { cleanName, formatMMSS, parseMMSS } from "./clean";
import { parseProtocolHtml } from "./parse";
import { nameKey } from "./seasonStats";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** Загрузка и разбор статистического протокола (как в существующем «обновить из протоколов»). */
export async function fetchStatProtocol(url: string): Promise<ParsedMatch> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "ru,en;q=0.8" },
      cache: "no-store",
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    if (!/СТАТИСТИКА ИГРОКОВ|Статистический отчет/i.test(html)) throw new Error("не похоже на статистический протокол");
    return parseProtocolHtml(html, url);
  } finally {
    clearTimeout(timer);
  }
}

type NumKey =
  | "goals" | "assists" | "plusMinus" | "shots" | "shotsOnGoal" | "hits" | "blocks"
  | "pim" | "toiSeconds" | "faceoffs" | "faceoffWins";

const FIELDS: { key: NumKey; label: string; time?: boolean }[] = [
  { key: "goals", label: "Г" },
  { key: "assists", label: "П" },
  { key: "plusMinus", label: "+/−" },
  { key: "shots", label: "Бр" },
  { key: "shotsOnGoal", label: "БрС" },
  { key: "hits", label: "Сп" },
  { key: "blocks", label: "БлБ" },
  { key: "pim", label: "Штр" },
  { key: "toiSeconds", label: "Время", time: true },
  { key: "faceoffs", label: "Вбр" },
  { key: "faceoffWins", label: "ВВбр" },
];

type MatchLite = { id: number; date: string; homeTeam: string; awayTeam: string };

export type NewSkaterRow = {
  matchId: number;
  side: "home" | "away";
  name: string;
  rawName: string | null;
  jersey: number | null;
  position: string | null;
  goals: number; assists: number; plusMinus: number; shots: number; shotsOnGoal: number;
  hits: number; blocks: number; pim: number; toiSeconds: number; faceoffs: number; faceoffWins: number;
  periodToi: number[] | null;
};

export function skaterRowsFromParsed(matchId: number, parsed: ParsedMatch): NewSkaterRow[] {
  const sides = ["home", "away"] as const;
  return sides.flatMap((side) =>
    parsed.skaters[side].map((s) => ({
      matchId,
      side,
      name: cleanName(s.name),
      rawName: s.rawName,
      jersey: s.jersey,
      position: s.position || null,
      goals: s.goals,
      assists: s.assists,
      plusMinus: s.plusMinus,
      shots: s.shots,
      shotsOnGoal: s.shotsOnGoal,
      hits: s.hits,
      blocks: s.blocks,
      pim: s.pim,
      toiSeconds: parseMMSS(s.toi),
      faceoffs: s.faceoffs,
      faceoffWins: s.faceoffWins,
      periodToi: s.periodToi.length ? s.periodToi : null,
    })),
  );
}

const samePeriods = (a: number[] | null, b: number[] | null) =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** Список изменений по одному матчу: обновления, новые и пропавшие из протокола игроки. */
export function diffMatchSkaters(m: MatchLite, current: SkaterGame[], fresh: NewSkaterRow[]): StatChange[] {
  const out: StatChange[] = [];
  const label = `${m.homeTeam} — ${m.awayTeam}`;
  const team = (side: "home" | "away") => (side === "home" ? m.homeTeam : m.awayTeam);
  const used = new Set<number>();
  const k = (side: string, name: string) => `${side}|${nameKey(cleanName(name))}`;
  const byName = new Map<string, SkaterGame>();
  for (const c of current) byName.set(k(c.side, c.name), c);

  for (const f of fresh) {
    let cur = byName.get(k(f.side, f.name));
    if (cur && used.has(cur.id)) cur = undefined;
    if (!cur && f.jersey !== null) {
      // запасной вариант: тот же номер в той же команде (например, опечатка в имени)
      cur = current.find((c) => c.side === f.side && c.jersey === f.jersey && !used.has(c.id) && !fresh.some((x) => x !== f && x.side === c.side && k(x.side, x.name) === k(c.side, c.name)));
    }
    if (!cur) {
      out.push({
        id: `add|${m.id}|${f.side}|${nameKey(f.name)}`,
        kind: "add", matchId: m.id, date: m.date, matchLabel: label, side: f.side, team: team(f.side),
        name: f.name, jersey: f.jersey, skaterId: null,
        fields: FIELDS.filter((x) => f[x.key]).map((x) => ({
          key: x.key, label: x.label, from: null, to: x.time ? formatMMSS(f[x.key]) : f[x.key],
        })),
        newRow: f as unknown as Record<string, unknown>,
        status: "pending",
      });
      continue;
    }
    used.add(cur.id);
    const fields: StatFieldChange[] = [];
    for (const x of FIELDS) {
      const a = cur[x.key];
      const b = f[x.key];
      if (a !== b) fields.push({ key: x.key, label: x.label, from: x.time ? formatMMSS(a) : a, to: x.time ? formatMMSS(b) : b });
    }
    if (!samePeriods(cur.periodToi, f.periodToi)) {
      fields.push({
        key: "periodToi", label: "Время по периодам",
        from: (cur.periodToi ?? []).map((s) => formatMMSS(s)).join(" / ") || "—",
        to: (f.periodToi ?? []).map((s) => formatMMSS(s)).join(" / ") || "—",
      });
    }
    if ((cur.jersey ?? null) !== (f.jersey ?? null)) fields.push({ key: "jersey", label: "№", from: cur.jersey, to: f.jersey });
    if ((cur.position ?? null) !== (f.position ?? null) && f.position) fields.push({ key: "position", label: "Поз", from: cur.position, to: f.position });
    if (fields.length) {
      out.push({
        id: `upd|${cur.id}`,
        kind: "update", matchId: m.id, date: m.date, matchLabel: label, side: cur.side, team: team(cur.side),
        name: cur.name, jersey: cur.jersey, skaterId: cur.id, fields,
        newRow: f as unknown as Record<string, unknown>,
        status: "pending",
      });
    }
  }
  for (const c of current) {
    if (used.has(c.id)) continue;
    out.push({
      id: `del|${c.id}`,
      kind: "remove", matchId: m.id, date: m.date, matchLabel: label, side: c.side, team: team(c.side),
      name: c.name, jersey: c.jersey, skaterId: c.id, fields: [], newRow: null, status: "pending",
    });
  }
  return out;
}
