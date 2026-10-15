"use client";

import { useMemo, useState } from "react";
import type { PlayerSeasonRow } from "@/lib/compute";
import { fmtNum, fmtPct, formatMMSS } from "@/lib/clean";
import { PlayerCard } from "@/components/PlayerCard";

export type PlayerRowExt = PlayerSeasonRow & { goalsPer60: number | null; shotsPer60: number | null };

type SortKey =
  | "goalsPer60" | "shotsPer60"
  | "gp" | "goals" | "assists" | "points" | "plusMinus" | "shots" | "shotsOnGoal" | "shotPct"
  | "hits" | "hitsPer60" | "blocks" | "blocksPer60" | "pim" | "toi" | "avgToi" | "foPct";

const COLS: { key: SortKey | null; label: string; title: string }[] = [
  { key: "gp", label: "И", title: "Игры" },
  { key: "goals", label: "Г", title: "Голы" },
  { key: "goalsPer60", label: "Г/60", title: "Голы за 60 минут игрового времени: голы ÷ (время на льду в часах)" },
  { key: "assists", label: "П", title: "Передачи" },
  { key: "points", label: "О", title: "Очки" },
  { key: "plusMinus", label: "+/−", title: "Плюс-минус: сумма показателей за все матчи (+1 за гол команды в равных составах или меньшинстве, −1 за пропущенный)" },
  { key: "shots", label: "Бр", title: "Броски (все)" },
  { key: "shotsOnGoal", label: "БрС", title: "Броски в створ" },
  { key: "shotsPer60", label: "Бр/60", title: "Броски по воротам (в створ) за 60 минут игрового времени: БрС ÷ (время на льду в часах)" },
  { key: "shotPct", label: "%Р", title: "Процент реализации: голы / броски в створ" },
  { key: "hits", label: "Сил", title: "Силовые приёмы" },
  { key: "hitsPer60", label: "Сил/60", title: "Силовые за 60 минут игрового времени" },
  { key: "blocks", label: "Блок", title: "Заблокированные броски" },
  { key: "blocksPer60", label: "Блок/60", title: "Блоки за 60 минут игрового времени" },
  { key: "pim", label: "Штр", title: "Штрафные минуты" },
  { key: "foPct", label: "Вбр%", title: "Процент выигранных вбрасываний" },
  { key: "toi", label: "Время", title: "Суммарное время на льду" },
  { key: "avgToi", label: "Ср.время", title: "Среднее время за матч (общее время / игры)" },
];

export function PlayersTable({
  rows,
  playoffRows = [],
  showStageFilter = false,
}: {
  rows: PlayerRowExt[];
  playoffRows?: PlayerRowExt[];
  showStageFilter?: boolean;
}) {
  const [q, setQ] = useState("");
  const [team, setTeam] = useState("all");
  const [stage, setStage] = useState<"regular" | "playoff">("regular");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "points", dir: -1 });
  const [selected, setSelected] = useState<string | null>(null);
  const source = showStageFilter && stage === "playoff" ? playoffRows : rows;

  const teams = useMemo(() => [...new Set(source.flatMap((r) => r.teams))].sort((a, b) => a.localeCompare(b, "ru")), [source]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const list = source.filter(
      (r) =>
        (!qq || r.name.toLowerCase().includes(qq)) &&
        (team === "all" || r.teams.includes(team)),
    );
    return [...list].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const an = typeof av === "number" ? av : -Infinity;
      const bn = typeof bv === "number" ? bv : -Infinity;
      return (an - bn) * sort.dir || a.name.localeCompare(b.name, "ru");
    });
  }, [source, q, team, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === -1 ? 1 : -1 } : { key, dir: -1 }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {showStageFilter && (
          <div className="flex overflow-hidden rounded-md border border-line">
            {([["regular", "РЧ"], ["playoff", "Плей-офф"]] as const).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setStage(k)}
                className={`px-3 py-1.5 text-sm font-semibold ${stage === k ? "bg-ink text-white" : "bg-white text-ink-soft hover:text-ink"}`}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        <input
          className="inp max-w-64"
          placeholder="Поиск игрока…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="inp max-w-52" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="all">Все команды</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="text-xs text-ink-soft">{filtered.length} из {source.length} игроков · клик по заголовку сортирует</span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="th text-left">№</th>
              <th className="th text-left">Игрок</th>
              <th className="th text-left">Команда</th>
              {COLS.map((c) => (
                <th
                  key={c.key ?? c.label}
                  title={c.title}
                  onClick={() => c.key && toggleSort(c.key)}
                  className={`th cursor-help text-right ${c.key === sort.key ? "text-accent" : ""}`}
                >
                  {c.label}{c.key === sort.key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.name} className={i % 2 ? "bg-paper/50" : ""}>
                <td className="td font-mono text-xs text-ink-soft">{i + 1}</td>
                <td className="td">
                  <button
                    className="font-bold text-ice underline-offset-2 transition hover:text-accent hover:underline"
                    title="Открыть по-матчевую статистику"
                    onClick={() => setSelected(r.name)}
                  >
                    {r.name}
                  </button>
                </td>
                <td className="td text-xs text-ink-soft">{r.teams.join(", ")}</td>
                <td className="td-num">{r.gp}</td>
                <td className="td-num">{r.goals}</td>
                <td className="td-num">{fmtNum(r.goalsPer60, 2)}</td>
                <td className="td-num">{r.assists}</td>
                <td className="td-num bg-ice-soft/60 font-bold">{r.points}</td>
                <td className={`td-num font-semibold ${r.plusMinus > 0 ? "text-ok" : r.plusMinus < 0 ? "text-bad" : ""}`}>
                  {r.plusMinus > 0 ? `+${r.plusMinus}` : r.plusMinus}
                </td>
                <td className="td-num">{r.shots}</td>
                <td className="td-num">{r.shotsOnGoal}</td>
                <td className="td-num">{fmtNum(r.shotsPer60)}</td>
                <td className="td-num">{fmtPct(r.shotPct)}</td>
                <td className="td-num">{r.hits}</td>
                <td className="td-num">{fmtNum(r.hitsPer60)}</td>
                <td className="td-num">{r.blocks}</td>
                <td className="td-num">{fmtNum(r.blocksPer60)}</td>
                <td className="td-num">{r.pim}</td>
                <td className="td-num">{fmtPct(r.foPct, 0)}</td>
                <td className="td-num">{formatMMSS(r.toi)}</td>
                <td className="td-num font-semibold">{formatMMSS(r.avgToi)}</td>
              </tr>
            ))}
            {!filtered.length && (
              <tr><td colSpan={3 + COLS.length} className="td py-8 text-center text-sm text-ink-soft">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && <PlayerCard name={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
