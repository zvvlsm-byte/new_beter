"use client";

import { useMemo, useState } from "react";
import type { StandingsRow } from "@/lib/compute";
import { fmtPct } from "@/lib/clean";

type ExtRow = StandingsRow & {
  pctHome: number | null;
  pctAway: number | null;
  pctTotal: number | null;
};

function pct(goals: number, shots: number): number | null {
  return shots > 0 ? (goals / shots) * 100 : null;
}

export function ShotsTable({ rows }: { rows: StandingsRow[] }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const sorted = useMemo(() => {
    const ext: ExtRow[] = rows.map((r) => ({
      ...r,
      pctHome: pct(r.gfHome, r.sogHome),
      pctAway: pct(r.gfAway, r.sogAway),
      pctTotal: pct(r.gf, r.sog),
    }));
    if (!sort) return ext;
    return [...ext].sort((a, b) => {
      if (sort.key === "team") return a.team.localeCompare(b.team, "ru") * sort.dir;
      const av = a[sort.key as keyof ExtRow];
      const bv = b[sort.key as keyof ExtRow];
      const an = typeof av === "number" ? av : -Infinity;
      const bn = typeof bv === "number" ? bv : -Infinity;
      return (an - bn) * sort.dir || a.team.localeCompare(b.team, "ru");
    });
  }, [rows, sort]);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key === key ? (s.dir === -1 ? { key, dir: 1 } : null) : { key, dir: -1 }));

  const arrow = (key: string) => (sort?.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : "");

  const cols: { key: string; label: string; title: string }[] = [
    { key: "team", label: "Команда", title: "Команда (клик — по алфавиту)" },
    { key: "sogHome", label: "БВ_Д", title: "Броски в створ дома" },
    { key: "gfHome", label: "ЗШ_Д", title: "Заброшенные шайбы дома" },
    { key: "pctHome", label: "%БВ_Д", title: "Реализация бросков в створ дома: ЗШ_Д / БВ_Д" },
    { key: "sogAway", label: "БВ_В", title: "Броски в створ в гостях" },
    { key: "gfAway", label: "ЗШ_В", title: "Заброшенные шайбы в гостях" },
    { key: "pctAway", label: "%БВ_В", title: "Реализация бросков в створ в гостях: ЗШ_В / БВ_В" },
    { key: "sog", label: "БВ", title: "Броски в створ всего" },
    { key: "gf", label: "Ш", title: "Заброшенные шайбы всего" },
    { key: "pctTotal", label: "%БВ", title: "Реализация бросков в створ: Ш / БВ" },
  ];

  return (
    <div className="card overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th colSpan={1} className="border-b border-line bg-ink px-2 py-1 text-left text-[11px] font-bold tracking-wider text-white uppercase">Команда</th>
            <th colSpan={3} className="border-b border-line bg-ok px-2 py-1 text-left text-[11px] font-bold tracking-wider text-white uppercase">Дома</th>
            <th colSpan={3} className="border-b border-line bg-accent px-2 py-1 text-left text-[11px] font-bold tracking-wider text-white uppercase">В гостях</th>
            <th colSpan={3} className="border-b border-line bg-ice px-2 py-1 text-left text-[11px] font-bold tracking-wider text-white uppercase">Всего</th>
          </tr>
          <tr>
            <th className="th text-left">№</th>
            {cols.map((c) => (
              <th
                key={c.key}
                title={c.title}
                onClick={() => toggleSort(c.key)}
                className={`th cursor-pointer transition select-none hover:text-ink ${c.key === "team" ? "text-left" : "text-right"} ${sort?.key === c.key ? "text-accent" : ""}`}
              >
                {c.label}{arrow(c.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.team} className={i % 2 ? "bg-paper/50" : ""}>
              <td className="td w-8 font-mono text-xs text-ink-soft">{i + 1}</td>
              <td className="td font-bold whitespace-normal">{r.team}</td>
              <td className="td-num">{r.sogHome}</td>
              <td className="td-num">{r.gfHome}</td>
              <td className="td-num">{fmtPct(r.pctHome)}</td>
              <td className="td-num">{r.sogAway}</td>
              <td className="td-num">{r.gfAway}</td>
              <td className="td-num">{fmtPct(r.pctAway)}</td>
              <td className="td-num font-bold">{r.sog}</td>
              <td className="td-num font-bold">{r.gf}</td>
              <td className="td-num bg-ice-soft/60 font-bold">{fmtPct(r.pctTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-3 text-xs text-ink-soft">
        БВ — броски в створ (из графы «Бс» протоколов), ЗШ — заброшенные шайбы · %БВ = ЗШ / БВ ·
        разбивка по домашним и гостевым матчам. Все столбцы сортируются кликом.
      </p>
    </div>
  );
}
