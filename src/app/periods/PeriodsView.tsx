"use client";

import { useMemo, useState } from "react";
import type { PeriodStatsEntry, TeamPeriodRow } from "@/lib/compute";

const PERIOD_NAMES = ["1-й период", "2-й период", "3-й период", "Овертайм"];
const PERIOD_BG = ["bg-ice", "bg-accent", "bg-ok", "bg-warn"];

const PERIOD_COLS = [
  { m: "gf", label: "Ш", title: "Заброшенные шайбы в периоде" },
  { m: "ga", label: "ПШ", title: "Пропущенные шайбы в периоде" },
  { m: "sogFor", label: "Бс", title: "Броски в створ в периоде" },
  { m: "sogAgainst", label: "БсС", title: "Броски в створ от соперника в периоде" },
  { m: "pens", label: "У", title: "Количество удалений в периоде" },
  { m: "pim", label: "Штр", title: "Штрафные минуты в периоде" },
  { m: "wdl", label: "В-Н-П", title: "Исходы отрезка; сортировка по очкам периода (Ш×2+Н)" },
] as const;

const TOTAL_COLS = [
  { m: "gf", label: "Ш", title: "Всего заброшено за все периоды" },
  { m: "ga", label: "ПШ", title: "Всего пропущено за все периоды" },
  { m: "sogFor", label: "Бс", title: "Всего бросков в створ" },
  { m: "sogAgainst", label: "БсС", title: "Всего бросков в створ от соперника" },
  { m: "pens", label: "У", title: "Всего удалений" },
  { m: "pim", label: "Штр", title: "Всего штрафных минут" },
] as const;

type Metric = (typeof PERIOD_COLS)[number]["m"];

function entryValue(e: PeriodStatsEntry, m: Metric): number {
  switch (m) {
    case "wdl": return e.w * 2 + e.d;
    case "sogFor": return e.sogFor ?? -1;
    case "sogAgainst": return e.sogAgainst ?? -1;
    default: return e[m];
  }
}

function sortValue(r: TeamPeriodRow, key: string): number {
  if (key === "gp") return r.gp;
  const m = key.slice(key.indexOf(".") + 1) as Metric;
  if (key.startsWith("t.")) {
    const v = r.total[m as keyof typeof r.total];
    return typeof v === "number" ? v : -1;
  }
  const pi = parseInt(key.slice(1, key.indexOf(".")), 10);
  return entryValue(r.periods[pi], m);
}

