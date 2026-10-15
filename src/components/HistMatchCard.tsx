"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HistGame, HistGoalieGame, HistPlayerGame } from "@/db/schema";
import type { HistDetailPlayer, HistDetails, HistPeriodRow } from "@/lib/histDetails";
import { fmtDateRu, formatMMSS } from "@/lib/clean";
import { seasonLabel } from "@/lib/seasonStats";

type Side = "home" | "away";
type CardData = {
  game: Omit<HistGame, "importedAt"> & { importedAt: string; details: HistDetails | null };
  players: HistPlayerGame[];
  goalies: HistGoalieGame[];
  detailsError: string | null;
};

const periodName = (label: string) => (/^\d+$/.test(label) ? `${label}-й период` : label === "ОТ" ? "Овертайм" : label === "СПБ" ? "Буллиты" : label);

function situationBadge(s: string): { text: string; cls: string } | null {
  const u = s.toUpperCase();
  if (!u || u === "РС") return null;
  if (/^\+/.test(u)) return { text: `бол. ${u}`, cls: "bg-ok/10 text-ok" };
  if (/^[-–−]/.test(u)) return { text: `мен. ${u.replace(/^[-–−]/, "−")}`, cls: "bg-warn/10 text-warn" };
  if (/ПВ/.test(u)) return { text: "пустые ворота", cls: "bg-ice-soft text-ice" };
  if (/ШБ/.test(u)) return { text: "штрафной бросок", cls: "bg-accent/10 text-accent" };
  if (/СПБ|БУЛ/.test(u)) return { text: "буллит", cls: "bg-ice-soft text-ice" };
  return { text: u, cls: "bg-line text-ink-soft" };
}

