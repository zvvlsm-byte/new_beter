"use client";

import { useMemo, useState } from "react";
import type { GoalieDayRow, PlayerDayRow } from "@/lib/compute";
import { fmtDateRu, fmtPct, formatMMSS } from "@/lib/clean";
import type { DayForm } from "@/lib/formStreaks";
import type { ScoringStreak } from "@/lib/scoringStreaks";
import { GoalieCard } from "@/components/GoalieCard";
import { PlayerCard } from "@/components/PlayerCard";
import { NextMatchesPanel } from "@/components/NextMatchesPanel";
import { DayMatchFacts } from "@/components/DayMatchFacts";

type Props = {
  playerDays: PlayerDayRow[];
  goalieDays: GoalieDayRow[];
  formByDate?: Record<string, DayForm>;
  scoringByDate?: Record<string, ScoringStreak[]>;
};

type Sort = { key: string; dir: 1 | -1 } | null;

const PLAYER_COLS: { key: keyof PlayerDayRow | null; label: string; title?: string }[] = [
  { key: null, label: "Игрок" },
  { key: null, label: "Команда" },
  { key: "gp", label: "И", title: "Игры за день" },
  { key: "goals", label: "Г", title: "Голы" },
  { key: "assists", label: "П", title: "Передачи" },
  { key: "points", label: "О", title: "Очки" },
  { key: "plusMinus", label: "+/-", title: "Показатель полезности" },
  { key: "shots", label: "Бр", title: "Броски" },
  { key: "sog", label: "БрС", title: "Броски в створ" },
  { key: "hits", label: "Сил", title: "Силовые приёмы" },
  { key: "blocks", label: "Блок", title: "Заблокированные броски" },
  { key: "pim", label: "Штр", title: "Штрафные минуты" },
  { key: "toi", label: "Время", title: "Время на льду" },
];

const GOALIE_COLS: { key: keyof GoalieDayRow | null; label: string; title?: string }[] = [
  { key: null, label: "Вратарь" },
  { key: null, label: "Команда" },
  { key: "gp", label: "И", title: "Игры за день" },
  { key: "toi", label: "Время", title: "Время на льду" },
  { key: "shotsAgainst", label: "Броски", title: "Броски по воротам" },
  { key: "saves", label: "Сейвы", title: "Отражённые броски" },
  { key: "goalsAgainst", label: "Пропущено", title: "Пропущенные шайбы" },
  { key: "savePct", label: "%ОБ", title: "Процент отражённых бросков" },
];

function toggle(sort: Sort, key: string): Sort {
  if (sort?.key === key) return sort.dir === -1 ? { key, dir: 1 } : null;
  return { key, dir: -1 };
}

function numOrInf(v: unknown): number {
  return typeof v === "number" ? v : -Infinity;
}