export function PeriodsView({ rows }: { rows: TeamPeriodRow[] }) {
  const [team, setTeam] = useState("all");
  // ключ вида "t.gf" (всего) или "p0.gf".."p3.wdl" (период), плюс "gp"
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const teams = useMemo(() => rows.map((r) => r.team).sort((a, b) => a.localeCompare(b, "ru")), [rows]);

  const filtered = useMemo(() => {
    const list = team === "all" ? [...rows] : rows.filter((r) => r.team === team);
    if (!sort) return list;
    return list.sort(
      (a, b) =>
        (sortValue(a, sort.key) - sortValue(b, sort.key)) * sort.dir ||
        a.team.localeCompare(b.team, "ru"),
    );
  }, [rows, team, sort]);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key === key ? (s.dir === -1 ? { key, dir: 1 } : null) : { key, dir: -1 }));

  const arrow = (key: string) => (sort?.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : "");

  const leagueByPeriod = useMemo(
    () =>
      [0, 1, 2, 3].map((pi) => ({
        goals: rows.reduce((a, r) => a + r.periods[pi].gf, 0),
        pens: rows.reduce((a, r) => a + r.periods[pi].pens, 0),
        games: Math.max(0, ...rows.map((r) => r.periods[pi].gp)),
      })),
    [rows],
  );
  const totalGoals = leagueByPeriod.reduce((a, p) => a + p.goals, 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {leagueByPeriod.map((p, i) => (
          <div
            key={i}
            className={`card border-l-4 px-4 py-3 ${["border-l-ice", "border-l-accent", "border-l-ok", "border-l-warn"][i]}`}
          >
            <div className="text-[11px] font-bold tracking-wide text-ink-soft uppercase">{PERIOD_NAMES[i]}</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums">
              {p.goals} <span className="text-sm font-semibold text-ink-soft">шайб</span>
            </div>
            <div className="text-xs text-ink-soft">
              {totalGoals ? `${Math.round((p.goals / totalGoals) * 100)}% всех голов` : "нет данных"} · {p.pens} удал.
              {p.games ? ` · в ${p.games} матч.` : ""}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className="inp max-w-64" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="all">Все команды</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="text-xs text-ink-soft">
          {filtered.length} из {rows.length} команд · клик по заголовку столбца сортирует, повторный клик меняет направление, третий — сбрасывает
        </span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th colSpan={3} className="border-b border-line bg-ink px-2 py-1 text-left text-[11px] font-bold tracking-wider text-white uppercase">Команда</th>
              {PERIOD_NAMES.map((name, i) => (
                <th key={name} colSpan={7} className={`border-b border-line px-2 py-1 text-left text-[11px] font-bold tracking-wider text-white uppercase ${PERIOD_BG[i]}`}>
                  {name}
                </th>
              ))}
              <th colSpan={6} className="border-b border-line bg-ink px-2 py-1 text-left text-[11px] font-bold tracking-wider text-white uppercase">Всего</th>
            </tr>
            <tr>
              <th className="th text-left">№</th>
              <th className="th text-left">Команда</th>
              <th
                className={`th cursor-pointer text-right transition hover:text-ink ${sort?.key === "gp" ? "text-accent" : ""}`}
                title="Сыграно матчей"
                onClick={() => toggleSort("gp")}
              >
                И{arrow("gp")}
              </th>
              {PERIOD_NAMES.map((name, pi) =>
                PERIOD_COLS.map((c) => {
                  const key = `p${pi}.${c.m}`;
                  return (
                    <th
                      key={key}
                      title={c.title}
                      onClick={() => toggleSort(key)}
                      className={`th cursor-pointer text-right transition hover:text-ink ${sort?.key === key ? "text-accent" : ""}`}
                    >
                      {c.label}{arrow(key)}
                    </th>
                  );
                }),
              )}
              {TOTAL_COLS.map((c) => {
                const key = `t.${c.m}`;
                return (
                  <th
                    key={key}
                    title={c.title}
                    onClick={() => toggleSort(key)}
                    className={`th cursor-pointer text-right transition hover:text-ink ${sort?.key === key ? "text-accent" : ""}`}
                  >
                    {c.label}{arrow(key)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.team} className={i % 2 ? "bg-paper/50" : ""}>
                <td className="td w-8 font-mono text-xs text-ink-soft">{i + 1}</td>
                <td className="td font-bold whitespace-normal">{r.team}</td>
                <td className="td-num">{r.gp}</td>
                {r.periods.map((e, pi) => (
                  <PeriodCells key={pi} e={e} />
                ))}
                <td className="td-num font-bold">{r.total.gf || "—"}</td>
                <td className="td-num">{r.total.ga || "—"}</td>
                <td className="td-num">{r.total.sogFor ?? "—"}</td>
                <td className="td-num">{r.total.sogAgainst ?? "—"}</td>
                <td className="td-num">{r.total.pens || "—"}</td>
                <td className="td-num">{r.total.pim || "—"}</td>
              </tr>
            ))}
            {!filtered.length && (
              <tr><td colSpan={40} className="td py-8 text-center text-sm text-ink-soft">Нет данных</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-4 text-xs leading-relaxed text-ink-soft">
        <p className="mb-1 font-bold text-ink">Как читать таблицу</p>
        <p>
          Ш/ПШ — заброшенные и пропущенные шайбы в периоде · Бс — броски в створ команды ·
          БсС — броски в створ от соперника · У/Штр — удаления и штрафные минуты в периоде ·
          В-Н-П — сколько раз отрезок выигран, сведён вничью или проигран.
          Удаление попадает в период по игровому времени: 00:00–20:00 — 1-й период, 20:00–40:00 — 2-й,
          40:00–60:00 — 3-й, после 60:00 — овертайм.
          Овертайм появляется только у матчей, где он был; при буллитах периодные суммы могут не включать решающий буллит.
        </p>
      </div>
    </div>
  );
}

function PeriodCells({ e }: { e: PeriodStatsEntry }) {
  const noData = e.gp === 0;
  return (
    <>
      <td className={`td-num ${noData ? "text-ink-soft" : ""}`}>{noData ? "—" : e.gf}</td>
      <td className="td-num">{noData ? "—" : e.ga}</td>
      <td className="td-num">{e.sogFor ?? "—"}</td>
      <td className="td-num">{e.sogAgainst ?? "—"}</td>
      <td className="td-num">{noData ? "—" : e.pens}</td>
      <td className="td-num">{noData ? "—" : e.pim}</td>
      <td className="td-num font-semibold">{noData ? "—" : `${e.w}-${e.d}-${e.l}`}</td>
    </>
  );
}
