"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtDateRu, fmtPct, formatMMSS } from "@/lib/clean";
import { skaterStreaks } from "@/lib/streaks";
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
  position: string | null;
  goals: number;
  assists: number;
  points: number;
  plusMinus: number;
  shots: number;
  shotsOnGoal: number;
  hits: number;
  blocks: number;
  pim: number;
  toiSeconds: number;
  faceoffs: number;
  faceoffWins: number;
};

type Totals = {
  gp: number; goals: number; assists: number; points: number; plusMinus: number; shots: number;
  shotsOnGoal: number; hits: number; blocks: number; pim: number; toi: number;
};

const WIN_LABEL: Record<string, string> = { reg: "осн.", ot: "ОТ", so: "Б" };

const COLS: { key: string; label: string; title: string; left?: boolean; get: (g: Game) => number | string }[] = [
  { key: "date", label: "Дата", title: "Дата матча", left: true, get: (g) => g.date },
  { key: "opponent", label: "Соперник", title: "Соперник", left: true, get: (g) => g.opponent },
  { key: "score", label: "Счёт", title: "Разница шайб в матче", left: true, get: (g) => g.gf - g.ga },
  { key: "goals", label: "Г", title: "Голы", get: (g) => g.goals },
  { key: "assists", label: "П", title: "Передачи", get: (g) => g.assists },
  { key: "points", label: "О", title: "Очки", get: (g) => g.points },
  { key: "plusMinus", label: "+/-", title: "Плюс-минус", get: (g) => g.plusMinus },
  { key: "shots", label: "Бр", title: "Броски", get: (g) => g.shots },
  { key: "shotsOnGoal", label: "БрС", title: "Броски в створ", get: (g) => g.shotsOnGoal },
  { key: "hits", label: "Сп", title: "Силовые приёмы", get: (g) => g.hits },
  { key: "blocks", label: "Бл", title: "Блокированные броски", get: (g) => g.blocks },
  { key: "pim", label: "Штр", title: "Штрафные минуты", get: (g) => g.pim },
  { key: "fo", label: "Вбр", title: "Вбрасывания (сортировка по выигранным)", get: (g) => g.faceoffWins },
  { key: "toi", label: "Время", title: "Время на льду", get: (g) => g.toiSeconds },
];

const GETTERS = Object.fromEntries(COLS.map((c) => [c.key, c.get]));

