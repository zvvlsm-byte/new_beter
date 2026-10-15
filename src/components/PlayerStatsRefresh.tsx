"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { StatChange, StatRefreshRun } from "@/db/schema";
import { fmtDateRu } from "@/lib/clean";

type Run = Omit<StatRefreshRun, "createdAt"> & { createdAt: string };

const KIND: Record<StatChange["kind"], { label: string; cls: string }> = {
  update: { label: "изменение", cls: "bg-ice-soft text-ice" },
  add: { label: "новый игрок", cls: "bg-ok/10 text-ok" },
  remove: { label: "нет в протоколе", cls: "bg-bad/10 text-bad" },
};

/**
 * «Обновить статистику игроков»: проходит по протоколам, собирает изменения
 * статистики/времени полевых игроков и показывает плашку со списком —
 * по каждому изменению «обновить: да / нет». Командные штрафы и все удаления
 * не затрагиваются. Плашка остаётся, пока её не закроют.
 */
export function PlayerStatsRefresh({ matchCount }: { matchCount: number }) {
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, boolean>>({});
  const [showFailed, setShowFailed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch("/api/refresh-stats")
      .then((r) => r.json())
      .then((d) => setRun(d.run ?? null))
      .catch(() => {});
  }, []);

  const pending = useMemo(() => (run?.changes ?? []).filter((c) => c.status === "pending"), [run]);
  const groups = useMemo(() => {
    const map = new Map<number, { label: string; date: string; items: StatChange[] }>();
    for (const c of run?.changes ?? []) {
      let g = map.get(c.matchId);
      if (!g) {
        g = { label: c.matchLabel, date: c.date, items: [] };
        map.set(c.matchId, g);
      }
      g.items.push(c);
    }
    return [...map.entries()];
  }, [run]);

  async function check() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/refresh-stats", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Ошибка");
      setRun(d.run);
      setDecisions({});
      setCollapsed(false);
      const n = (d.run?.changes ?? []).length;
      setMsg(n ? `Найдено изменений: ${n}` : `Статистика игроков совпадает с протоколами (проверено матчей: ${d.run?.checked ?? 0})`);
    } catch (e) {
      setMsg(e instanceof Error ? `Ошибка: ${e.message}` : "Не удалось проверить протоколы");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!run) return;
    const chosen = Object.fromEntries(Object.entries(decisions).filter(([id]) => pending.some((p) => p.id === id)));
    if (!Object.keys(chosen).length) {
      setMsg("Отметьте «да» или «нет» хотя бы у одного изменения");
      return;
    }
    setApplying(true);
    try {
      const res = await fetch("/api/refresh-stats", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.id, decisions: chosen }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Ошибка");
      setRun(d.run);
      setDecisions({});
      setMsg(`Обновлено: ${d.applied}`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? `Ошибка: ${e.message}` : "Не удалось применить");
    } finally {
      setApplying(false);
    }
  }

  async function dismiss() {
    if (!run) return;
    await fetch(`/api/refresh-stats?id=${run.id}`, { method: "DELETE" }).catch(() => {});
    setRun(null);
    setDecisions({});
  }

  const setAll = (v: boolean) => setDecisions(Object.fromEntries(pending.map((c) => [c.id, v])));
  const decidedCount = pending.filter((c) => c.id in decisions).length;
  const applied = (run?.changes ?? []).filter((c) => c.status === "applied").length;
  const rejected = (run?.changes ?? []).filter((c) => c.status === "rejected").length;

  return (
    <>
      {matchCount > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn"
            disabled={busy}
            title="Пройти по протоколам всех матчей и найти изменения статистики и времени полевых игроков. Ничего не меняется, пока вы не подтвердите изменения. Командные штрафы и удаления не затрагиваются"
            onClick={check}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 11a8 8 0 1 0-2.34 6.34" />
              <path d="M20 4v7h-7" />
            </svg>
            {busy ? "Проверяем протоколы…" : "Обновить статистику игроков"}
          </button>
          {msg && <span className="text-xs text-ink-soft">{msg}</span>}
        </div>
      )}

      {run && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-3 sm:px-6">
          <div className="mx-auto max-w-[1400px] rounded-lg border border-ice/50 bg-card shadow-[0_8px_30px_rgba(20,30,25,0.25)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <div>
                <p className="text-sm font-extrabold">
                  Обновление статистики игроков{" "}
                  <span className="font-semibold text-ink-soft">
                    · проверено матчей: {run.checked}
                    {run.failed ? ` · не удалось: ${run.failed}` : ""}
                  </span>
                </p>
                <p className="text-xs text-ink-soft">
                  Изменений: <b className="text-ink">{run.changes.length}</b> · ожидают решения: <b className="text-ink">{pending.length}</b>
                  {applied ? ` · обновлено: ${applied}` : ""}
                  {rejected ? ` · отклонено: ${rejected}` : ""}
                  {" "}· командные штрафы и удаления не затрагиваются
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {pending.length > 0 && !collapsed && (
                  <>
                    <button className="btn px-2.5 py-1 text-xs" onClick={() => setAll(true)}>Все «да»</button>
                    <button className="btn px-2.5 py-1 text-xs" onClick={() => setAll(false)}>Все «нет»</button>
                    <button className="btn-primary px-3 py-1 text-xs" disabled={applying || !decidedCount} onClick={apply}>
                      {applying ? "Применяем…" : `Применить (${decidedCount})`}
                    </button>
                  </>
                )}
                <button className="btn px-2.5 py-1 text-xs" onClick={() => setCollapsed((v) => !v)}>
                  {collapsed ? "Развернуть" : "Свернуть"}
                </button>
                <button className="btn px-2.5 py-1 text-xs" title="Закрыть плашку" onClick={dismiss}>✕ Закрыть</button>
              </div>
            </div>
            {!collapsed && (
              <div className="max-h-[50vh] overflow-y-auto px-4 py-2">
                {run.failed > 0 && (
                  <div className="mb-2 text-xs">
                    <button className="font-semibold text-warn hover:underline" onClick={() => setShowFailed((v) => !v)}>
                      ⚠ Не удалось загрузить протоколов: {run.failed} {showFailed ? "▲" : "▼"}
                    </button>
                    {showFailed && (
                      <ul className="mt-1 list-disc pl-5 text-ink-soft">
                        {run.failedInfo.map((f) => <li key={f}>{f}</li>)}
                      </ul>
                    )}
                  </div>
                )}
                {!run.changes.length && (
                  <p className="py-4 text-center text-sm text-ink-soft">Изменений нет — статистика игроков совпадает с протоколами.</p>
                )}
                {groups.map(([matchId, g]) => (
                  <div key={matchId} className="mb-3">
                    <p className="mb-1 text-xs font-extrabold tracking-wide uppercase">
                      {fmtDateRu(g.date)} · {g.label}{" "}
                      <a href={`/matches/${matchId}`} className="font-semibold text-ice normal-case hover:underline">открыть →</a>
                    </p>
                    <table className="w-full border-collapse">
                      <tbody>
                        {g.items.map((c) => {
                          const d = decisions[c.id];
                          return (
                            <tr key={c.id} className="align-top">
                              <td className="td w-56">
                                <span className="font-bold">{c.name}</span>
                                <span className="block text-[11px] text-ink-soft">{c.jersey !== null ? `№${c.jersey} · ` : ""}{c.team}</span>
                              </td>
                              <td className="td w-32"><span className={`badge ${KIND[c.kind].cls}`}>{KIND[c.kind].label}</span></td>
                              <td className="td whitespace-normal text-xs">
                                {c.kind === "remove" ? (
                                  <span className="text-ink-soft">Игрока нет в протоколе — удалить строку из матча</span>
                                ) : (
                                  <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                                    {c.fields.map((f) => (
                                      <span key={f.key} className="font-mono">
                                        <b className="font-sans">{f.label}</b>{" "}
                                        {f.from !== null && <span className="text-ink-soft line-through">{String(f.from)}</span>}
                                        {f.from !== null && " → "}
                                        <span className="font-bold text-ink">{String(f.to ?? "—")}</span>
                                      </span>
                                    ))}
                                    {!c.fields.length && <span className="text-ink-soft">без показателей</span>}
                                  </span>
                                )}
                              </td>
                              <td className="td w-44 text-right">
                                {c.status === "pending" ? (
                                  <span className="inline-flex items-center gap-1">
                                    <span className="mr-1 text-[11px] text-ink-soft">обновить:</span>
                                    <button
                                      className={`rounded border px-2 py-0.5 text-xs font-bold ${d === true ? "border-ok bg-ok text-white" : "border-line bg-white hover:border-ok"}`}
                                      onClick={() => setDecisions((p) => ({ ...p, [c.id]: true }))}
                                    >
                                      да
                                    </button>
                                    <button
                                      className={`rounded border px-2 py-0.5 text-xs font-bold ${d === false ? "border-bad bg-bad text-white" : "border-line bg-white hover:border-bad"}`}
                                      onClick={() => setDecisions((p) => ({ ...p, [c.id]: false }))}
                                    >
                                      нет
                                    </button>
                                  </span>
                                ) : c.status === "applied" ? (
                                  <span className="badge bg-ok/10 text-ok">✓ обновлено</span>
                                ) : (
                                  <span className="badge bg-line text-ink-soft">оставлено как есть</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
