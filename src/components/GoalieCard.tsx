"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtDateRu, fmtNum, fmtPct, formatMMSS } from "@/lib/clean";
import { goalieStreaks } from "@/lib/streaks";
import { useSort } from "@/lib/useSort";
import { SeasonHistory } from "./SeasonHistory";
import { HistoryVsTeams } from "./HistoryVsTeams";
import { StreaksPanel } from "./StreaksPanel";

type Game = {
  matchId: number;
  date: string;
  team: string;
  opponent: string;
  side: "home" | "away";
  gf: number;
  ga: number;
  winType: string;
  jersey: number | null;
  toiSeconds: number;
  saves: number;
  goalsAgainst: number;
  shotsAgainst: number;
  result: "" | "W" | "L";
  shutout: boolean;
  assists: number;
  hits: number;
  blocks: number;
  pim: number;
};

type Totals = {
  rostered: number;
  gp: number;
  wins: number;
  losses: number;
  toi: number;
  saves: number;
  goalsAgainst: number;
  shotsAgainst: number;
  shutouts: number;
  savePct: number | null;
  gaa: number | null;
  assists: number;
  hits: number;
  blocks: number;
  pim: number;
};

const WIN_LABEL: Record<string, string> = { reg: "осн.", ot: "ОТ", so: "Б" };

const COLS: { key: string; label: string; title: string; left?: boolean; get: (g: Game) => number | string }[] = [
  { key: "date", label: "Дата", title: "Дата матча", left: true, get: (g) => g.date },
  { key: "opponent", label: "Соперник", title: "Соперник", left: true, get: (g) => g.opponent },
  { key: "score", label: "Счёт", title: "Разница шайб в матче", left: true, get: (g) => g.gf - g.ga },
  { key: "result", label: "Рез", title: "Результат (W/L)", get: (g) => (g.result === "W" ? 2 : g.result === "L" ? 1 : 0) },
  { key: "toi", label: "Время", title: "Игровое время", get: (g) => g.toiSeconds },
  { key: "shotsAgainst", label: "Бр", title: "Броски в створ", get: (g) => g.shotsAgainst },
  { key: "saves", label: "Сейвы", title: "Отражённые броски", get: (g) => g.saves },
  { key: "goalsAgainst", label: "Пр", title: "Пропущенные", get: (g) => g.goalsAgainst },
  { key: "svPct", label: "%ОБ", title: "Процент отражённых", get: (g) => (g.shotsAgainst ? g.saves / g.shotsAgainst : null) as number },
  { key: "assists", label: "Пас", title: "Передачи", get: (g) => g.assists },
  { key: "hits", label: "Сп", title: "Силовые приёмы", get: (g) => g.hits },
  { key: "blocks", label: "Бл", title: "Блокированные броски", get: (g) => g.blocks },
  { key: "pim", label: "Штр", title: "Штрафные минуты", get: (g) => g.pim },
];

const GETTERS = Object.fromEntries(COLS.map((c) => [c.key, c.get]));