export function DayView({ playerDays, goalieDays, formByDate, scoringByDate }: Props) {
  const dates = useMemo(
    () => [...new Set(playerDays.map((r) => r.date))].sort().reverse(),
    [playerDays],
  );
  const [date, setDate] = useState(dates[0] ?? "");
  const [playerSort, setPlayerSort] = useState<Sort>(null);
  const [goalieSort, setGoalieSort] = useState<Sort>(null);
  const [goalieCard, setGoalieCard] = useState<string | null>(null);
  const [playerCard, setPlayerCard] = useState<string | null>(null);
  const openCard = (name: string, kind: "skater" | "goalie") =>
    kind === "goalie" ? setGoalieCard(name) : setPlayerCard(name);

  const players = useMemo(() => {
    const list = playerDays.filter((r) => r.date === date);
    if (!playerSort) {
      return [...list].sort(
        (a, b) => b.points - a.points || b.goals - a.goals || a.name.localeCompare(b.name, "ru"),
      );
    }
    return [...list].sort((a, b) => {
      if (playerSort.key === "name") return a.name.localeCompare(b.name, "ru") * playerSort.dir;
      return (
        (numOrInf(a[playerSort.key as keyof PlayerDayRow]) - numOrInf(b[playerSort.key as keyof PlayerDayRow])) *
          playerSort.dir ||
        a.name.localeCompare(b.name, "ru")
      );
    });
  }, [playerDays, date, playerSort]);

  const goalies = useMemo(() => {
    const list = goalieDays.filter((r) => r.date === date);
    if (!goalieSort) return [...list].sort((a, b) => b.toi - a.toi);
    return [...list].sort((a, b) => {
      if (goalieSort.key === "name") return a.name.localeCompare(b.name, "ru") * goalieSort.dir;
      return (
        (numOrInf(a[goalieSort.key as keyof GoalieDayRow]) - numOrInf(b[goalieSort.key as keyof GoalieDayRow])) *
          goalieSort.dir ||
        a.name.localeCompare(b.name, "ru")
      );
    });
  }, [goalieDays, date, goalieSort]);

  const leader = (get: (r: PlayerDayRow) => number, allowZero = false) => {
    let best: PlayerDayRow | null = null;
    for (const r of players) {
      const v = get(r);
      if ((v > 0 || allowZero) && (!best || v > get(best))) best = r;
    }
    return best;
  };

  const pPoints = leader((r) => r.points);
  const pGoals = leader((r) => r.goals);
  const pAssists = leader((r) => r.assists);
  const pHits = leader((r) => r.hits);
  const pBlocks = leader((r) => r.blocks);
  const pSog = leader((r) => r.sog);
  const pToi = leader((r) => r.toi, true);
  const pPlus = leader((r) => r.plusMinus);

  const cards: { label: string; row: PlayerDayRow | null; value: string; sub: string }[] = [
    { label: "Бомбардир дня", row: pPoints, value: String(pPoints?.points ?? 0), sub: pPoints ? `${pPoints.goals}+${pPoints.assists} (гол+пас)` : "" },
    { label: "Снайпер дня", row: pGoals, value: String(pGoals?.goals ?? 0), sub: "заброшенные шайбы" },
    { label: "Ассистент дня", row: pAssists, value: String(pAssists?.assists ?? 0), sub: "голевые передачи" },
    { label: "Силовой игрок", row: pHits, value: String(pHits?.hits ?? 0), sub: "силовые приёмы" },
    { label: "Блок-мастер", row: pBlocks, value: String(pBlocks?.blocks ?? 0), sub: "заблокированные броски" },
    { label: "Самый бросающий", row: pSog, value: String(pSog?.sog ?? 0), sub: "броски в створ" },
    { label: "Больше всех на льду", row: pToi, value: formatMMSS(pToi?.toi ?? 0), sub: "игровое время" },
    { label: "Лучший +/-", row: pPlus, value: pPlus && pPlus.plusMinus > 0 ? `+${pPlus.plusMinus}` : String(pPlus?.plusMinus ?? 0), sub: "полезность за день" },
  ];

  const bestGoalie = goalies.filter((g) => g.shotsAgainst > 0).sort((a, b) => (b.savePct ?? 0) - (a.savePct ?? 0))[0];

  const arrow = (sort: Sort, key: string) =>
    sort?.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-bold text-ink-soft">Игровой день:</span>
        <select className="inp max-w-52" value={date} onChange={(e) => setDate(e.target.value)}>
          {dates.map((d) => (
            <option key={d} value={d}>{fmtDateRu(d)}</option>
          ))}
        </select>
        <span className="text-xs text-ink-soft">
          {players.length} игроков, {goalies.length} вратарей · клик по заголовку столбца сортирует, повторный — меняет направление, третий — сбрасывает
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="card border-l-4 border-l-accent px-4 py-3">
            <div className="text-[11px] font-bold tracking-wide text-ink-soft uppercase">{c.label}</div>
            {c.row ? (
              <>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold tabular-nums">{c.value}</span>
                  <span className="text-sm font-bold">{c.row.name}</span>
                </div>
                <div className="text-xs text-ink-soft">{c.row.teams.join(", ")} · {c.sub}</div>
              </>
            ) : (
              <div className="mt-1 text-sm text-ink-soft">нет данных</div>
            )}
          </div>
        ))}
      </div>

      {bestGoalie && (
        <div className="card border-l-4 border-l-ice px-4 py-3">
          <div className="text-[11px] font-bold tracking-wide text-ink-soft uppercase">Вратарь дня</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm font-bold">{bestGoalie.name}</span>
            <span className="text-xs text-ink-soft">{bestGoalie.teams.join(", ")}</span>
            <span className="font-mono text-sm font-bold tabular-nums">{fmtPct(bestGoalie.savePct)}</span>
            <span className="text-xs text-ink-soft">
              {bestGoalie.saves} сейвов из {bestGoalie.shotsAgainst} бросков · пропустил {bestGoalie.goalsAgainst} · {formatMMSS(bestGoalie.toi)}
            </span>
          </div>
        </div>
      )}

      <DayMatchFacts date={date} />

      {formByDate && <NextMatchesPanel form={formByDate[date]} date={date} onName={openCard} scoring={scoringByDate?.[date]} />}

      <section className="card overflow-x-auto">
        <div className="border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-extrabold tracking-wide uppercase">Все игроки дня</h2>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="th text-left">№</th>
              {PLAYER_COLS.map((c, idx) => (
                <th
                  key={c.label}
                  title={c.title ?? (c.key === null && idx === 0 ? "Игрок (клик — по алфавиту)" : undefined)}
                  onClick={() => {
                    const k = c.key === null && idx === 0 ? "name" : (c.key as string | null);
                    if (k) setPlayerSort((s) => toggle(s, k));
                  }}
                  className={`th transition select-none ${c.key || idx === 0 ? "cursor-pointer hover:text-ink" : ""} ${
                    c.key === null ? "text-left" : "text-right"
                  } ${playerSort && (playerSort.key === c.key || (c.key === null && idx === 0 && playerSort.key === "name")) ? "text-accent" : ""}`}
                >
                  {c.label}{c.key ? arrow(playerSort, c.key) : idx === 0 ? arrow(playerSort, "name") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((r, i) => (
              <tr key={r.name} className={i % 2 ? "bg-paper/50" : ""}>
                <td className="td font-mono text-xs text-ink-soft">{i + 1}</td>
                <td className="td">
                  <button
                    className="font-bold text-ice underline-offset-2 transition hover:text-accent hover:underline"
                    title="Открыть поматчевую статистику игрока"
                    onClick={() => setPlayerCard(r.name)}
                  >
                    {r.name}
                  </button>
                </td>
                <td className="td text-xs text-ink-soft">{r.teams.join(", ")}</td>
                <td className="td-num">{r.gp}</td>
                <td className="td-num">{r.goals}</td>
                <td className="td-num">{r.assists}</td>
                <td className="td-num bg-ice-soft/60 font-bold">{r.points}</td>
                <td className="td-num">{r.plusMinus > 0 ? `+${r.plusMinus}` : r.plusMinus}</td>
                <td className="td-num">{r.shots}</td>
                <td className="td-num">{r.sog}</td>
                <td className="td-num">{r.hits}</td>
                <td className="td-num">{r.blocks}</td>
                <td className="td-num">{r.pim}</td>
                <td className="td-num">{formatMMSS(r.toi)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {goalies.length > 0 && (
        <section className="card overflow-x-auto">
          <div className="border-b border-line px-4 py-2.5">
            <h2 className="text-sm font-extrabold tracking-wide uppercase">Вратари дня</h2>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {GOALIE_COLS.map((c, idx) => (
                  <th
                    key={c.label}
                    title={c.title ?? (c.key === null && idx === 0 ? "Вратарь (клик — по алфавиту)" : undefined)}
                    onClick={() => {
                      const k = c.key === null && idx === 0 ? "name" : (c.key as string | null);
                      if (k) setGoalieSort((s) => toggle(s, k));
                    }}
                    className={`th transition select-none ${c.key || idx === 0 ? "cursor-pointer hover:text-ink" : ""} ${
                      c.key === null ? "text-left" : "text-right"
                    } ${goalieSort && (goalieSort.key === c.key || (c.key === null && idx === 0 && goalieSort.key === "name")) ? "text-accent" : ""}`}
                  >
                    {c.label}{c.key ? arrow(goalieSort, c.key) : idx === 0 ? arrow(goalieSort, "name") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {goalies.map((r, i) => (
                <tr key={r.name} className={i % 2 ? "bg-paper/50" : ""}>
                  <td className="td">
                    <button
                      className="font-bold text-ice underline-offset-2 transition hover:text-accent hover:underline"
                      title="Открыть по-матчевую статистику вратаря"
                      onClick={() => setGoalieCard(r.name)}
                    >
                      {r.name}
                    </button>
                  </td>
                  <td className="td text-xs text-ink-soft">{r.teams.join(", ")}</td>
                  <td className="td-num">{r.gp}</td>
                  <td className="td-num">{formatMMSS(r.toi)}</td>
                  <td className="td-num">{r.shotsAgainst}</td>
                  <td className="td-num">{r.saves}</td>
                  <td className="td-num">{r.goalsAgainst}</td>
                  <td className="td-num font-bold">{fmtPct(r.savePct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {goalieCard && <GoalieCard name={goalieCard} onClose={() => setGoalieCard(null)} />}
      {playerCard && <PlayerCard name={playerCard} onClose={() => setPlayerCard(null)} />}
    </div>
  );
}