/** Карточка матча из архива старых протоколов: вся статистика на месте. */
export function HistMatchCard({ id, onClose }: { id: number; onClose: () => void }) {
  const [data, setData] = useState<CardData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    (refresh = false) => {
      setBusy(true);
      fetch(`/api/history/games/${id}${refresh ? "?refresh=1" : ""}`)
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || "Ошибка загрузки");
          setData(d);
          setErr(null);
        })
        .catch((e) => setErr(e instanceof Error ? e.message : "Ошибка"))
        .finally(() => setBusy(false));
    },
    [id],
  );
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const g = data?.game;
  const d = g?.details ?? null;
  const team = (s: Side) => (s === "home" ? g?.homeTeam : g?.awayTeam) ?? "";

  // игроки: из подробностей (с бросками) или из базовых данных архива
  const players = useMemo<HistDetailPlayer[]>(() => {
    if (d?.players.length) return d.players;
    return (data?.players ?? []).map((p) => ({
      side: p.side, jersey: p.jersey, name: p.name, position: p.position ?? "", played: p.played, best: false,
      shots: 0, goals: p.goals, assists: p.assists, pim: p.pim, penalties: 0,
    }));
  }, [d, data]);

  const goalies = useMemo(() => {
    if (d?.goalies.length) return d.goalies;
    return (data?.goalies ?? []).map((x) => ({
      side: x.side, jersey: x.jersey ?? 0, name: x.name, toi: formatMMSS(x.toiSeconds), toiSeconds: x.toiSeconds,
      goalsAgainst: x.goalsAgainst, saves: x.saves, shotsAgainst: x.saves !== null ? x.saves + x.goalsAgainst : null,
    }));
  }, [d, data]);

  // сводка по матчу
  const summary = useMemo(() => {
    if (!g) return [];
    const t: HistPeriodRow | null = d?.totals ?? null;
    const pens = d?.penalties ?? [];
    const pimOf = (s: Side) => (t ? (s === "home" ? t.hPim : t.aPim) : null) ?? pens.filter((p) => p.side === s).reduce((a, p) => a + p.minutes, 0);
    const shotsH = t?.hShots ?? null;
    const shotsA = t?.aShots ?? null;
    const plShots = (s: Side) => players.filter((p) => p.side === s && p.position !== "В").reduce((a, p) => a + p.shots, 0);
    const saOf = (s: Side) => {
      const gs = goalies.filter((x) => x.side === s && x.shotsAgainst !== null);
      return gs.length ? gs.reduce((a, x) => a + (x.shotsAgainst ?? 0), 0) : null;
    };
    // броски: таблица «Статистика игры», иначе — сумма «Бр.» игроков, иначе — броски по вратарям соперника
    let sh: [number, number] | null = null;
    let shSrc = "";
    if (shotsH !== null && shotsA !== null && shotsH + shotsA > 0) { sh = [shotsH, shotsA]; shSrc = "по протоколу"; }
    else if (plShots("home") + plShots("away") > 0) { sh = [plShots("home"), plShots("away")]; shSrc = "сумма бросков игроков"; }
    else {
      const a = saOf("away"), h = saOf("home");
      if (a !== null && h !== null) { sh = [a, h]; shSrc = "по сейвам вратарей"; }
    }
    const rows: { label: string; h: number; a: number; hint?: string; fmt?: (v: number) => string }[] = [
      { label: "Голы", h: g.homeScore, a: g.awayScore },
    ];
    if (sh) rows.push({ label: "Броски в створ", h: sh[0], a: sh[1], hint: shSrc });
    if (sh) {
      const eff = (goalsFor: number, shots: number) => (shots > 0 ? (goalsFor / shots) * 100 : 0);
      rows.push({ label: "Реализация бросков, %", h: eff(g.homeScore, sh[0]), a: eff(g.awayScore, sh[1]), fmt: (v) => v.toFixed(1) });
    }
    rows.push({ label: "Удаления (кол-во)", h: pens.filter((p) => p.side === "home").length, a: pens.filter((p) => p.side === "away").length });
    rows.push({ label: "Штрафные минуты", h: pimOf("home") ?? 0, a: pimOf("away") ?? 0 });
    if (t && t.hPpg !== null && t.aPpg !== null) rows.push({ label: "Голы в большинстве", h: t.hPpg, a: t.aPpg ?? 0 });
    if (t && t.hShg !== null && t.aShg !== null) rows.push({ label: "Голы в меньшинстве", h: t.hShg, a: t.aShg ?? 0 });
    if (t && t.hFo !== null && t.aFo !== null && t.hFo + (t.aFo ?? 0) > 0) rows.push({ label: "Выигранные вбрасывания", h: t.hFo, a: t.aFo ?? 0 });
    const sv = (s: Side) => goalies.filter((x) => x.side === s).reduce((a, x) => a + (x.saves ?? 0), 0);
    if (goalies.some((x) => x.saves !== null)) rows.push({ label: "Сейвы вратарей", h: sv("home"), a: sv("away") });
    return rows;
  }, [g, d, players, goalies]);

  const periodsLine = d?.periods.length ? d.periods.map((p) => `${p.hGoals}:${p.aGoals}`).join(", ") : "";

  // хронология голов со счётом по ходу матча
  const timeline = useMemo(() => {
    if (!d) return [];
    const list = [...d.goals].sort((a, b) => (a.shootout === b.shootout ? toSec(a.time) - toSec(b.time) : a.shootout ? 1 : -1));
    let h = 0, a = 0;
    return list.map((x) => {
      const scored = !x.shootout && x.n !== "–" && x.n !== "-";
      if (scored) {
        if (x.side === "home") h++;
        else a++;
      }
      return { ...x, scored, score: `${h}:${a}` };
    });
  }, [d]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card mt-8 w-full max-w-5xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {g && (
              <p className="text-xs font-bold tracking-wide text-ink-soft uppercase">
                {g.competition ?? "Матч"}{g.gameNo ? ` · игра №${g.gameNo}` : ""} · {fmtDateRu(g.date)}
                {d?.startTime ? ` ${d.startTime}` : ""} · сезон {seasonLabel(g.season)}
              </p>
            )}
            {g && (
              <h2 className="mt-1 text-2xl font-extrabold tracking-tight">
                {g.homeTeam} <span className="font-mono text-accent">{g.homeScore}:{g.awayScore}</span> {g.awayTeam}
              </h2>
            )}
            {g && (
              <p className="mt-0.5 text-xs text-ink-soft">
                {periodsLine && <>По периодам: {periodsLine} · </>}
                {d?.arena && <>{d.arena} · </>}
                {g.attendance !== null && <>зрителей: {g.attendance}</>}
              </p>
            )}
            {d && (d.coaches.home || d.coaches.away) && (
              <p className="mt-0.5 text-xs text-ink-soft">
                Главные тренеры: {d.coaches.home ?? "—"} / {d.coaches.away ?? "—"}
              </p>
            )}
          </div>
          <button className="btn shrink-0 px-3" onClick={onClose}>✕ Закрыть</button>
        </div>

        {!data && !err && <p className="py-10 text-center text-sm text-ink-soft">Загрузка статистики матча…</p>}
        {err && <p className="py-6 text-sm font-semibold text-bad">{err}</p>}

        {g && (
          <div className="mt-4 space-y-4">
            {data?.detailsError && !d && (
              <p className="rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-warn">
                Подробности протокола не загрузились ({data.detailsError}). Показаны данные, сохранённые в архиве.
              </p>
            )}

            {/* Сводка */}
            <section className="rounded-md border border-line bg-white p-3">
              <div className="mb-2 grid grid-cols-[1fr_auto_1fr] items-baseline gap-2 text-xs font-extrabold uppercase">
                <span className="truncate">{g.homeTeam}</span>
                <span className="text-ink-soft">Общее по матчу</span>
                <span className="truncate text-right">{g.awayTeam}</span>
              </div>
              <div className="space-y-1.5">
                {summary.map((r) => {
                  const tot = r.h + r.a;
                  const hp = tot > 0 ? (r.h / tot) * 100 : 50;
                  const f = r.fmt ?? ((v: number) => String(v));
                  return (
                    <div key={r.label}>
                      <div className="grid grid-cols-[3rem_1fr_3rem] items-center gap-2 text-sm">
                        <span className={`text-left font-mono font-bold tabular-nums ${r.h > r.a ? "text-ink" : "text-ink-soft"}`}>{f(r.h)}</span>
                        <span className="text-center text-xs text-ink-soft">
                          {r.label}{r.hint ? <span className="text-[10px]"> ({r.hint})</span> : null}
                        </span>
                        <span className={`text-right font-mono font-bold tabular-nums ${r.a > r.h ? "text-ink" : "text-ink-soft"}`}>{f(r.a)}</span>
                      </div>
                      <div className="flex h-1.5 overflow-hidden rounded bg-line">
                        <div className="h-full bg-ice" style={{ width: `${hp}%` }} />
                        <div className="h-full bg-accent" style={{ width: `${100 - hp}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* По периодам */}
            {d && d.periods.length > 0 && (
              <section className="overflow-x-auto rounded-md border border-line bg-white">
                <h3 className="border-b border-line px-3 py-1.5 text-xs font-extrabold uppercase">По периодам</h3>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {["Период", "Голы", "Броски", "Штр. мин", "Голы в бол.", "Голы в мен.", "Вбрасывания"].map((h, i) => (
                        <th key={h} className={`th ${i ? "text-right" : "text-left"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...d.periods, ...(d.totals ? [d.totals] : [])].map((p) => (
                      <tr key={p.label} className={/Всего/i.test(p.label) ? "bg-ice-soft/50 font-bold" : ""}>
                        <td className="td text-sm">{/Всего/i.test(p.label) ? "Всего" : periodName(p.label)}</td>
                        <td className="td-num">{p.hGoals}:{p.aGoals}</td>
                        <td className="td-num">{pairStr(p.hShots, p.aShots)}</td>
                        <td className="td-num">{pairStr(p.hPim, p.aPim, true)}</td>
                        <td className="td-num">{pairStr(p.hPpg, p.aPpg, true)}</td>
                        <td className="td-num">{pairStr(p.hShg, p.aShg, true)}</td>
                        <td className="td-num">{pairStr(p.hFo, p.aFo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Голы */}
            {timeline.length > 0 && (
              <section className="rounded-md border border-line bg-white">
                <h3 className="border-b border-line px-3 py-1.5 text-xs font-extrabold uppercase">Взятие ворот</h3>
                <ul className="divide-y divide-line">
                  {timeline.map((x, i) => {
                    const b = situationBadge(x.situation);
                    return (
                      <li key={i} className={`grid grid-cols-[3.5rem_3rem_1fr] items-baseline gap-2 px-3 py-1.5 text-sm ${x.scored ? "" : "text-ink-soft"}`}>
                        <span className="font-mono text-xs text-ink-soft">{x.time}</span>
                        <span className="font-mono font-bold">{x.scored ? x.score : "—"}</span>
                        <span className={x.side === "away" ? "text-right" : ""}>
                          <span className="text-[11px] font-bold text-ink-soft uppercase">{team(x.side)} · </span>
                          <b>{x.scorer ?? "—"}</b>
                          {(x.a1 || x.a2) && <span className="text-ink-soft"> ({[x.a1, x.a2].filter(Boolean).join(", ")})</span>}
                          {b && <span className={`badge ml-1.5 ${b.cls}`}>{b.text}</span>}
                          {!x.scored && !x.shootout && <span className="badge ml-1.5 bg-line text-ink-soft">не реализован</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* Удаления */}
            {d && (
              <section className="grid gap-3 md:grid-cols-2">
                {(["home", "away"] as const).map((s) => {
                  const list = d.penalties.filter((p) => p.side === s);
                  return (
                    <div key={s} className="rounded-md border border-line bg-white">
                      <h3 className="flex items-baseline justify-between border-b border-line px-3 py-1.5 text-xs font-extrabold uppercase">
                        <span>Удаления · {team(s)}</span>
                        <span className="font-mono text-ink-soft normal-case">{list.length} уд. / {list.reduce((a, p) => a + p.minutes, 0)} мин</span>
                      </h3>
                      {list.length ? (
                        <ul className="divide-y divide-line">
                          {list.map((p, i) => (
                            <li key={i} className="grid grid-cols-[3.5rem_1fr_auto] items-baseline gap-2 px-3 py-1 text-sm">
                              <span className="font-mono text-xs text-ink-soft">{p.time}</span>
                              <span>
                                {p.player ? <b>{p.player}</b> : <b className="text-accent">Командный штраф</b>}
                                {p.jersey !== null && <span className="text-[11px] text-ink-soft"> №{p.jersey}</span>}
                                <span className="block text-xs text-ink-soft">{p.infractionFull || p.infraction}</span>
                              </span>
                              <span className="font-mono font-bold">{p.minutes}′</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="px-3 py-2 text-xs text-ink-soft">Без удалений</p>
                      )}
                    </div>
                  );
                })}
              </section>
            )}

            {/* Вратари */}
            {goalies.length > 0 && (
              <section className="overflow-x-auto rounded-md border border-line bg-white">
                <h3 className="border-b border-line px-3 py-1.5 text-xs font-extrabold uppercase">Вратари</h3>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {["№", "Вратарь", "Команда", "Время", "Броски", "Сейвы", "Пропущено", "%ОБ"].map((h, i) => (
                        <th key={h} className={`th ${i < 3 ? "text-left" : "text-right"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {goalies.map((x) => (
                      <tr key={x.side + x.jersey + x.name}>
                        <td className="td font-mono text-xs text-ink-soft">{x.jersey || ""}</td>
                        <td className="td font-bold">{x.name}</td>
                        <td className="td text-xs text-ink-soft">{team(x.side)}</td>
                        <td className="td-num">{x.toi}</td>
                        <td className="td-num">{x.shotsAgainst ?? "—"}</td>
                        <td className="td-num">{x.saves ?? "—"}</td>
                        <td className="td-num">{x.goalsAgainst}</td>
                        <td className="td-num font-bold">
                          {x.shotsAgainst ? `${((100 * (x.saves ?? 0)) / x.shotsAgainst).toFixed(1)}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Составы */}
            <section className="grid gap-3 lg:grid-cols-2">
              {(["home", "away"] as const).map((s) => {
                const list = players
                  .filter((p) => p.side === s && p.position !== "В")
                  .sort((a, b) => b.goals + b.assists - (a.goals + a.assists) || b.goals - a.goals || b.shots - a.shots || (a.jersey ?? 0) - (b.jersey ?? 0));
                const sum = (k: "goals" | "assists" | "shots" | "pim") => list.reduce((a, p) => a + p[k], 0);
                return (
                  <div key={s} className="overflow-x-auto rounded-md border border-line bg-white">
                    <h3 className="border-b border-line px-3 py-1.5 text-xs font-extrabold uppercase">{team(s)} · полевые игроки</h3>
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          {["№", "Игрок", "Поз", "Г", "П", "О", "Бр", "Штр"].map((h, i) => (
                            <th key={h} className={`th ${i < 3 ? "text-left" : "text-right"}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((p) => (
                          <tr key={p.side + p.jersey + p.name} className={p.played ? "" : "text-ink-soft opacity-60"}>
                            <td className="td font-mono text-xs text-ink-soft">{p.jersey ?? ""}</td>
                            <td className="td text-sm">
                              <span className={p.goals + p.assists > 0 ? "font-bold" : ""}>{p.name}</span>
                              {p.best && <span className="ml-1 text-accent" title="Лучший игрок матча">★</span>}
                              {!p.played && <span className="ml-1 text-[10px]">(не играл)</span>}
                            </td>
                            <td className="td text-xs text-ink-soft">{p.position}</td>
                            <td className="td-num">{p.goals || ""}</td>
                            <td className="td-num">{p.assists || ""}</td>
                            <td className="td-num bg-ice-soft/60 font-bold">{p.goals + p.assists || ""}</td>
                            <td className="td-num">{p.shots || ""}</td>
                            <td className="td-num">{p.pim || ""}</td>
                          </tr>
                        ))}
                        <tr className="bg-paper/60 font-bold">
                          <td className="td" />
                          <td className="td text-xs uppercase">Итого</td>
                          <td className="td" />
                          <td className="td-num">{sum("goals")}</td>
                          <td className="td-num">{sum("assists")}</td>
                          <td className="td-num">{sum("goals") + sum("assists")}</td>
                          <td className="td-num">{sum("shots")}</td>
                          <td className="td-num">{sum("pim")}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </section>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs">
              <a className="font-semibold text-ice hover:underline" href={g.sourceUrl} target="_blank" rel="noreferrer">
                Официальный протокол #{g.extId} ↗
              </a>
              <button className="btn px-2.5 py-1 text-xs" disabled={busy} onClick={() => load(true)}>
                {busy ? "Обновляем…" : "Перечитать протокол"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function toSec(t: string): number {
  const [m, s] = t.split(":").map((x) => parseInt(x, 10));
  return (m || 0) * 60 + (s || 0);
}

function pairStr(h: number | null, a: number | null, showZero = false): string {
  if (h === null || a === null) return "—";
  if (!showZero && h + a === 0) return "—";
  return `${h}:${a}`;
}