export function GoalieCard({ name, onClose }: { name: string; onClose: () => void }) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    setLoading(true);
    fetch(`/api/goalie/${encodeURIComponent(name)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Не удалось загрузить"))))
      .then((d) => {
        if (!on) return;
        setGames(d.games);
        setTotals(d.totals);
      })
      .catch((e) => on && setError(e.message))
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, [name]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const list = useMemo(() => games ?? [], [games]);
  const { sorted, sort, toggle, arrow } = useSort(list, GETTERS);
  const streakData = useMemo(() => goalieStreaks(list), [list]);
  // как в таблице «Вратари»: общее время / сыгранные игры
  const avgToi = totals && totals.gp && totals.toi ? totals.toi / totals.gp : null;
  const tiles = totals && totals.gp
    ? [
        { label: "Ср. время на льду", value: avgToi ? formatMMSS(avgToi) : "—" },
        { label: "Бросков / игра", value: (totals.shotsAgainst / totals.gp).toFixed(1) },
        { label: "Сейвов / игра", value: (totals.saves / totals.gp).toFixed(1) },
        { label: "%ОБ", value: fmtPct(totals.savePct) },
        { label: "КН", value: fmtNum(totals.gaa, 2) },
        { label: "Победы", value: `${totals.wins} из ${totals.gp}` },
      ]
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card mt-8 w-full max-w-6xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-extrabold tracking-tight">{name}</h3>
            {totals && (
              <p className="mt-0.5 text-sm text-ink-soft">
                {totals.gp} матч. · {totals.wins}В–{totals.losses}П · {fmtPct(totals.savePct)} ОБ ·{" "}
                {fmtNum(totals.gaa, 2)} КН · {totals.shutouts} на ноль · {formatMMSS(totals.toi)} на льду ·{" "}
                <b className="text-ink">{avgToi ? formatMMSS(avgToi) : "—"}</b> в среднем
              </p>
            )}
          </div>
          <button className="btn px-3" onClick={onClose}>✕ Закрыть</button>
        </div>

        {tiles.length > 0 && (
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {tiles.map((t, i) => (
              <div key={t.label} className={`rounded-md border px-3 py-2 ${i === 0 ? "border-ice bg-ice-soft" : "border-line bg-white"}`}>
                <div className="text-[10px] font-bold tracking-wide text-ink-soft uppercase">{t.label}</div>
                <div className="font-mono text-lg font-bold tabular-nums">{t.value}</div>
              </div>
            ))}
          </div>
        )}

        {loading && <p className="py-8 text-center text-sm text-ink-soft">Загружаем статистику…</p>}
        {error && <p className="py-8 text-center text-sm font-semibold text-bad">{error}</p>}
        {!loading && !error && games && games.length === 0 && (
          <p className="py-6 text-center text-sm text-ink-soft">В протоколах текущего сезона матчей нет.</p>
        )}

        {!loading && games && games.length > 0 && totals && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th
                      key={c.key}
                      title={`${c.title} — клик: по убыванию / по возрастанию / по дате`}
                      onClick={() => toggle(c.key)}
                      className={`th cursor-pointer select-none hover:text-ink ${c.left ? "text-left" : "text-right"} ${sort?.key === c.key ? "text-accent" : ""}`}
                    >
                      {c.label}{arrow(c.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((g, i) => {
                  const won = g.gf > g.ga;
                  const svPct = g.shotsAgainst ? (g.saves / g.shotsAgainst) * 100 : null;
                  return (
                    <tr key={g.matchId} className={i % 2 ? "bg-paper/50" : ""}>
                      <td className="td font-mono text-xs text-ink-soft">{fmtDateRu(g.date)}</td>
                      <td className="td text-sm">
                        {g.side === "home" ? "vs " : "@ "}
                        <span className="font-semibold">{g.opponent}</span>
                      </td>
                      <td className={`td font-mono text-sm ${won ? "text-ok" : "text-bad"}`}>
                        {g.gf}:{g.ga} <span className="text-[10px] text-ink-soft">{WIN_LABEL[g.winType] ?? ""}</span>
                      </td>
                      <td className={`td-num font-bold ${g.result === "W" ? "text-ok" : g.result === "L" ? "text-bad" : "text-ink-soft"}`}>
                        {g.result || "—"}
                        {g.shutout && <span className="ml-1 text-[10px] text-ok" title="Сухой матч">СО</span>}
                      </td>
                      <td className="td-num">{g.toiSeconds ? formatMMSS(g.toiSeconds) : "—"}</td>
                      <td className="td-num">{g.shotsAgainst || "—"}</td>
                      <td className="td-num">{g.saves || "—"}</td>
                      <td className="td-num">{g.goalsAgainst}</td>
                      <td className="td-num bg-ice-soft/60 font-bold">{fmtPct(svPct)}</td>
                      <td className="td-num">{g.assists || "—"}</td>
                      <td className="td-num">{g.hits || "—"}</td>
                      <td className="td-num">{g.blocks || "—"}</td>
                      <td className="td-num">{g.pim || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-ice-soft/40 font-bold">
                  <td className="td" colSpan={4}>Итого · {totals.rostered} в заявке, {totals.gp} игр</td>
                  <td className="td-num">{formatMMSS(totals.toi)}</td>
                  <td className="td-num">{totals.shotsAgainst}</td>
                  <td className="td-num">{totals.saves}</td>
                  <td className="td-num">{totals.goalsAgainst}</td>
                  <td className="td-num">{fmtPct(totals.savePct)}</td>
                  <td className="td-num">{totals.assists || "—"}</td>
                  <td className="td-num">{totals.hits || "—"}</td>
                  <td className="td-num">{totals.blocks || "—"}</td>
                  <td className="td-num">{totals.pim || "—"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {!loading && list.length > 0 && <StreaksPanel streaks={streakData.streaks} records={streakData.records} />}

        {!loading && <SeasonHistory name={name} kind="goalie" />}
        {!loading && <HistoryVsTeams name={name} kind="goalie" />}
      </div>
    </div>
  );
}
