"use client";

import { useEffect, useMemo, useState } from "react";
import {
  GOALIE_COLS,
  SKATER_COLS,
  STAGES,
  aggregateGoalies,
  aggregateSkaters,
  fmtStat,
  seasonLabel,
  seasonStartYear,
  stageShort,
  type SeasonsPayload,
  type Stage,
  type StatCol,
  type Stats,
} from "@/lib/seasonStats";

type Line = { label: string; sub: string; season: string; stage: string | null; stats: Stats };
type Sort = { key: string; dir: 1 | -1 } | null;

/** Плитки итоговой карточки — приоритетный набор показателей (выводятся только те, где есть данные). */
const SKATER_TILES = ["gp", "goals", "assists", "points", "plusMinus", "pim", "avgToi", "ppGoals", "shGoals", "sog", "shotPct", "foPct", "hits", "blocks", "gwg"];
const GOALIE_TILES = ["gp", "wins", "losses", "otLosses", "soLosses", "savePct", "gaa", "shutouts", "saves", "shotsAgainst", "goalsAgainst", "toi", "pim"];

/** Показатели, для которых в подписи плитки уместно среднее за игру. */
const PER_GAME = new Set(["goals", "assists", "points", "pim", "sog", "hits", "blocks", "saves", "shotsAgainst", "goalsAgainst"]);

const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
};