export function PlayerCard({ name, onClose }: { name: string; onClose: () => void }) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    setLoading(true);
    fetch(`/api/player/${encodeURIComponent(name)}`)
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
  const streakData = useMemo(() => skaterStreaks(list), [list]);

  // средние показатели (только отображение, на основе итогов)
  // как в таблице «Игроки»: общее время / игры
  const avgToi = totals && totals.gp && totals.toi ? totals.toi / totals.gp : null;
  const tiles = totals && totals.gp
    ? [
        { label: "Ср. время на льду", value: avgToi ? formatMMSS(avgToi) : "—" },
        { label: "Очки / игра", value: (totals.points / totals.gp).toFixed(2) },
        { label: "Голы / игра", value: (totals.goals / totals.gp).toFixed(2) },
        { label: "Броски в створ / игра", value: (totals.shotsOnGoal / totals.gp).toFixed(1) },
        { label: "Силовые / игра", value: (totals.hits / totals.gp).toFixed(1) },
        { label: "Блоки / игра", value: (totals.blocks / totals.gp).toFixed(1) },
        { label: "Штраф / игра", value: (totals.pim / totals.gp).toFixed(1) },
        { label: "Реализация", value: totals.shotsOnGoal ? fmtPct((totals.goals / totals.shotsOnGoal) * 100) : "—" },
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
            {totals && totals.gp > 0 && (
              <p className="mt-0.5 text-sm text-ink-soft">
                {totals.gp} матч. · {totals.goals}+{totals.assists} = {totals.points} оч. ·{" "}
                <span className={totals.plusMinus > 0 ? "text-ok" : totals.plusMinus < 0 ? "text-bad" : ""}>
                  {totals.plusMinus > 0 ? `+${totals.plusMinus}` : totals.plusMinus}
                </span>{" "}
                · {formatMMSS(totals.toi)} на льду · <b className="text-ink">{avgToi ? formatMMSS(avgToi) : "—"}</b> в среднем
              </p>
            )}
          </div>
          <button className="btn px-3" onClick={onClose}>✕ Закрыть</button>
        </div>

        {tiles.length > 0 && (
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
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
                      <td className="td-num">{g.goals || "—"}</td>
                      <td className="td-num">{g.assists || "—"}</td>
                      <td className="td-num bg-ice-soft/60 font-bold">{g.points}</td>
                      <td className="td-num">{g.plusMinus > 0 ? `+${g.plusMinus}` : g.plusMinus}</td>
                      <td className="td-num">{g.shots || "—"}</td>
                      <td className="td-num">{g.shotsOnGoal || "—"}</td>
                      <td className="td-num">{g.hits || "—"}</td>
                      <td className="td-num">{g.blocks || "—"}</td>
                      <td className="td-num">{g.pim || "—"}</td>
                      <td className="td-num">{g.faceoffs ? `${g.faceoffWins}/${g.faceoffs}` : "—"}</td>
                      <td className="td-num font-semibold">{g.toiSeconds ? formatMMSS(g.toiSeconds) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-ice-soft/40 font-bold">
                  <td className="td" colSpan={3}>Итого</td>
                  <td className="td-num">{totals.goals}</td>
                  <td className="td-num">{totals.assists}</td>
                  <td className="td-num">{totals.points}</td>
                  <td className={`td-num ${totals.plusMinus > 0 ? "text-ok" : totals.plusMinus < 0 ? "text-bad" : ""}`}>
                    {totals.plusMinus > 0 ? `+${totals.plusMinus}` : totals.plusMinus}
                  </td>
                  <td className="td-num">{totals.shots}</td>
                  <td className="td-num">{totals.shotsOnGoal}</td>
                  <td className="td-num">{totals.hits}</td>
                  <td className="td-num">{totals.blocks}</td>
                  <td className="td-num">{totals.pim}</td>
                  <td className="td-num">
                    {totals.shotsOnGoal ? fmtPct(totals.shotsOnGoal ? (totals.goals / totals.shotsOnGoal) * 100 : null) : "—"}
                  </td>
                  <td className="td-num">{formatMMSS(totals.toi)}</td>
                </tr>
                <tr className="text-xs text-ink-soft">
                  <td className="td" colSpan={3}>В среднем за игру</td>
                  <td className="td-num">{(totals.goals / totals.gp).toFixed(2)}</td>
                  <td className="td-num">{(totals.assists / totals.gp).toFixed(2)}</td>
                  <td className="td-num">{(totals.points / totals.gp).toFixed(2)}</td>
                  <td className="td-num">{(totals.plusMinus / totals.gp).toFixed(2)}</td>
                  <td className="td-num">{(totals.shots / totals.gp).toFixed(1)}</td>
                  <td className="td-num">{(totals.shotsOnGoal / totals.gp).toFixed(1)}</td>
                  <td className="td-num">{(totals.hits / totals.gp).toFixed(1)}</td>
                  <td className="td-num">{(totals.blocks / totals.gp).toFixed(1)}</td>
                  <td className="td-num">{(totals.pim / totals.gp).toFixed(1)}</td>
                  <td className="td-num"></td>
                  <td className="td-num font-semibold text-ink">{avgToi ? formatMMSS(avgToi) : "—"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {!loading && list.length > 0 && <StreaksPanel streaks={streakData.streaks} records={streakData.records} />}

        {!loading && <SeasonHistory name={name} kind="skater" />}
        {!loading && <HistoryVsTeams name={name} kind="skater" />}
      </div>
    </div>
  );
}
