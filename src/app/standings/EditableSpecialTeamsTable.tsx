"use client";

import { useMemo, useState } from "react";
import { fmtNum, fmtPct } from "@/lib/clean";

export type SpecVals = {
  ppAttempts: number;
  ppGoals: number;
  ppGoalsAgainst: number;
  ppTime: number; // минуты (ВПБ)
  pkAttempts: number;
  pkGoalsAgainst: number;
  pkGoals: number;
  pkTime: number; // минуты (ВПМ)
};

export type EditableSpecialRow = {
  team: string;
  gp: number;
  calc: SpecVals; // рассчитанные значения
  vals: SpecVals; // текущие эффективные значения (ручная корректировка ?? расчёт)
  overridden: boolean;
};

type SortKey =
  | "team"
  | "gp"
  | keyof SpecVals
  | "ppPct"
  | "pkPct"
  | "ppTimePerGame"
  | "pkTimePerGame";

const EDITABLE: { key: keyof SpecVals; label: string; title: string; time?: boolean }[] = [
  { key: "ppAttempts", label: "Бол", title: "Попытки большинства — можно исправить вручную" },
  { key: "ppGoals", label: "ШБ", title: "Голы в большинстве — можно исправить вручную" },
  { key: "ppGoalsAgainst", label: "ПШБ", title: "Пропущено в большинстве — можно исправить вручную" },
  { key: "ppTime", label: "ВПБ", title: "Время в большинстве, мин — можно исправить вручную", time: true },
  { key: "pkAttempts", label: "Мен", title: "Игры в меньшинстве — можно исправить вручную" },
  { key: "pkGoalsAgainst", label: "ПШМ", title: "Пропущено в меньшинстве — можно исправить вручную" },
  { key: "pkGoals", label: "ШМ", title: "Голы в меньшинстве — можно исправить вручную" },
  { key: "pkTime", label: "ВПМ", title: "Время в меньшинстве, мин — можно исправить вручную", time: true },
];

function ppPct(v: SpecVals): number | null {
  return v.ppAttempts ? (v.ppGoals / v.ppAttempts) * 100 : null;
}
function pkPct(v: SpecVals): number | null {
  return v.pkAttempts ? (1 - v.pkGoalsAgainst / v.pkAttempts) * 100 : null;
}

/** Значение строки для сортировки по любой колонке (включая расчётные). */
function sortValue(r: EditableSpecialRow, key: SortKey): number | string {
  switch (key) {
    case "team":
      return r.team;
    case "gp":
      return r.gp;
    case "ppPct":
      return ppPct(r.vals) ?? -Infinity;
    case "pkPct":
      return pkPct(r.vals) ?? -Infinity;
    case "ppTimePerGame":
      return r.gp ? r.vals.ppTime / r.gp : -Infinity;
    case "pkTimePerGame":
      return r.gp ? r.vals.pkTime / r.gp : -Infinity;
    default:
      return r.vals[key];
  }
}

