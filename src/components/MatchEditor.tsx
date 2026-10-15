"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MatchPayload } from "@/lib/api";
import type { Side } from "@/db/schema";
import { remarkCoincidental, type ReconcileItemWithStatus } from "@/lib/official";
import { corsiFromSides, sumSide } from "@/lib/corsi";
import { fmtPct } from "@/lib/clean";

type Props = { initial: MatchPayload; matchId?: number };

const n0 = (v: string) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
};

export function MatchEditor({ initial, matchId }: Props) {
  const router = useRouter();
  const [p, setP] = useState<MatchPayload>({ ...initial, stage: initial.stage ?? "regular" });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (part: Partial<MatchPayload>) => setP((prev) => ({ ...prev, ...part }));

  const setRow = <K extends "skaters" | "goalies" | "goals" | "penalties">(
    key: K,
    idx: number,
    part: Partial<MatchPayload[K][number]>,
  ) =>
    setP((prev) => ({
      ...prev,
      [key]: (prev[key] as object[]).map((r, i) => (i === idx ? { ...r, ...part } : r)),
    }) as MatchPayload);

  const delRow = (key: "skaters" | "goalies" | "goals" | "penalties", idx: number) =>
    setP((prev) => ({ ...prev, [key]: (prev[key] as object[]).filter((_r, i) => i !== idx) }));

  const addSkater = (side: Side) =>
    setP((prev) => ({
      ...prev,
      skaters: [
        ...prev.skaters,
        {
          side, jersey: null, position: "Н", name: "", goals: 0, assists: 0, plusMinus: 0,
          shots: 0, shotsOnGoal: 0, hits: 0, blocks: 0, pim: 0, toi: "", faceoffs: 0, faceoffWins: 0,
        },
      ],
    }));

  const addGoalie = (side: Side) =>
    setP((prev) => ({
      ...prev,
      goalies: [...prev.goalies, {
        side, jersey: null, name: "", toi: "", saves: 0, goalsAgainst: 0, result: "" as const,
        goals: 0, assists: 0, shots: 0, shotsOnGoal: 0, hits: 0, blocks: 0, pim: 0, periodToi: [],
      }],
    }));

  const addGoal = () =>
    setP((prev) => ({
      ...prev,
      goals: [...prev.goals, { side: "home" as Side, period: 1, time: "", strength: "eq" as const, emptyNet: false, scorer: "", assist1: "", assist2: "" }],
    }));

  const addPenalty = () =>
    setP((prev) => ({
      ...prev,
      penalties: [...prev.penalties, { side: "home" as Side, period: 1, time: "", minutes: 2, player: "", infraction: "", coincidental: false, penaltyShot: false }],
    }));

  const goalsBySide = (side: Side) => p.goals.filter((g) => g.side === side).length;
  const pimBySide = (side: Side) => p.penalties.filter((x) => x.side === side).reduce((a, x) => a + x.minutes, 0);
  const teamName = (side: Side) => (side === "home" ? p.homeTeam || "Хозяева" : p.awayTeam || "Гости");

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const url = matchId ? `/api/matches/${matchId}` : "/api/matches";
      const resp = await fetch(url, {
        method: matchId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      let data: { id?: number; error?: string } = {};
      try {
        data = await resp.json();
      } catch {
        if (!resp.ok) throw new Error(`Ошибка сервера (${resp.status})`);
      }
      if (!resp.ok) throw new Error(data.error || "Ошибка сохранения");
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
      router.push(`/matches/${matchId ?? data.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false); // кнопка разблокируется при любом исходе
    }
  }

  async function remove() {
    if (!matchId) return;
    if (!confirm("Удалить матч вместе со всей статистикой?")) return;
    await fetch(`/api/matches/${matchId}`, { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  // ---- сверка с официальным протоколом (догрузка командных штрафов, времени вратарей) ----
  const [reconcileUrl, setReconcileUrl] = useState("");
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const [reconcileInfo, setReconcileInfo] = useState<{
    summary: string;
    matched: number;
    teamWarning: string | null;
  } | null>(null);
  const [reconcileItems, setReconcileItems] = useState<ReconcileItemWithStatus[]>([]);

  async function runReconcile() {
    if (!matchId) return;
    setReconcileBusy(true);
    setReconcileError(null);
    try {
      const resp = await fetch("/api/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, url: reconcileUrl }),
      });
      const d = await resp.json();
      if (!resp.ok) throw new Error(d.error || "Ошибка сверки");
      setReconcileInfo({
        summary: `${d.official.homeTeam} — ${d.official.awayTeam}: удалений в протоколе ${d.official.penaltyCount}, вратарей ${d.official.goalieCount}`,
        matched: d.matched,
        teamWarning: d.teamWarning ?? null,
      });
      setReconcileItems(
        (d.items as ReconcileItemWithStatus[]).map((it) => ({ ...it, status: "pending" as const })),
      );
    } catch (e) {
      setReconcileError(e instanceof Error ? e.message : "Ошибка сверки");
      setReconcileInfo(null);
      setReconcileItems([]);
    } finally {
      setReconcileBusy(false);
    }
  }

  /** Принять/отклонить одно расхождение (или все сразу). Принятые изменения
   *  применяются к данным матча и попадают в базу после «Сохранить изменения». */
  function decideReconcile(targetIdx: number | "all", accept: boolean) {
    const pens = [...p.penalties];
    const goalies = [...p.goalies];
    const out = reconcileItems.map((it) => ({ ...it }));
    for (let i = 0; i < out.length; i++) {
      const it = out[i];
      if (it.status !== "pending") continue;
      if (targetIdx !== "all" && i !== targetIdx) continue;
      if (!accept) {
        out[i] = { ...it, status: "rejected" };
        continue;
      }
      switch (it.kind) {
        case "add-penalty":
          pens.push(it.pen);
          break;
        case "update-penalty":
          if (pens[it.index]) pens[it.index] = { ...pens[it.index], ...it.changes };
          break;
        case "remove-penalty":
          pens.splice(it.index, 1);
          // сдвигаем индексы у последующих правок списка удалений
          for (let j = i + 1; j < out.length; j++) {
            const o = out[j];
            if ((o.kind === "update-penalty" || o.kind === "remove-penalty") && o.index > it.index) {
              out[j] = { ...o, index: o.index - 1 };
            }
          }
          break;
        case "goalie-update":
          if (goalies[it.goalieIndex]) goalies[it.goalieIndex] = { ...goalies[it.goalieIndex], ...it.changes };
          break;
        case "add-goalie":
          goalies.push(it.goalie);
          break;
      }
      out[i] = { ...it, status: "accepted" };
    }
    setP((prev) => ({ ...prev, penalties: remarkCoincidental(pens), goalies }));
    setReconcileItems(out);
  }

  const pendingCount = reconcileItems.filter((it) => it.status === "pending").length;
  const acceptedCount = reconcileItems.filter((it) => it.status === "accepted").length;

  const periodSum = p.periods.reduce((acc, per) => ({ h: acc.h + per.h, a: acc.a + per.a }), { h: 0, a: 0 });

  const skaterCols = ["№", "Поз", "Фамилия и имя", "Г", "П", "+/-", "Бр", "БрС", "Сп", "Бл", "Штр", "Время", "Вбр", "ВВбр", ""];

  // ---- сводка матча: считается «на лету» из текущих данных, чтобы сверять с протоколом ----
  const sumSk = (side: Side, get: (s: MatchPayload["skaters"][number]) => number) =>
    p.skaters.filter((s) => s.side === side).reduce((a, s) => a + get(s), 0);
  const sumG = (side: Side, get: (g: MatchPayload["goalies"][number]) => number) =>
    p.goalies.filter((g) => g.side === side).reduce((a, g) => a + get(g), 0);
  const summary = [
    { label: "Броски", h: sumSk("home", (s) => s.shots), a: sumSk("away", (s) => s.shots), hint: "Все броски по воротам (сумма Б из протокола)" },
    { label: "Бр. в створ", h: sumSk("home", (s) => s.shotsOnGoal), a: sumSk("away", (s) => s.shotsOnGoal), hint: "Броски в створ (сумма Бс)" },
    { label: "ВБР", h: sumSk("home", (s) => s.faceoffWins), a: sumSk("away", (s) => s.faceoffWins), hint: "Выигранные вбрасывания (сумма ВВбр)" },
    { label: "Штраф", h: p.penalties.filter((x) => x.side === "home").reduce((a, x) => a + x.minutes, 0), a: p.penalties.filter((x) => x.side === "away").reduce((a, x) => a + x.minutes, 0), hint: "Штрафные минуты (сумма удалений, включая командные)" },
    { label: "Силовые", h: sumSk("home", (s) => s.hits) + sumG("home", (g) => g.hits), a: sumSk("away", (s) => s.hits) + sumG("away", (g) => g.hits), hint: "Силовые приёмы, включая вратарей (сумма Сп)" },
    { label: "Блок.", h: sumSk("home", (s) => s.blocks) + sumG("home", (g) => g.blocks), a: sumSk("away", (s) => s.blocks) + sumG("away", (g) => g.blocks), hint: "Заблокированные броски, включая вратарей (сумма БлБ)" },
  ];

  // ---- Корси матча (по кнопке «Посчитать корси»): считается из текущих данных состава ----
  const [showCorsi, setShowCorsi] = useState(false);
  const corsiSide = (side: Side) => sumSide([...p.skaters.filter((s) => s.side === side), ...p.goalies.filter((g) => g.side === side)]);
  const corsiHome = corsiFromSides(corsiSide("home"), corsiSide("away"));
  const corsiAway = corsiFromSides(corsiSide("away"), corsiSide("home"));

  return (
    <div className="space-y-5">
      {/* ------- шапка матча ------- */}
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-extrabold tracking-wide uppercase">Матч</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-bold text-ink-soft">Дата</span>
            <input type="date" className="inp" value={p.date} onChange={(e) => patch({ date: e.target.value })} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-bold text-ink-soft">Хозяева</span>
            <input className="inp" value={p.homeTeam} placeholder="Название команды" onChange={(e) => patch({ homeTeam: e.target.value })} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-bold text-ink-soft">Гости</span>
            <input className="inp" value={p.awayTeam} placeholder="Название команды" onChange={(e) => patch({ awayTeam: e.target.value })} />
          </label>
          <div className="text-sm">
            <span className="mb-1 block text-xs font-bold text-ink-soft">Счёт</span>
            <div className="flex items-center gap-2">
              <input className="num w-16" value={p.homeScore} onChange={(e) => patch({ homeScore: n0(e.target.value) })} />
              <span className="font-bold text-ink-soft">:</span>
              <input className="num w-16" value={p.awayScore} onChange={(e) => patch({ awayScore: n0(e.target.value) })} />
              <select className="inp flex-1" value={p.winType} onChange={(e) => patch({ winType: e.target.value as MatchPayload["winType"] })}>
                <option value="reg">осн. время</option>
                <option value="ot">овертайм</option>
                <option value="so">буллиты</option>
              </select>
            </div>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-bold text-ink-soft">Зрители</span>
            <input
              className="inp"
              placeholder="например 732"
              value={p.attendance ?? ""}
              onChange={(e) => patch({ attendance: e.target.value === "" ? null : n0(e.target.value) })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-bold text-ink-soft">Стадия</span>
            <select
              className="inp"
              value={p.stage ?? "regular"}
              onChange={(e) => patch({ stage: e.target.value as MatchPayload["stage"] })}
            >
              <option value="regular">Регулярный чемпионат</option>
              <option value="playoff">Плей-офф</option>
              <option value="playin">Плей-ин</option>
            </select>
          </label>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="text-sm">
            <span className="mb-1 block text-xs font-bold text-ink-soft">Голы по периодам</span>
            <div className="flex flex-wrap items-center gap-2">
              {p.periods.map((per, i) => (
                <span key={i} className="flex flex-col gap-0.5 rounded-md border border-line bg-white px-1.5 py-1">
                  <span className="flex items-center gap-1">
                    <span className="w-6 text-[10px] font-bold text-ink-soft">{i === 3 ? "ОТ" : `${i + 1}п`}</span>
                    <input
                      className="num w-11 border-0 px-1 py-0.5 text-sm focus:ring-0"
                      title="Голы"
                      value={per.h}
                      onChange={(e) => patch({ periods: p.periods.map((x, j) => (j === i ? { ...x, h: n0(e.target.value) } : x)) })}
                    />
                    <span className="text-ink-soft">:</span>
                    <input
                      className="num w-11 border-0 px-1 py-0.5 text-sm focus:ring-0"
                      title="Голы"
                      value={per.a}
                      onChange={(e) => patch({ periods: p.periods.map((x, j) => (j === i ? { ...x, a: n0(e.target.value) } : x)) })}
                    />
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-6 text-[10px] font-bold text-ink-soft">Бс</span>
                    <input
                      className="num w-11 border-0 px-1 py-0.5 text-sm focus:ring-0"
                      title="Броски в створ"
                      value={per.hSog ?? ""}
                      placeholder="—"
                      onChange={(e) => patch({ periods: p.periods.map((x, j) => (j === i ? { ...x, hSog: e.target.value === "" ? undefined : n0(e.target.value) } : x)) })}
                    />
                    <span className="text-ink-soft">:</span>
                    <input
                      className="num w-11 border-0 px-1 py-0.5 text-sm focus:ring-0"
                      title="Броски в створ"
                      value={per.aSog ?? ""}
                      placeholder="—"
                      onChange={(e) => patch({ periods: p.periods.map((x, j) => (j === i ? { ...x, aSog: e.target.value === "" ? undefined : n0(e.target.value) } : x)) })}
                    />
                  </span>
                </span>
              ))}
              <button className="btn px-2 py-1 text-xs" onClick={() => patch({ periods: [...p.periods, { h: 0, a: 0 }] })}>
                + период
              </button>
              {p.periods.length > 1 && (
                <button className="btn px-2 py-1 text-xs" onClick={() => patch({ periods: p.periods.slice(0, -1) })}>
                  − период
                </button>
              )}
              <button
                className="btn px-2 py-1 text-xs"
                title="Подставить сумму периодов как итоговый счёт"
                onClick={() => patch({ homeScore: periodSum.h, awayScore: periodSum.a })}
              >
                счёт = сумма периодов
              </button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-bold text-ink-soft">Источник (ссылка на протокол)</span>
              <input className="inp" value={p.sourceUrl} placeholder="https://hockey.by/…" onChange={(e) => patch({ sourceUrl: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-bold text-ink-soft">Заметка</span>
              <input className="inp" value={p.notes ?? ""} placeholder="например: командный штраф добавлен вручную" onChange={(e) => patch({ notes: e.target.value })} />
            </label>
          </div>
        </div>
      </section>

      {/* ------- сводка матча ------- */}
      <section className="card p-4" title="Итоговые показатели для сверки с протоколом">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-extrabold tracking-wide uppercase">Сводка матча</h2>
          <span className="text-xs text-ink-soft">{p.homeTeam} — {p.awayTeam}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {summary.map((s) => (
            <div key={s.label} className="rounded-md border border-line bg-white px-3 py-2" title={s.hint}>
              <div className="text-[11px] font-bold tracking-wide text-ink-soft uppercase">{s.label}</div>
              <div className="mt-0.5 font-mono text-xl font-bold tabular-nums">
                {s.h}<span className="text-ink-soft">:</span>{s.a}
              </div>
            </div>
          ))}
          <div className="rounded-md border border-line bg-white px-3 py-2" title="Количество зрителей (из шапки протокола)">
            <div className="text-[11px] font-bold tracking-wide text-ink-soft uppercase">Зрители</div>
            <div className="mt-0.5 font-mono text-xl font-bold tabular-nums">
              {p.attendance !== null ? p.attendance.toLocaleString("ru-RU") : "—"}
            </div>
          </div>
          {showCorsi && (
            <>
              <div className="rounded-md border border-ok/40 bg-ok/5 px-3 py-2" title="Corsi For: все бросковые попытки команды (CF хозяев : CF гостей)">
                <div className="text-[11px] font-bold tracking-wide text-ink-soft uppercase">Корси (CF)</div>
                <div className="mt-0.5 font-mono text-xl font-bold tabular-nums">
                  {corsiHome.cf}<span className="text-ink-soft">:</span>{corsiAway.cf}
                </div>
              </div>
              <div className="rounded-md border border-ok/40 bg-ok/5 px-3 py-2" title="Процент Корси: CF ÷ (CF + CA) × 100%">
                <div className="text-[11px] font-bold tracking-wide text-ink-soft uppercase">CF%</div>
                <div className="mt-0.5 font-mono text-xl font-bold tabular-nums">
                  {fmtPct(corsiHome.pct)}<span className="text-ink-soft"> : </span>{fmtPct(corsiAway.pct)}
                </div>
              </div>
              <div className="rounded-md border border-ok/40 bg-ok/5 px-3 py-2" title="Разница Корси: CF − CA">
                <div className="text-[11px] font-bold tracking-wide text-ink-soft uppercase">Корси±</div>
                <div className="mt-0.5 font-mono text-xl font-bold tabular-nums">
                  {corsiHome.diff > 0 ? `+${corsiHome.diff}` : corsiHome.diff}
                  <span className="text-ink-soft">:</span>
                  {corsiAway.diff > 0 ? `+${corsiAway.diff}` : corsiAway.diff}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn px-3 py-1 text-xs" onClick={() => setShowCorsi((v) => !v)}>
            {showCorsi ? "Скрыть корси" : "Посчитать корси"}
          </button>
          {showCorsi && (
            <span className="text-[11px] text-ink-soft">
              CF = голы + броски в створ + мимо + заблокированные соперником · CA — то же для соперника · CF% = CF ÷ (CF + CA)
            </span>
          )}
        </div>
        {showCorsi && (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["Команда", "Голы", "В створ (без голов)", "Мимо", "Заблок. соперником", "CF", "CA", "Корси±", "CF%"].map((h) => (
                    <th key={h} className={`th ${h === "Команда" ? "text-left" : "text-right"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {([["home", corsiHome], ["away", corsiAway]] as const).map(([side, c]) => (
                  <tr key={side}>
                    <td className="td font-bold">{teamName(side)}</td>
                    <td className="td-num">{c.goals}</td>
                    <td className="td-num">{c.sogExGoals}</td>
                    <td className="td-num">{c.missed}</td>
                    <td className="td-num">{c.blockedByOpp}</td>
                    <td className="td-num font-bold">{c.cf}</td>
                    <td className="td-num">{c.ca}</td>
                    <td className={`td-num font-semibold ${c.diff > 0 ? "text-ok" : c.diff < 0 ? "text-bad" : ""}`}>{c.diff > 0 ? `+${c.diff}` : c.diff}</td>
                    <td className="td-num font-bold">{fmtPct(c.pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------- полевые игроки ------- */}
      <div className="grid gap-5 2xl:grid-cols-2">
        {(["home", "away"] as Side[]).map((side) => {
          const rows = p.skaters.filter((s) => s.side === side);
          return (
            <section key={side} className="card p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-sm font-extrabold tracking-wide uppercase">
                  Полевые игроки · <span className="text-accent">{teamName(side)}</span>
                </h2>
                <button className="btn px-2 py-1 text-xs" onClick={() => addSkater(side)}>+ игрок</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {skaterCols.map((c) => (
                        <th key={c} className="th text-right first:text-left">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => {
                      const idx = p.skaters.indexOf(s);
                      return (
                        <tr key={idx} className="hover:bg-paper/60">
                          <td className="td w-12"><input className="num w-11" value={s.jersey ?? ""} onChange={(e) => setRow("skaters", idx, { jersey: e.target.value === "" ? null : n0(e.target.value) })} /></td>
                          <td className="td w-14">
                            <select className="inp px-1 py-1 text-center" value={s.position} onChange={(e) => setRow("skaters", idx, { position: e.target.value })}>
                              <option>Н</option><option>З</option>
                            </select>
                          </td>
                          <td className="td min-w-[180px]"><input className="inp" placeholder="Фамилия Имя" value={s.name} onChange={(e) => setRow("skaters", idx, { name: e.target.value })} /></td>
                          <td className="td w-12"><input className="num w-11" value={s.goals} onChange={(e) => setRow("skaters", idx, { goals: n0(e.target.value) })} /></td>
                          <td className="td w-12"><input className="num w-11" value={s.assists} onChange={(e) => setRow("skaters", idx, { assists: n0(e.target.value) })} /></td>
                          <td className="td w-12"><input className="num w-11" value={s.plusMinus} onChange={(e) => setRow("skaters", idx, { plusMinus: n0(e.target.value) })} /></td>
                          <td className="td w-12"><input className="num w-11" value={s.shots} onChange={(e) => setRow("skaters", idx, { shots: n0(e.target.value) })} /></td>
                          <td className="td w-12"><input className="num w-11" value={s.shotsOnGoal} onChange={(e) => setRow("skaters", idx, { shotsOnGoal: n0(e.target.value) })} /></td>
                          <td className="td w-12"><input className="num w-11" value={s.hits} onChange={(e) => setRow("skaters", idx, { hits: n0(e.target.value) })} /></td>
                          <td className="td w-12"><input className="num w-11" value={s.blocks} onChange={(e) => setRow("skaters", idx, { blocks: n0(e.target.value) })} /></td>
                          <td className="td w-12"><input className="num w-11" value={s.pim} onChange={(e) => setRow("skaters", idx, { pim: n0(e.target.value) })} /></td>
                          <td className="td w-20"><input className="num w-16" placeholder="мм:сс" value={s.toi} onChange={(e) => setRow("skaters", idx, { toi: e.target.value })} /></td>
                          <td className="td w-12"><input className="num w-11" value={s.faceoffs} onChange={(e) => setRow("skaters", idx, { faceoffs: n0(e.target.value) })} /></td>
                          <td className="td w-12"><input className="num w-11" value={s.faceoffWins} onChange={(e) => setRow("skaters", idx, { faceoffWins: n0(e.target.value) })} /></td>
                          <td className="td w-8"><button className="btn-danger px-1.5 py-0.5 text-xs" onClick={() => delRow("skaters", idx)}>✕</button></td>
                        </tr>
                      );
                    })}
                    {!rows.length && (
                      <tr><td colSpan={15} className="td py-4 text-center text-sm text-ink-soft">Игроков нет — добавьте строки</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>

      {/* ------- вратари ------- */}
      <div className="grid gap-5 2xl:grid-cols-2">
        {(["home", "away"] as Side[]).map((side) => {
          const rows = p.goalies.filter((g) => g.side === side);
          return (
            <section key={side} className="card p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-sm font-extrabold tracking-wide uppercase">
                  Вратари · <span className="text-ice">{teamName(side)}</span>
                </h2>
                <button className="btn px-2 py-1 text-xs" onClick={() => addGoalie(side)}>+ вратарь</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {["№", "Фамилия и имя", "Время", "Сейвы", "Пропущено", "Броски (авто)", "Сп", "Бл", "В/П", ""].map((c) => (
                        <th key={c} title={c === "Сп" ? "Силовые приёмы вратаря" : c === "Бл" ? "Заблокированные броски вратаря" : undefined} className="th text-right first:text-left">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((g) => {
                      const idx = p.goalies.indexOf(g);
                      return (
                        <tr key={idx} className="hover:bg-paper/60">
                          <td className="td w-12"><input className="num w-11" value={g.jersey ?? ""} onChange={(e) => setRow("goalies", idx, { jersey: e.target.value === "" ? null : n0(e.target.value) })} /></td>
                          <td className="td min-w-[180px]"><input className="inp" placeholder="Фамилия Имя" value={g.name} onChange={(e) => setRow("goalies", idx, { name: e.target.value })} /></td>
                          <td className="td w-20"><input className="num w-16" placeholder="мм:сс" value={g.toi} onChange={(e) => setRow("goalies", idx, { toi: e.target.value })} /></td>
                          <td className="td w-14"><input className="num w-13" value={g.saves} onChange={(e) => setRow("goalies", idx, { saves: n0(e.target.value) })} /></td>
                          <td className="td w-14"><input className="num w-13" value={g.goalsAgainst} onChange={(e) => setRow("goalies", idx, { goalsAgainst: n0(e.target.value) })} /></td>
                          <td className="td-num w-14 text-ink-soft">{g.saves + g.goalsAgainst}</td>
                          <td className="td w-12"><input className="num w-11" title="Силовые приёмы вратаря" value={g.hits} onChange={(e) => setRow("goalies", idx, { hits: n0(e.target.value) })} /></td>
                          <td className="td w-12"><input className="num w-11" title="Заблокированные броски вратаря" value={g.blocks} onChange={(e) => setRow("goalies", idx, { blocks: n0(e.target.value) })} /></td>
                          <td className="td w-20">
                            <select className="inp px-1 py-1" value={g.result} onChange={(e) => setRow("goalies", idx, { result: e.target.value as "" | "W" | "L" })}>
                              <option value="">—</option><option value="W">W</option><option value="L">L</option>
                            </select>
                          </td>
                          <td className="td w-8"><button className="btn-danger px-1.5 py-0.5 text-xs" onClick={() => delRow("goalies", idx)}>✕</button></td>
                        </tr>
                      );
                    })}
                    {!rows.length && (
                      <tr><td colSpan={10} className="td py-4 text-center text-sm text-ink-soft">Вратарей нет</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>

      {/* ------- голы ------- */}
      <section className="card p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-extrabold tracking-wide uppercase">Голы</h2>
          <div className="flex items-center gap-2 text-xs text-ink-soft">
            <span>{teamName("home")}: <b className="text-ink">{goalsBySide("home")}</b> из {p.homeScore}</span>
            <span>·</span>
            <span>{teamName("away")}: <b className="text-ink">{goalsBySide("away")}</b> из {p.awayScore}</span>
            <button className="btn ml-2 px-2 py-1 text-xs" onClick={addGoal}>+ гол</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>{["Команда", "Период", "Время", "Состав", "ПВ", "Забросил", "Ассистент 1", "Ассистент 2", ""].map((c) => <th key={c} className="th text-right first:text-left">{c}</th>)}</tr>
            </thead>
            <tbody>
              {p.goals.map((g, idx) => (
                <tr key={idx} className="hover:bg-paper/60">
                  <td className="td w-36">
                    <select className="inp px-1 py-1" value={g.side} onChange={(e) => setRow("goals", idx, { side: e.target.value as Side })}>
                      <option value="home">{teamName("home")}</option>
                      <option value="away">{teamName("away")}</option>
                    </select>
                  </td>
                  <td className="td w-12"><input className="num w-11" value={g.period} onChange={(e) => setRow("goals", idx, { period: n0(e.target.value) })} /></td>
                  <td className="td w-20"><input className="num w-16" placeholder="мм:сс" value={g.time} onChange={(e) => setRow("goals", idx, { time: e.target.value })} /></td>
                  <td className="td w-28">
                    <select className="inp px-1 py-1" value={g.strength} onChange={(e) => setRow("goals", idx, { strength: e.target.value as "eq" | "pp" | "sh" })}>
                      <option value="eq">равные</option>
                      <option value="pp">большинство</option>
                      <option value="sh">меньшинство</option>
                    </select>
                  </td>
                  <td className="td w-12 text-center">
                    <input type="checkbox" className="h-4 w-4 accent-accent" checked={g.emptyNet} onChange={(e) => setRow("goals", idx, { emptyNet: e.target.checked })} />
                  </td>
                  <td className="td min-w-[150px]"><input className="inp" placeholder="Фамилия Имя" value={g.scorer} onChange={(e) => setRow("goals", idx, { scorer: e.target.value })} /></td>
                  <td className="td min-w-[150px]"><input className="inp" value={g.assist1} onChange={(e) => setRow("goals", idx, { assist1: e.target.value })} /></td>
                  <td className="td min-w-[150px]"><input className="inp" value={g.assist2} onChange={(e) => setRow("goals", idx, { assist2: e.target.value })} /></td>
                  <td className="td w-8"><button className="btn-danger px-1.5 py-0.5 text-xs" onClick={() => delRow("goals", idx)}>✕</button></td>
                </tr>
              ))}
              {!p.goals.length && (
                <tr><td colSpan={9} className="td py-4 text-center text-sm text-ink-soft">Голов нет — добавьте (нужны для расчёта большинства/меньшинства)</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ------- сверка с официальным протоколом ------- */}
      {matchId && (
        <section className="card p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-extrabold tracking-wide uppercase">
              Сверка с официальным протоколом
            </h2>
            {reconcileItems.length > 0 && pendingCount > 0 && (
              <div className="flex items-center gap-2">
                <button className="btn px-2 py-1 text-xs" onClick={() => decideReconcile("all", true)}>
                  Принять все ({pendingCount})
                </button>
                <button className="btn px-2 py-1 text-xs" onClick={() => decideReconcile("all", false)}>
                  Отклонить все
                </button>
              </div>
            )}
          </div>
          <p className="mb-2 text-xs text-ink-soft">
            Догрузите официальный протокол (например, <span className="font-mono">hockey.by/new-admin/games/…/?print=protocol</span>) —
            в нём есть все штрафы, включая командные (в таблице удалений вместо фамилии стоит «К»), а также фактическое
            время вратарей (МВИ), сейвы и пропущенные шайбы. Номера игроков сопоставляются с составом, каждое
            расхождение можно принять или отклонить.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="inp max-w-xl flex-1"
              placeholder="https://hockey.by/new-admin/games/22875/?print=protocol"
              value={reconcileUrl}
              onChange={(e) => setReconcileUrl(e.target.value)}
            />
            <button
              className="btn-primary"
              disabled={reconcileBusy || !reconcileUrl.trim()}
              onClick={() => void runReconcile()}
            >
              {reconcileBusy ? "Сверяем…" : "Сверить"}
            </button>
          </div>

          {reconcileError && (
            <div className="mt-3 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm font-semibold text-bad">
              {reconcileError}
            </div>
          )}

          {reconcileInfo?.teamWarning && (
            <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm font-semibold text-warn">
              {reconcileInfo.teamWarning}
            </div>
          )}

          {reconcileInfo && (
            <p className="mt-3 text-xs text-ink-soft">
              {reconcileInfo.summary} · совпало удалений: <b className="text-ink">{reconcileInfo.matched}</b>
              {reconcileItems.length > 0 && (
                <>
                  {" · "}расхождений: <b className="text-ink">{reconcileItems.length}</b>
                  {acceptedCount > 0 && (
                    <>
                      {" · "}принято: <b className="text-ok">{acceptedCount}</b>
                    </>
                  )}
                </>
              )}
            </p>
          )}

          {reconcileItems.length === 0 && reconcileInfo && !reconcileError && (
            <p className="mt-2 text-sm font-semibold text-ok">
              Расхождений нет — данные матча полностью совпадают с официальным протоколом.
            </p>
          )}

          {reconcileItems.length > 0 && (
            <ul className="mt-3 space-y-2">
              {reconcileItems.map((it, i) => {
                const badge =
                  it.kind === "add-penalty"
                    ? { text: it.pen.player ? "Новое удаление" : "Командный штраф", cls: "bg-accent/15 text-accent" }
                    : it.kind === "update-penalty"
                      ? { text: "Расхождение", cls: "bg-warn/15 text-warn" }
                      : it.kind === "remove-penalty"
                        ? { text: "Лишнее в базе", cls: "bg-bad/10 text-bad" }
                        : it.kind === "goalie-update"
                          ? { text: "Вратарь", cls: "bg-ice/15 text-ice" }
                          : { text: "Новый вратарь", cls: "bg-ice/15 text-ice" };
                return (
                  <li
                    key={i}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
                      it.status === "accepted"
                        ? "border-ok/40 bg-ok/5"
                        : it.status === "rejected"
                          ? "border-line bg-paper/60 opacity-60"
                          : "border-line bg-white"
                    }`}
                  >
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <span className={`badge shrink-0 ${badge.cls}`}>{badge.text}</span>
                      <span className={it.status === "rejected" ? "line-through" : ""}>{it.reason}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {it.status === "pending" && (
                        <>
                          <button className="btn px-2.5 py-0.5 text-xs" onClick={() => decideReconcile(i, true)}>
                            Да
                          </button>
                          <button className="btn-danger px-2.5 py-0.5 text-xs" onClick={() => decideReconcile(i, false)}>
                            Нет
                          </button>
                        </>
                      )}
                      {it.status === "accepted" && <span className="badge bg-ok/15 text-ok">✓ принято</span>}
                      {it.status === "rejected" && <span className="badge bg-ink/10 text-ink-soft">отклонено</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {acceptedCount > 0 && (
            <p className="mt-3 text-xs font-semibold text-warn">
              Принятые изменения применены к форме и попадут в базу после нажатия «Сохранить изменения» внизу страницы.
            </p>
          )}
        </section>
      )}

      {/* ------- удаления ------- */}
      <section className="card p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-extrabold tracking-wide uppercase">Удаления</h2>
          <div className="flex items-center gap-2 text-xs text-ink-soft">
            <span>{teamName("home")}: <b className="text-ink">{pimBySide("home")} мин</b></span>
            <span>·</span>
            <span>{teamName("away")}: <b className="text-ink">{pimBySide("away")} мин</b></span>
            <button className="btn ml-2 px-2 py-1 text-xs" onClick={addPenalty}>+ удаление</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>{["Команда", "Период", "Время", "Минут", "Игрок (пусто = командный штраф)", "Причина", "Обоюд.", ""].map((c) => <th key={c} className="th text-right first:text-left">{c}</th>)}</tr>
            </thead>
            <tbody>
              {p.penalties.map((x, idx) => (
                <tr key={idx} className="hover:bg-paper/60">
                  <td className="td w-36">
                    <select className="inp px-1 py-1" value={x.side} onChange={(e) => setRow("penalties", idx, { side: e.target.value as Side })}>
                      <option value="home">{teamName("home")}</option>
                      <option value="away">{teamName("away")}</option>
                    </select>
                  </td>
                  <td className="td w-12"><input className="num w-11" value={x.period} onChange={(e) => setRow("penalties", idx, { period: n0(e.target.value) })} /></td>
                  <td className="td w-20"><input className="num w-16" placeholder="мм:сс" value={x.time} onChange={(e) => setRow("penalties", idx, { time: e.target.value })} /></td>
                  <td className="td w-20">
                    <select
                      className="num px-1 py-1"
                      title="Минуты удаления; ШБ — штрафной бросок (0 минут)"
                      value={x.penaltyShot ? "ps" : String(x.minutes)}
                      onChange={(e) => {
                        if (e.target.value === "ps") setRow("penalties", idx, { minutes: 0, penaltyShot: true });
                        else setRow("penalties", idx, { minutes: n0(e.target.value), penaltyShot: false });
                      }}
                    >
                      <option value="ps">ШБ</option>
                      {[2, 4, 5, 10, 20, 25].map((m) => <option key={m} value={String(m)}>{m}</option>)}
                    </select>
                  </td>
                  <td className="td min-w-[180px]">
                    <div className="flex items-center gap-1.5">
                      <input className={`inp ${!x.player ? "bg-warn/10 font-semibold text-warn" : ""}`} placeholder="Командный штраф" value={x.player} onChange={(e) => setRow("penalties", idx, { player: e.target.value })} />
                      {x.penaltyShot && <span className="badge bg-accent/15 text-accent" title="Штрафной бросок (0 минут)">ШБ</span>}
                    </div>
                  </td>
                  <td className="td min-w-[200px]"><input className="inp" value={x.infraction} onChange={(e) => setRow("penalties", idx, { infraction: e.target.value })} /></td>
                  <td className="td w-14 text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent"
                      title="Обоюдное удаление (пара у соперника в то же время): составы равные, большинство не считается. Флажок у парного удаления выставится автоматически"
                      checked={x.coincidental}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setP((prev) => ({
                          ...prev,
                          penalties: prev.penalties.map((q, j) => {
                            if (j === idx) return { ...q, coincidental: val };
                            // пара: другая сторона, то же время и та же длительность
                            if (
                              val &&
                              q.side !== x.side &&
                              q.time && q.time === x.time &&
                              q.minutes === x.minutes
                            ) {
                              return { ...q, coincidental: val };
                            }
                            return q;
                          }),
                        }));
                      }}
                    />
                  </td>
                  <td className="td w-8"><button className="btn-danger px-1.5 py-0.5 text-xs" onClick={() => delRow("penalties", idx)}>✕</button></td>
                </tr>
              ))}
              {!p.penalties.length && (
                <tr><td colSpan={8} className="td py-4 text-center text-sm text-ink-soft">Удалений нет. Командные штрафы добавляйте сюда вручную</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {error && <div className="card border-bad/40 bg-bad/10 px-4 py-3 text-sm font-semibold text-bad">{error}</div>}

      <div className="sticky bottom-3 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-card/95 p-3 shadow-lg backdrop-blur">
        <button className="btn-primary px-6" disabled={busy} onClick={() => void save()}>
          {busy ? "Сохранение…" : matchId ? "Сохранить изменения" : "Сохранить матч"}
        </button>
        {saved && !busy && (
          <span className="badge bg-ok/15 text-ok">✓ Сохранено</span>
        )}
        {matchId && <button className="btn-danger" onClick={remove}>Удалить матч</button>}
        <span className="text-xs text-ink-soft">
          Имена автоматически очищаются от (Л), (ЛИ), (А), (К) и номеров. Обоюдные удаления не дают большинства — проверьте флажок «Обоюд.»
        </span>
      </div>
    </div>
  );
}
