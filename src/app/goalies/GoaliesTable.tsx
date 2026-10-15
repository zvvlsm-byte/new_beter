"use client";

import { useMemo, useState } from "react";
import type { GoalieSeasonRow } from "@/lib/compute";
import { fmtNum, fmtPct, formatMMSS } from "@/lib/clean";
import { GoalieCard } from "@/components/GoalieCard";

type SortKey = "rostered" | "gp" | "wins" | "losses" | "toi" | "shotsAgainst" | "saves" | "goalsAgainst" | "savePct" | "gaa" | "shutouts" | "assists" | "hits" | "blocks" | "avgToi";

const COLS: { key: SortKey; label: string; title: string }[] = [
  { key: "rostered", label: "З", title: "Заявлен — сколько раз был в заявке на матч" },
  { key: "gp", label: "И", title: "Игры — сколько раз реально выходил на лёд (было игровое время)" },
  { key: "wins", label: "В", title: "Победы (команда выиграла матч)" },
  { key: "losses", label: "П", title: "Поражения" },
  { key: "toi", label: "Время", title: "Суммарное время на льду" },
  { key: "shotsAgainst", label: "Бр", title: "Броски по воротам (сейвы + пропущенные)" },
  { key: "saves", label: "Сейвы", title: "Отражённые броски" },
  { key: "goalsAgainst", label: "Пр", title: "Пропущенные шайбы" },
  { key: "savePct", label: "%ОБ", title: "Процент отражённых бросков: сейвы / броски" },
  { key: "gaa", label: "КН", title: "Коэффициент надёжности: пропущено за 60 минут" },
  { key: "shutouts", label: "Сух", title: "Сухие матчи (играл и не пропускал)" },
  { key: "assists", label: "Пас", title: "Голевые передачи вратаря" },
  { key: "hits", label: "Сп", title: "Силовые приёмы вратаря" },
  { key: "blocks", label: "Бл", title: "Заблокированные броски вратаря" },
  { key: "avgToi", label: "Ср.время", title: "Среднее время за матч" },
];

export function GoaliesTable({
  rows,
  playoffRows = [],
  showStageFilter = false,
}: {
  rows: GoalieSeasonRow[];
  playoffRows?: GoalieSeasonRow[];
  showStageFilter?: boolean;
}) {
  const [q, setQ] = useState("");
  const [team, setTeam] = useState("all");
  const [stage, setStage] = useState<"regular" | "playoff">("regular");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "toi", dir: -1 });
  const [selected, setSelected] = useState<string | null>(null);
  const source = showStageFilter && stage === "playoff" ? playoffRows : rows;

  const teams = useMemo(() => [...new Set(source.flatMap((r) => r.teams))].sort((a, b) => a.localeCompare(b, "ru")), [source]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const list = source.filter(
      (r) => (!qq || r.name.toLowerCase().includes(qq)) && (team === "all" || r.teams.includes(team)),
    );
    return [...list].sort((a, b) => {
      const an = a[sort.key] ?? -Infinity;
      const bn = b[sort.key] ?? -Infinity;
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
        <input className="inp max-w-64" placeholder="Поиск вратаря…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="inp max-w-52" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="all">Все команды</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="text-xs text-ink-soft">{filtered.length} из {source.length} вратарей</span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="th text-left">№</th>
              <th className="th text-left">Вратарь</th>
              <th className="th text-left">Команда</th>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  title={c.title}
                  onClick={() => toggleSort(c.key)}
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
                    title="Открыть по-матчевую статистику вратаря"
                    onClick={() => setSelected(r.name)}
                  >
                    {r.name}
                  </button>
                </td>
                <td className="td text-xs text-ink-soft">{r.teams.join(", ")}</td>
                <td className="td-num" title="Заявлен">{r.rostered}</td>
                <td className="td-num" title="Игр (с игровым временем)">{r.gp}</td>
                <td className="td-num text-ok">{r.wins}</td>
                <td className="td-num text-bad">{r.losses}</td>
                <td className="td-num">{formatMMSS(r.toi)}</td>
                <td className="td-num">{r.shotsAgainst}</td>
                <td className="td-num">{r.saves}</td>
                <td className="td-num">{r.goalsAgainst}</td>
                <td className="td-num bg-ice-soft/60 font-bold">{fmtPct(r.savePct)}</td>
                <td className="td-num">{fmtNum(r.gaa, 2)}</td>
                <td className="td-num">{r.shutouts}</td>
                <td className="td-num">{r.assists || "—"}</td>
                <td className="td-num">{r.hits || "—"}</td>
                <td className="td-num">{r.blocks || "—"}</td>
                <td className="td-num font-semibold">{formatMMSS(r.avgToi)}</td>
              </tr>
            ))}
            {!filtered.length && (
              <tr><td colSpan={3 + COLS.length} className="td py-8 text-center text-sm text-ink-soft">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && <GoalieCard name={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