export function EditableSpecialTeamsTable({ rows }: { rows: EditableSpecialRow[] }) {
  const [state, setState] = useState<EditableSpecialRow[]>(rows);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);

  // сортировка: клик — по убыванию, повторный — по возрастанию, третий — исходный порядок
  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s?.key === key ? (s.dir === -1 ? { key, dir: 1 } : null) : { key, dir: -1 },
    );

  const arrow = (key: SortKey) =>
    sort?.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : "";

  const view = useMemo(() => {
    if (!sort) return state;
    return [...state].sort((a, b) => {
      if (sort.key === "team") return a.team.localeCompare(b.team, "ru") * sort.dir;
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      const an = typeof av === "number" ? av : -Infinity;
      const bn = typeof bv === "number" ? bv : -Infinity;
      return (an - bn) * sort.dir || a.team.localeCompare(b.team, "ru");
    });
  }, [state, sort]);

  const setVal = (team: string, key: keyof SpecVals, raw: string) => {
    const num = raw.trim() === "" ? 0 : Number(raw.replace(",", "."));
    if (!Number.isFinite(num)) return;
    setState((prev) =>
      prev.map((r) => (r.team === team ? { ...r, vals: { ...r.vals, [key]: num } } : r)),
    );
  };

  const resetRow = async (team: string) => {
    setState((prev) =>
      prev.map((r) => (r.team === team ? { ...r, vals: { ...r.calc }, overridden: false } : r)),
    );
    try {
      await fetch("/api/special-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: [{ team, ppAttempts: null, ppGoals: null, ppGoalsAgainst: null, ppTimeMinutes: null, pkAttempts: null, pkGoalsAgainst: null, pkGoals: null, pkTimeMinutes: null }],
        }),
      });
    } catch {
      /* локальный сброс уже применён */
    }
  };

  const saveAll = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const resp = await fetch("/api/special-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: state.map((r) => ({
            team: r.team,
            ppAttempts: Math.round(r.vals.ppAttempts),
            ppGoals: Math.round(r.vals.ppGoals),
            ppGoalsAgainst: Math.round(r.vals.ppGoalsAgainst),
            ppTimeMinutes: Math.round(r.vals.ppTime * 10) / 10,
            pkAttempts: Math.round(r.vals.pkAttempts),
            pkGoalsAgainst: Math.round(r.vals.pkGoalsAgainst),
            pkGoals: Math.round(r.vals.pkGoals),
            pkTimeMinutes: Math.round(r.vals.pkTime * 10) / 10,
          })),
        }),
      });
      const d = await resp.json();
      setMsg(resp.ok ? `Сохранено команд: ${d.saved}` : `Ошибка: ${d.error ?? resp.status}`);
      setState((prev) => prev.map((r) => ({ ...r, overridden: true })));
    } catch {
      setMsg("Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  const edited = useMemo(
    () =>
      state.filter((r) =>
        (Object.keys(r.calc) as (keyof SpecVals)[]).some(
          (k) => Math.round(r.vals[k] * 10) / 10 !== Math.round(r.calc[k] * 10) / 10,
        ),
      ).length,
    [state],
  );

  const th = (key: SortKey, label: string, title: string) => (
    <th
      className={`th cursor-pointer transition select-none hover:text-ink ${sort?.key === key ? "text-accent" : ""}`}
      title={`${title} (клик — сортировка)`}
      onClick={() => toggleSort(key)}
    >
      {label}
      {arrow(key)}
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={busy} onClick={() => void saveAll()}>
          {busy ? "Сохраняем…" : "Сохранить корректировки"}
        </button>
        <span className="text-xs text-ink-soft">
          {edited > 0
            ? `Изменено строк: ${edited} (не забудьте сохранить)`
            : "Значения можно править прямо в таблице, % и средние пересчитаются. Клик по заголовку столбца сортирует"}
        </span>
        {msg && <span className="badge bg-ok/15 text-ok">{msg}</span>}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th colSpan={3} className="border-b border-line bg-ink px-2 py-1 text-left text-[11px] font-bold tracking-wider text-white uppercase">Команда</th>
              <th colSpan={6} className="border-b border-line bg-ok px-2 py-1 text-left text-[11px] font-bold tracking-wider text-white uppercase">Большинство</th>
              <th colSpan={6} className="border-b border-line bg-accent px-2 py-1 text-left text-[11px] font-bold tracking-wider text-white uppercase">Меньшинство</th>
              <th colSpan={1} className="border-b border-line bg-ink px-2 py-1" />
            </tr>
            <tr>
              <th className="th">№</th>
              {th("team", "Команда", "Команда")}
              {th("gp", "И", "Игры")}
              {/* Большинство */}
              {th("ppAttempts", "Бол", "Попытки большинства по методу ИИХФ (редактируемое)")}
              {th("ppGoals", "ШБ", "Голы в большинстве (редактируемое)")}
              {th("ppPct", "%Б", "%Б = ШБ ÷ Бол × 100")}
              {th("ppGoalsAgainst", "ПШБ", "Пропущено в большинстве (редактируемое)")}
              {th("ppTime", "ВПБ", "Время в большинстве, мин (редактируемое)")}
              {th("ppTimePerGame", "ВПБ/И", "Среднее время в большинстве за игру = ВПБ ÷ И")}
              {/* Меньшинство */}
              {th("pkAttempts", "Мен", "Игры в меньшинстве (редактируемое)")}
              {th("pkGoalsAgainst", "ПШМ", "Пропущено в меньшинстве (редактируемое)")}
              {th("pkPct", "%М", "%М = 100 − (ПШМ ÷ Мен × 100)")}
              {th("pkGoals", "ШМ", "Голы в меньшинстве (редактируемое)")}
              {th("pkTime", "ВПМ", "Время в меньшинстве, мин (редактируемое)")}
              {th("pkTimePerGame", "ВПМ/И", "Среднее время в меньшинстве за игру = ВПМ ÷ И")}
              <th className="th" title="Сбросить ручные значения к рассчитанным" />
            </tr>
          </thead>
          <tbody>
            {view.map((r, i) => {
              const isEdited = (Object.keys(r.calc) as (keyof SpecVals)[]).some(
                (k) => Math.round(r.vals[k] * 10) / 10 !== Math.round(r.calc[k] * 10) / 10,
              );
              return (
                <tr key={r.team} className={i % 2 ? "bg-paper/50" : ""}>
                  <td className="td w-8 font-mono text-xs text-ink-soft">{i + 1}</td>
                  <td className="td font-bold whitespace-normal">
                    {r.team}
                    {(isEdited || r.overridden) && (
                      <span className="badge ml-1.5 bg-warn/15 text-warn" title="Есть ручная корректировка">✎</span>
                    )}
                  </td>
                  <td className="td-num">{r.gp}</td>
                  <EditableCell value={r.vals.ppAttempts} onChange={(v) => setVal(r.team, "ppAttempts", v)} />
                  <EditableCell value={r.vals.ppGoals} onChange={(v) => setVal(r.team, "ppGoals", v)} />
                  <td className="td-num bg-ice-soft/60 font-bold">{fmtPct(ppPct(r.vals))}</td>
                  <EditableCell value={r.vals.ppGoalsAgainst} onChange={(v) => setVal(r.team, "ppGoalsAgainst", v)} />
                  <EditableCell value={r.vals.ppTime} step={0.1} onChange={(v) => setVal(r.team, "ppTime", v)} />
                  <td className="td-num">{fmtNum(r.gp ? r.vals.ppTime / r.gp : null)}</td>
                  <EditableCell value={r.vals.pkAttempts} onChange={(v) => setVal(r.team, "pkAttempts", v)} />
                  <EditableCell value={r.vals.pkGoalsAgainst} onChange={(v) => setVal(r.team, "pkGoalsAgainst", v)} />
                  <td className="td-num bg-ice-soft/60 font-bold">{fmtPct(pkPct(r.vals))}</td>
                  <EditableCell value={r.vals.pkGoals} onChange={(v) => setVal(r.team, "pkGoals", v)} />
                  <EditableCell value={r.vals.pkTime} step={0.1} onChange={(v) => setVal(r.team, "pkTime", v)} />
                  <td className="td-num">{fmtNum(r.gp ? r.vals.pkTime / r.gp : null)}</td>
                  <td className="td text-right">
                    <button
                      className="btn-danger px-2 py-0.5 text-xs"
                      title="Сбросить ручные значения этой команды к рассчитанным"
                      onClick={() => void resetRow(r.team)}
                    >
                      ⟲
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-4 py-3 text-xs text-ink-soft">
          Попытки считаются по методу ИИХФ (Official Stats): попытка большинства — каждое численное преимущество
          хотя бы в одного игрока длительностью от 1 секунды. Малый штраф (2′) = 1 попытка · двойной малый (4′ или 2+2) =
          2 последовательные попытки, гол закрывает только первую · большой штраф (5′) не сгорает после гола:
          попытки = голы в его окно + 1 · при 5х3 каждое удаление — отдельная попытка · обоюдные штрафы в одно время
          (4х4 / 3х3) попыток не дают, при разнице во времени попытка достаётся команде с преимуществом ·
          формат 6х5 (без удалённого в боксе) не считается · ШБ (0′) и дисциплинарные 10′/20′/25′ не считаются.
          Значения можно править прямо в ячейках для подгонки под официальную таблицу лиги:
          «Сохранить корректировки» записывает изменения, ⟲ возвращает команду к рассчитанным значениям.
          Клик по заголовку столбца сортирует по убыванию, повторный — по возрастанию, третий — возвращает исходный порядок.
        </p>
      </div>
    </div>
  );
}

function EditableCell({ value, onChange, step }: { value: number; onChange: (v: string) => void; step?: number }) {
  return (
    <td className="td-num p-0.5">
      <input
        type="number"
        step={step ?? 1}
        className="num w-16 px-1 py-0.5 text-right"
        value={Number.isInteger(value) ? value : Math.round(value * 10) / 10}
        onChange={(e) => onChange(e.target.value)}
      />
    </td>
  );
}
