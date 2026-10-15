"use client";

import { useEffect, useMemo, useState } from "react";
import type { GoalieLog, SkaterLog } from "@/lib/historyDb";
import { fmtDateRu, fmtPct } from "@/lib/clean";
import { seasonLabel } from "@/lib/seasonStats";

/**
 * «Против команд»: статистика игрока/вратаря против каждого соперника —
 * за выбранный сезон или за все сезоны (архив старых протоколов + текущая база).
 */
export function HistoryVsTeams({ name, kind }: { name: string; kind: "skater" | "goalie" }) {
  const [logs, setLogs] = useState<(SkaterLog | GoalieLog)[] | null>(null);
  const [season, setSeason] = useState("all");
  const [opp, setOpp] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/history/player?name=${encodeURIComponent(name)}&kind=${kind}`)
      .then((r) => r.json())
      .then((d) => alive && setLogs(d.logs ?? []))
      .catch(() => alive && setLogs([]));
    return () => {
      alive = false;
    };
  }, [name, kind]);

  const seasons = useMemo(() => [...new Set((logs ?? []).map((l) => l.season))].sort().reverse(), [logs]);
  const filtered = useMemo(() => (logs ?? []).filter((l) => season === "all" || l.season === season), [logs, season]);

  const rows = useMemo(() => {
    const map = new Map<string, { opp: string; games: (SkaterLog | GoalieLog)[] }>();
    for (const l of filtered) {
      if (kind === "skater" && !(l as SkaterLog).played) continue;
      const k = l.opponent.trim();
      (map.get(k) ?? map.set(k, { opp: k, games: [] }).get(k)!).games.push(l);
    }
    return [...map.values()].map(({ opp, games }) => {
      if (kind === "skater") {
        const g = games as SkaterLog[];
        const goals = g.reduce((a, x) => a + x.goals, 0);
        const assists = g.reduce((a, x) => a + x.assists, 0);
        return { opp, gp: g.length, a: goals, b: assists, c: goals + assists, d: g.reduce((a, x) => a + x.pim, 0), e: null as number | null, games };
      }
      const g = games as GoalieLog[];
      const sv = g.filter((x) => x.saves !== null);
      const saves = sv.reduce((a, x) => a + (x.saves ?? 0), 0);
      const svGa = sv.reduce((a, x) => a + x.goalsAgainst, 0);
      const toi = g.reduce((a, x) => a + x.toiSeconds, 0);
      const ga = g.reduce((a, x) => a + x.goalsAgainst, 0);
      return {
        opp, gp: g.length, a: g.filter((x) => x.won).length, b: g.filter((x) => !x.won).length,
        c: saves + svGa > 0 ? (saves / (saves + svGa)) * 100 : null,
        d: toi > 0 ? (ga / toi) * 3600 : null,
        e: g.filter((x) => x.goalsAgainst === 0 && x.toiSeconds >= 3000).length,
        games,
      };
    }).sort((x, y) => (kind === "skater" ? (y.c ?? 0) - (x.c ?? 0) : y.gp - x.gp) || y.gp - x.gp);
  }, [filtered, kind]);

  if (logs === null) return <p className="mt-4 text-xs text-ink-soft">Загружаем статистику против команд…</p>;
  if (!logs.length) return null;

  const detail = opp ? rows.find((r) => r.opp === opp) : null;
  const archiveCount = logs.filter((l) => l.source === "archive").length;

  return (
    <section className="mt-6 space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line pb-1.5">
        <div>
          <h4 className="text-sm font-extrabold tracking-wide uppercase">Против команд</h4>
          <p className="text-xs text-ink-soft">
            Архив старых протоколов ({archiveCount} матч.) + текущая база. Клик по сопернику — список матчей.
          </p>
        </div>
        <select className="inp max-w-44" value={season} onChange={(e) => { setSeason(e.target.value); setOpp(null); }}>
          <option value="all">Все сезоны</option>
          {seasons.map((s) => <option key={s} value={s}>{seasonLabel(s)}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="th text-left">Соперник</th>
              <th className="th text-right">И</th>
              {kind === "skater" ? (
                <>
                  <th className="th text-right">Г</th>
                  <th className="th text-right">П</th>
                  <th className="th text-right">О</th>
                  <th className="th text-right">Штр</th>
                  <th className="th text-right" title="Очки за игру">О/И</th>
                </>
              ) : (
                <>
                  <th className="th text-right">В</th>
                  <th className="th text-right">П</th>
                  <th className="th text-right">%ОБ</th>
                  <th className="th text-right">КН</th>
                  <th className="th text-right">И0</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.opp} className={`${i % 2 ? "bg-paper/50" : ""} ${opp === r.opp ? "bg-ice-soft" : ""}`}>
                <td className="td">
                  <button className="font-semibold text-ice hover:underline" onClick={() => setOpp(opp === r.opp ? null : r.opp)}>{r.opp}</button>
                </td>
                <td className="td-num">{r.gp}</td>
                {kind === "skater" ? (
                  <>
                    <td className="td-num">{r.a}</td>
                    <td className="td-num">{r.b}</td>
                    <td className="td-num bg-ice-soft/60 font-bold">{r.c}</td>
                    <td className="td-num">{r.d}</td>
                    <td className="td-num">{r.gp ? ((r.c ?? 0) / r.gp).toFixed(2) : "—"}</td>
                  </>
                ) : (
                  <>
                    <td className="td-num">{r.a}</td>
                    <td className="td-num">{r.b}</td>
                    <td className="td-num">{fmtPct(r.c)}</td>
                    <td className="td-num">{r.d !== null ? r.d.toFixed(2) : "—"}</td>
                    <td className="td-num">{r.e}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail && (
        <div className="overflow-x-auto rounded-md border border-line bg-white">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Дата", "Сезон", "Команда", "Соперник", "Счёт", kind === "skater" ? "Г+П" : "Пропущено / сейвы", "Источник"].map((h) => (
                  <th key={h} className="th text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...detail.games].reverse().map((g, i) => (
                <tr key={i}>
                  <td className="td font-mono text-xs">{fmtDateRu(g.date)}</td>
                  <td className="td text-xs">{seasonLabel(g.season)}</td>
                  <td className="td text-xs">{g.team}{g.home ? " (д)" : " (г)"}</td>
                  <td className="td text-xs">{g.opponent}</td>
                  <td className={`td font-mono text-xs font-bold ${g.won ? "text-ok" : "text-bad"}`}>{g.score}</td>
                  <td className="td font-mono text-xs">
                    {kind === "skater"
                      ? `${(g as SkaterLog).goals}+${(g as SkaterLog).assists}`
                      : `${(g as GoalieLog).goalsAgainst} / ${(g as GoalieLog).saves ?? "—"}`}
                  </td>
                  <td className="td text-xs text-ink-soft">{g.source === "archive" ? "архив" : "текущий сезон"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
