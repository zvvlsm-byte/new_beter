"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type ArenaEditableRow = {
  team: string;
  arenaName: string | null;
  capacity: number | null;
  homeGames: number;
  gamesWithAttendance: number;
  avg: number | null;
  maxAttendance: number | null;
};

type Draft = { arenaName: string; capacity: string };

const fmtInt = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("ru-RU");

/**
 * Ручной ввод вместимости домашних арен (по командам-хозяйкам).
 * Существующую таблицу посещаемости не трогает — данные только сохраняются
 * в таблицу arena_capacities и используются новой инфографикой ниже.
 */
export function ArenaCapacityEditor({ arenas }: { arenas: ArenaEditableRow[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // синхронизация черновика с данными сервера (в т.ч. после refresh) —
  // только если сами данные изменились, чтобы не терять несохранённый ввод
  const lastSynced = useRef("");
  useEffect(() => {
    const signature = JSON.stringify(arenas.map((a) => [a.team, a.arenaName, a.capacity]));
    if (signature === lastSynced.current) return;
    lastSynced.current = signature;
    const next: Record<string, Draft> = {};
    for (const a of arenas) {
      next[a.team] = {
        arenaName: a.arenaName ?? "",
        capacity: a.capacity === null ? "" : String(a.capacity),
      };
    }
    setDraft(next);
  }, [arenas]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...arenas]
      .filter(
        (a) =>
          !needle ||
          a.team.toLowerCase().includes(needle) ||
          (a.arenaName ?? "").toLowerCase().includes(needle),
      )
      .sort((a, b) => a.team.localeCompare(b.team, "ru"));
  }, [arenas, q]);

  const changed = useMemo(
    () =>
      arenas.filter((a) => {
        const d = draft[a.team];
        if (!d) return false;
        return d.arenaName !== (a.arenaName ?? "") || d.capacity !== (a.capacity === null ? "" : String(a.capacity));
      }),
    [arenas, draft],
  );

  const setField = (team: string, key: keyof Draft, value: string) => {
    setDraft((prev) => ({ ...prev, [team]: { ...prev[team], [key]: value } }));
    setMsg(null);
  };

  const save = async () => {
    if (!changed.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/arena-capacities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: changed.map((a) => {
            const d = draft[a.team];
            const cap = d?.capacity.trim() ?? "";
            const num = cap === "" ? null : Number(cap.replace(/\s/g, "").replace(",", "."));
            return {
              team: a.team,
              arenaName: d?.arenaName.trim() || null,
              capacity: Number.isFinite(num as number) ? num : null,
            };
          }),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setMsg(`Сохранено арен: ${changed.length}`);
      router.refresh();
    } catch {
      setMsg("Не удалось сохранить — попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  };

  const filled = arenas.filter((a) => a.capacity !== null).length;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div>
          <h2 className="text-sm font-extrabold tracking-wide uppercase">Вместимость арен</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Укажите вместимость домашней площадки каждой команды — ниже появятся аншлаги и заполняемость.
            Заполнено: {filled} из {arenas.length}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="inp w-44"
            placeholder="Поиск арены…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn-primary" disabled={busy || !changed.length} onClick={save}>
            {busy ? "Сохраняем…" : `Сохранить${changed.length ? ` (${changed.length})` : ""}`}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {[
                { l: "Команда (арена)", a: "text-left" },
                { l: "Название арены", a: "text-left" },
                { l: "Дом. матчи", a: "text-right" },
                { l: "Со зрителями", a: "text-right" },
                { l: "Средняя", a: "text-right" },
                { l: "Рекорд", a: "text-right" },
                { l: "Вместимость", a: "text-right" },
              ].map((c) => (
                <th key={c.l} className={`th ${c.a}`}>{c.l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a, i) => {
              const d = draft[a.team] ?? { arenaName: "", capacity: "" };
              return (
                <tr key={a.team} className={i % 2 ? "bg-paper/50" : ""}>
                  <td className="td font-bold whitespace-normal">{a.team}</td>
                  <td className="td">
                    <input
                      className="inp min-w-40"
                      placeholder="напр. Ледовый дворец"
                      value={d.arenaName}
                      onChange={(e) => setField(a.team, "arenaName", e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void save()}
                    />
                  </td>
                  <td className="td-num">{a.homeGames || "—"}</td>
                  <td className="td-num">{a.gamesWithAttendance || "—"}</td>
                  <td className="td-num">{fmtInt(a.avg)}</td>
                  <td className="td-num text-ink-soft">{fmtInt(a.maxAttendance)}</td>
                  <td className="td-num">
                    <input
                      className="num w-28"
                      inputMode="numeric"
                      placeholder="0"
                      min={0}
                      value={d.capacity}
                      onChange={(e) => setField(a.team, "capacity", e.target.value.replace(/[^\d\s.,]/g, ""))}
                      onKeyDown={(e) => e.key === "Enter" && void save()}
                      title={
                        a.avg !== null
                          ? `Подсказка: средняя посещаемость ${a.avg.toLocaleString("ru-RU")}`
                          : "Вместимость арены, человек"
                      }
                    />
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="td py-8 text-center text-sm text-ink-soft">
                  Нет домашних команд — импортируйте протоколы матчей
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5 text-xs text-ink-soft">
        <span>
          Аншлаг — матч, где зрителей не меньше вместимости арены. Заполняемость = зрители / вместимость.
        </span>
        {msg && <span className="font-semibold text-ok">{msg}</span>}
        {changed.length > 0 && <span className="font-semibold text-warn">есть несохранённые изменения</span>}
      </div>
    </section>
  );
}
