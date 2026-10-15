"use client";

import { useMemo, useState } from "react";
import type { AttendanceTeamRow } from "@/lib/compute";

type Sort = { key: string; dir: 1 | -1 } | null;

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("ru-RU"));

export function AttendanceView({ teams }: { teams: AttendanceTeamRow[] }) {
  const [sort, setSort] = useState<Sort>(null);

  const sorted = useMemo(() => {
    if (!sort) return teams;
    return [...teams].sort((a, b) => {
      if (sort.key === "team") return a.team.localeCompare(b.team, "ru") * sort.dir;
      const av = a[sort.key as keyof AttendanceTeamRow];
      const bv = b[sort.key as keyof AttendanceTeamRow];
      const an = typeof av === "number" ? av : -Infinity;
      const bn = typeof bv === "number" ? bv : -Infinity;
      return (an - bn) * sort.dir || a.team.localeCompare(b.team, "ru");
    });
  }, [teams, sort]);

  const toggle = (key: string) =>
    setSort((s) => (s?.key === key ? (s.dir === -1 ? { key, dir: 1 } : null) : { key, dir: -1 }));

  const arrow = (key: string) => (sort?.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : "");

  const cols: { key: string; label: string; title: string; align: string }[] = [
    { key: "team", label: "Команда", title: "Команда (клик — по алфавиту)", align: "text-left" },
    { key: "games", label: "Дом. игры", title: "Домашние матчи, по которым есть данные о зрителях", align: "text-right" },
    { key: "total", label: "Всего зрителей", title: "Суммарное количество зрителей на домашних матчах", align: "text-right" },
    { key: "avg", label: "Средняя", title: "Средняя посещаемость: всего / домашние игры", align: "text-right" },
  ];

  return (
    <div className="card overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="th text-left">№</th>
            {cols.map((c) => (
              <th
                key={c.key}
                title={c.title}
                onClick={() => toggle(c.key)}
                className={`th cursor-pointer transition select-none hover:text-ink ${c.align} ${sort?.key === c.key ? "text-accent" : ""}`}
              >
                {c.label}{arrow(c.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.team} className={i % 2 ? "bg-paper/50" : ""}>
              <td className="td font-mono text-xs text-ink-soft">{i + 1}</td>
              <td className="td font-bold">{r.team}</td>
              <td className="td-num">{r.games}</td>
              <td className="td-num">{fmt(r.total)}</td>
              <td className="td-num font-bold">{fmt(r.avg)}</td>
            </tr>
          ))}
          {!sorted.length && (
            <tr><td colSpan={5} className="td py-8 text-center text-sm text-ink-soft">Пока нет данных о зрителях</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