/** «За все сезоны»: архив hockey.by — итоговая карточка и раскрывающаяся разбивка по сезонам. */
export function SeasonHistory({ name, kind }: { name: string; kind: "skater" | "goalie" }) {
  const [data, setData] = useState<SeasonsPayload | null>(null);
  const [stage, setStage] = useState<"all" | Stage>("all");
  const [split, setSplit] = useState(false);
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<Sort>(null);

  useEffect(() => {
    let on = true;
    fetch(`/api/seasons/player?name=${encodeURIComponent(name)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => on && setData(d))
      .catch(() => on && setData(null));
    return () => {
      on = false;
    };
  }, [name]);

  const cols = kind === "skater" ? SKATER_COLS : GOALIE_COLS;
  const agg = kind === "skater" ? aggregateSkaters : aggregateGoalies;
  const tileKeys = kind === "skater" ? SKATER_TILES : GOALIE_TILES;

  const view = useMemo(() => {
    if (!data) return null;
    const impById = new Map(data.imports.map((i) => [i.id, i]));
    const rows = (kind === "skater" ? data.skaters : data.goalies)
      .map((r) => ({ r, imp: impById.get(r.importId) }))
      .filter((x) => x.imp && (stage === "all" || x.imp.stage === stage));
    if (!rows.length) {
      return { lines: [] as Line[], total: null as Stats | null, usedCols: [] as StatCol[], seasons: 0, teams: [] as string[] };
    }
    // группировка: сезон (или сезон + стадия)
    const groups = new Map<string, { season: string; stage: string | null; teams: Set<string>; stats: Stats[] }>();
    const allTeams = new Set<string>();
    const seasonSet = new Set<string>();
    for (const { r, imp } of rows) {
      if (!imp) continue;
      allTeams.add(imp.team);
      seasonSet.add(imp.season);
      const key = split ? `${imp.season}|${imp.stage}` : imp.season;
      let g = groups.get(key);
      if (!g) {
        g = { season: imp.season, stage: split ? imp.stage : null, teams: new Set(), stats: [] };
        groups.set(key, g);
      }
      g.teams.add(imp.team);
      g.stats.push(r.stats);
    }
    const order = (s: string | null) => STAGES.findIndex((x) => x.key === s);
    const lines: Line[] = [...groups.values()]
      .sort((a, b) => seasonStartYear(a.season) - seasonStartYear(b.season) || order(a.stage) - order(b.stage))
      .map((g) => ({
        label: seasonLabel(g.season) + (g.stage ? ` · ${stageShort(g.stage)}` : ""),
        sub: [...g.teams].join(", "),
        season: g.season,
        stage: g.stage,
        stats: agg(g.stats),
      }));
    const total = agg(rows.map((x) => x.r.stats));
    const usedCols = cols.filter((c) => lines.some((l) => l.stats[c.key] != null));
    return { lines, total, usedCols, seasons: seasonSet.size, teams: [...allTeams] };
  }, [data, stage, split, kind, cols, agg]);

  // сортировка разбивки: клик по столбцу — по убыванию, ещё раз — по возрастанию, третий — хронология
  const sortedLines = useMemo(() => {
    if (!view) return [];
    if (!sort) return view.lines;
    const { key, dir } = sort;
    const order = (s: string | null) => STAGES.findIndex((x) => x.key === s);
    return [...view.lines].sort((a, b) => {
      if (key === "season") {
        return (
          (seasonStartYear(a.season) - seasonStartYear(b.season) || order(a.stage) - order(b.stage)) * dir
        );
      }
      if (key === "team") return a.sub.localeCompare(b.sub, "ru") * dir;
      const av = a.stats[key];
      const bv = b.stats[key];
      // «—» (нет данных) всегда внизу независимо от направления
      const aNull = av == null || !Number.isFinite(av);
      const bNull = bv == null || !Number.isFinite(bv);
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      return ((av as number) - (bv as number)) * dir || seasonStartYear(a.season) - seasonStartYear(b.season);
    });
  }, [view, sort]);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: -1 } : s.dir === -1 ? { key, dir: 1 } : null));
  const arrow = (key: string) => (sort?.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : "");

  if (!data) return null;
  const hasAny = (kind === "skater" ? data.skaters : data.goalies).length > 0;

  const tiles =
    view && view.total
      ? tileKeys
          .map((k) => cols.find((c) => c.key === k))
          .filter((c): c is StatCol => !!c && view.usedCols.some((u) => u.key === c.key))
          .map((c) => {
            const v = view.total?.[c.key];
            const gp = view.total?.gp;
            let sub = c.title;
            if (PER_GAME.has(c.key) && typeof v === "number" && typeof gp === "number" && gp > 0) {
              sub = `${(v / gp).toFixed(2)} за игру`;
            }
            return { key: c.key, label: c.label, title: c.title, value: fmtStat(v, c.kind, c.key), sub };
          })
      : [];

  return (
    <section className="mt-6 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line pb-1.5">
        <div>
          <h4 className="text-sm font-extrabold tracking-wide uppercase">За все сезоны</h4>
          <p className="text-xs text-ink-soft">
            Архив hockey.by и текущий сезон из протоколов. «—» — показатель в том сезоне не вёлся и в итог не входит.
          </p>
        </div>
        {hasAny && (
          <div className="flex flex-wrap items-center gap-1">
            {[{ key: "all", short: "Все стадии" }, ...STAGES].map((s) => (
              <button
                key={s.key}
                onClick={() => setStage(s.key as "all" | Stage)}
                className={`rounded px-2 py-1 text-xs font-semibold ${stage === s.key ? "bg-ink text-white" : "bg-paper text-ink-soft hover:text-ink"}`}
              >
                {s.short}
              </button>
            ))}
          </div>
        )}
      </div>

      {!hasAny && (
        <p className="py-3 text-sm text-ink-soft">
          Архивной статистики пока нет — загрузите прошлые сезоны в разделе «Статистика за сезоны».
        </p>
      )}
      {hasAny && view && view.lines.length === 0 && (
        <p className="py-3 text-sm text-ink-soft">Нет данных для выбранной стадии.</p>
      )}

      {view && view.lines.length > 0 && view.total && (
        <>
          {/* Итоговая карточка — как «Рекорды» */}
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-md border border-ice bg-ice-soft px-3 py-2">
              <div className="text-[10px] font-bold tracking-wide text-ink-soft uppercase">Сезонов</div>
              <div className="font-mono text-lg font-bold tabular-nums">{view.seasons}</div>
              <div className="truncate text-[11px] text-ink-soft" title={view.teams.join(", ")}>
                {view.teams.length} {plural(view.teams.length, "команда", "команды", "команд")} · {view.teams.join(", ")}
              </div>
            </div>
            {tiles.map((t) => (
              <div key={t.key} className="rounded-md border border-line bg-white px-3 py-2" title={t.title}>
                <div className="text-[10px] font-bold tracking-wide text-ink-soft uppercase">
                  {t.label} <span className="font-normal normal-case">· {t.title}</span>
                </div>
                <div className="font-mono text-lg font-bold tabular-nums">{t.value}</div>
                <div className="truncate text-[11px] text-ink-soft">{t.sub}</div>
              </div>
            ))}
          </div>

          {/* Раскрывающаяся разбивка по сезонам */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-md border border-line bg-white px-3 py-2 text-left text-sm font-semibold transition hover:bg-paper"
            aria-expanded={open}
          >
            <span>
              {open ? "Скрыть разбивку за все сезоны" : "Показать разбивку за все сезоны"}
              <span className="ml-2 text-xs font-normal text-ink-soft">
                {view.lines.length} {split ? plural(view.lines.length, "строка", "строки", "строк") : plural(view.lines.length, "сезон", "сезона", "сезонов")}
              </span>
            </span>
            <span className={`text-ink-soft transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
          </button>

          {open && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
                <span>
                  Клик по заголовку столбца — сортировка по убыванию, повторный — по возрастанию, третий — по хронологии.
                </span>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
                  по стадиям
                </label>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th
                        className={`th cursor-pointer text-left select-none hover:text-ink ${sort?.key === "season" ? "text-accent" : ""}`}
                        onClick={() => toggleSort("season")}
                        title="Сезон — клик: по убыванию / по возрастанию / по хронологии"
                      >
                        Сезон{arrow("season")}
                      </th>
                      <th
                        className={`th cursor-pointer text-left select-none hover:text-ink ${sort?.key === "team" ? "text-accent" : ""}`}
                        onClick={() => toggleSort("team")}
                        title="Команда — клик: по алфавиту"
                      >
                        Команда{arrow("team")}
                      </th>
                      {view.usedCols.map((c) => (
                        <th
                          key={c.key}
                          className={`th cursor-pointer text-right select-none hover:text-ink ${sort?.key === c.key ? "text-accent" : ""}`}
                          title={`${c.title} — клик: по убыванию / по возрастанию / по хронологии`}
                          onClick={() => toggleSort(c.key)}
                        >
                          {c.label}{arrow(c.key)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLines.map((l, i) => (
                      <tr key={l.label} className={i % 2 ? "bg-paper/50" : ""}>
                        <td className="td font-semibold">{l.label}</td>
                        <td className="td text-xs text-ink-soft">{l.sub}</td>
                        {view.usedCols.map((c) => (
                          <td key={c.key} className={`td-num ${sort?.key === c.key ? "bg-ice-soft/60 font-semibold" : ""}`}>
                            {fmtStat(l.stats[c.key], c.kind, c.key)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-ice-soft/40 font-bold">
                      <td className="td" colSpan={2}>Итого · {view.lines.length} {split ? "строк" : "сез."}</td>
                      {view.usedCols.map((c) => (
                        <td key={c.key} className="td-num">{fmtStat(view.total?.[c.key], c.kind, c.key)}</td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
