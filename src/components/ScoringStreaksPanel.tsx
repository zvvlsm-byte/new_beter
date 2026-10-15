"use client";

import { useState } from "react";
import type { ScoringStreak } from "@/lib/scoringStreaks";
import { ddmm } from "@/lib/streaks";

const LIMIT = 12;

/** «Самые продолжительные бомбардирские серии сезона — действующие или прерванные». */
export function ScoringStreaksPanel({
  list,
  onName,
}: {
  list: ScoringStreak[] | undefined;
  onName?: (name: string, kind: "skater" | "goalie") => void;
}) {
  const [all, setAll] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "ended">("all");
  if (!list || !list.length) return null;
  const filtered = list.filter((s) => (filter === "all" ? true : filter === "active" ? s.active : !s.active));
  const shown = all ? filtered : filtered.slice(0, LIMIT);
  return (
    <div className="card overflow-x-auto">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2">
        <div>
          <h3 className="text-xs font-extrabold tracking-wide uppercase">Бомбардирские серии сезона</h3>
          <p className="text-[11px] text-ink-soft">
            Самые продолжительные серии матчей подряд с очками (от 3 игр) — действующие и прерванные.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {([["all", "Все"], ["active", "Идут"], ["ended", "Прерваны"]] as const).map(([k, l]) => (
            <button
              key={k}
              className={`btn px-2.5 py-1 text-xs ${filter === k ? "border-ink bg-ink text-white hover:bg-ink" : ""}`}
              onClick={() => setFilter(k)}
            >
              {l}
            </button>
          ))}
          {filtered.length > LIMIT && (
            <button className="btn px-3 py-1 text-xs" onClick={() => setAll((v) => !v)}>
              {all ? "Свернуть" : `Все (${filtered.length})`}
            </button>
          )}
        </div>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="th text-left">#</th>
            <th className="th text-left">Игрок</th>
            <th className="th text-left">Команда</th>
            <th className="th text-right" title="Матчей подряд с очками">Матчей</th>
            <th className="th text-right" title="Голы + передачи за серию">Г+П</th>
            <th className="th text-right" title="Очки за серию">О</th>
            <th className="th text-left">Период</th>
            <th className="th text-left">Статус</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((s, i) => (
            <tr key={`${s.name}|${s.fromDate}`} className={i % 2 ? "bg-paper/50" : ""}>
              <td className="td font-mono text-xs text-ink-soft">{i + 1}</td>
              <td className="td font-bold">
                {onName ? (
                  <button
                    className="text-ice underline-offset-2 transition hover:text-accent hover:underline"
                    onClick={() => onName(s.name, "skater")}
                  >
                    {s.name}
                  </button>
                ) : (
                  s.name
                )}
              </td>
              <td className="td text-xs text-ink-soft">{s.team}</td>
              <td className="td-num font-bold">{s.len}</td>
              <td className="td-num">{s.goals}+{s.assists}</td>
              <td className="td-num bg-ice-soft/60 font-bold">{s.points}</td>
              <td className="td text-xs text-ink-soft">{ddmm(s.fromDate)} – {ddmm(s.toDate)}</td>
              <td className="td">
                {s.active ? (
                  <span className="badge bg-ok/10 text-ok">идёт</span>
                ) : (
                  <span className="badge bg-line text-ink-soft">прервана {s.brokenOn ? ddmm(s.brokenOn) : ""}</span>
                )}
              </td>
            </tr>
          ))}
          {!shown.length && (
            <tr><td colSpan={8} className="td py-6 text-center text-sm text-ink-soft">Нет серий</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
