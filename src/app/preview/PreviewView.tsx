"use client";

import { useState } from "react";
import type { PreviewResult } from "@/lib/preview";
import { fmtDateRu, fmtPct } from "@/lib/clean";
import { seasonLabel } from "@/lib/seasonStats";
import { PlayerCard } from "@/components/PlayerCard";
import { GoalieCard } from "@/components/GoalieCard";
import { FactsBoard } from "@/components/FactsBoard";
import { HistMatchCard } from "@/components/HistMatchCard";

export function PreviewView() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<PreviewResult | null>(null);
  const [side, setSide] = useState<"all" | "home" | "away">("all");
  const [onlyVs, setOnlyVs] = useState(false);
  const [card, setCard] = useState<{ name: string; kind: "skater" | "goalie" } | null>(null);
  const [histOpen, setHistOpen] = useState<number | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Ошибка анализа");
      setData(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
      setData(null);
    } finally {
      setBusy(false);
    }
  }

  const players = (data?.players ?? []).filter((p) => (side === "all" || p.side === side) && (!onlyVs || p.vsOpp.gp > 0));
  const teamOf = (s: "home" | "away") => (s === "home" ? data?.game.homeTeam : data?.game.awayTeam) ?? "";

  return (
    <section className="space-y-4">
      <div className="card p-4">
        <h2 className="mb-2 text-sm font-extrabold tracking-wide uppercase">Предстоящий матч</h2>
        <div className="flex flex-wrap gap-2">
          <input
            className="inp max-w-xl flex-1"
            placeholder="https://hockey.by/gamecenter/441910/"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && url.trim() && run()}
          />
          <button className="btn-primary" disabled={busy || !url.trim()} onClick={run}>
            {busy ? "Анализируем…" : "Анализировать"}
          </button>
        </div>
        {err && <p className="mt-2 text-sm font-semibold text-bad">{err}</p>}
      </div>

      {data && (
        <>
          <div className="card p-4">
            <p className="text-xs font-bold tracking-wide text-ink-soft uppercase">
              {data.game.competition ?? "Матч"}{data.game.gameNo ? ` · игра №${data.game.gameNo}` : ""}
              {data.game.date ? ` · ${fmtDateRu(data.game.date)}` : ""}{data.game.time ? ` ${data.game.time}` : ""}
              {data.game.arena ? ` · ${data.game.arena}` : ""}
            </p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight">
              {data.game.homeTeam} <span className="text-ink-soft">—</span> {data.game.awayTeam}
            </h2>
            <p className="mt-1 text-xs text-ink-soft">
              Сезон {seasonLabel(data.season)} · в заявках {data.game.rosterCount.home} + {data.game.rosterCount.away} игроков ·
              архив старых протоколов: {data.archive.games} матчей
              {data.archive.seasons.length ? ` (${data.archive.seasons.map(seasonLabel).join(", ")})` : " — загрузите протоколы ниже, чтобы появилась статистика прошлых сезонов"}
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {data.teams.map((t) => (
                <div key={t.side} className="rounded-md border border-line bg-white px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-extrabold">{t.name}</span>
                    <span className="text-[11px] text-ink-soft">{t.side === "home" ? "хозяева" : "гости"}</span>
                  </div>
                  {t.standing ? (
                    <div className="mt-1 grid grid-cols-3 gap-x-3 gap-y-0.5 text-xs sm:grid-cols-6">
                      <Stat label="Место" value={String(t.standing.place)} />
                      <Stat label="Очки" value={`${t.standing.pts} (${t.standing.gp} И)`} />
                      <Stat label="Шайбы" value={`${t.standing.gf}:${t.standing.ga}`} />
                      <Stat label="%Б" value={fmtPct(t.standing.ppPct)} />
                      <Stat label="%М" value={fmtPct(t.standing.pkPct)} />
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-ink-soft">В текущей базе матчей этой команды нет</p>
                  )}
                  {t.last5.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span className="mr-1 text-[11px] font-bold text-ink-soft uppercase">Последние 5:</span>
                      {t.last5.map((g) => (
                        <span
                          key={g.date + g.opp}
                          title={`${fmtDateRu(g.date)} · ${g.home ? "дома" : "в гостях"} · ${g.opp} ${g.score}`}
                          className={`badge ${g.won ? "bg-ok/15 text-ok" : "bg-bad/10 text-bad"}`}
                        >
                          {g.won ? "В" : "П"} {g.score}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <FactsBoard facts={data.facts} homeTeam={data.game.homeTeam} awayTeam={data.game.awayTeam} />

          {data.h2h.total > 0 && (
            <div className="card overflow-x-auto">
              <div className="border-b border-line px-4 py-2">
                <h3 className="text-xs font-extrabold tracking-wide uppercase">Личные встречи</h3>
                <p className="text-[11px] text-ink-soft">
                  Всего {data.h2h.total}: {data.game.homeTeam} {data.h2h.winsHome} — {data.h2h.winsAway} {data.game.awayTeam}, шайбы {data.h2h.goalsHome}:{data.h2h.goalsAway}
                </p>
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {["Дата", "Сезон", "Хозяева", "Счёт", "Гости", "Источник"].map((h) => <th key={h} className="th text-left">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.h2h.meetings.map((m) => (
                    <tr key={m.date + m.home}>
                      <td className="td font-mono text-xs">{fmtDateRu(m.date)}</td>
                      <td className="td text-xs">{seasonLabel(m.season)}</td>
                      <td className="td font-semibold">{m.home}</td>
                      <td className="td font-mono font-bold">
                        {m.histId ? (
                          <button
                            className="rounded bg-ice-soft px-1.5 text-ice transition hover:bg-ice hover:text-white"
                            title="Статистика матча из архива"
                            onClick={() => setHistOpen(m.histId!)}
                          >
                            {m.score}
                          </button>
                        ) : m.matchId ? (
                          <a className="rounded bg-ice-soft px-1.5 text-ice transition hover:bg-ice hover:text-white" href={`/matches/${m.matchId}`} title="Открыть матч">
                            {m.score}
                          </a>
                        ) : (
                          m.score
                        )}
                      </td>
                      <td className="td font-semibold">{m.away}</td>
                      <td className="td text-xs text-ink-soft">{m.source === "archive" ? "архив" : "текущий сезон"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
              <div>
                <h3 className="text-xs font-extrabold tracking-wide uppercase">Полевые игроки из заявок</h3>
                <p className="text-[11px] text-ink-soft">Сезон — текущая база; «против соперника» — архив + текущий сезон. Клик по имени — карточка игрока.</p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {([["all", "Обе"], ["home", data.game.homeTeam], ["away", data.game.awayTeam]] as const).map(([k, l]) => (
                  <button key={k} className={`btn px-2.5 py-1 text-xs ${side === k ? "border-ink bg-ink text-white hover:bg-ink" : ""}`} onClick={() => setSide(k)}>{l}</button>
                ))}
                <label className="ml-2 flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={onlyVs} onChange={(e) => setOnlyVs(e.target.checked)} /> только игравшие против соперника
                </label>
              </div>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="th text-left">№</th>
                  <th className="th text-left">Игрок</th>
                  <th className="th text-left">Команда</th>
                  <th className="th text-right" title="Матчи в текущем сезоне">И</th>
                  <th className="th text-right" title="Голы+передачи в сезоне">Г+П</th>
                  <th className="th text-right" title="Очки в сезоне">О</th>
                  <th className="th text-left">Серия</th>
                  <th className="th text-right" title="Матчи против соперника (все сезоны)">И vs</th>
                  <th className="th text-right" title="Голы против соперника">Г vs</th>
                  <th className="th text-right" title="Передачи против соперника">П vs</th>
                  <th className="th text-right" title="Очки против соперника">О vs</th>
                  <th className="th text-left" title="Последняя встреча с соперником">Прошлая встреча</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p, i) => (
                  <tr key={p.side + p.name} className={i % 2 ? "bg-paper/50" : ""}>
                    <td className="td font-mono text-xs text-ink-soft">{p.jersey ?? ""}</td>
                    <td className="td">
                      <button className="font-bold text-ice hover:text-accent hover:underline" onClick={() => setCard({ name: p.name, kind: "skater" })}>{p.name}</button>
                      <span className="ml-1 text-[11px] text-ink-soft">{p.position}</span>
                    </td>
                    <td className="td text-xs text-ink-soft">{teamOf(p.side)}</td>
                    <td className="td-num">{p.season.gp || "—"}</td>
                    <td className="td-num">{p.season.gp ? `${p.season.g}+${p.season.a}` : "—"}</td>
                    <td className="td-num bg-ice-soft/60 font-bold">{p.season.gp ? p.season.p : "—"}</td>
                    <td className="td text-xs">
                      {p.streak ? (
                        <span className={`badge ${p.streak.kind === "drought" ? "bg-bad/10 text-bad" : "bg-ok/10 text-ok"}`}>
                          {p.streak.kind === "points" ? `очки ${p.streak.len} подряд (${p.streak.g}+${p.streak.a})` : p.streak.kind === "goals" ? `голы ${p.streak.len} подряд` : `без очков ${p.streak.len}`}
                        </span>
                      ) : ""}
                    </td>
                    <td className="td-num">{p.vsOpp.gp || "—"}</td>
                    <td className="td-num">{p.vsOpp.gp ? p.vsOpp.g : "—"}</td>
                    <td className="td-num">{p.vsOpp.gp ? p.vsOpp.a : "—"}</td>
                    <td className="td-num font-bold">{p.vsOpp.gp ? p.vsOpp.p : "—"}</td>
                    <td className="td text-xs text-ink-soft">{p.vsOpp.lastLine ?? ""}</td>
                  </tr>
                ))}
                {!players.length && <tr><td colSpan={12} className="td py-6 text-center text-sm text-ink-soft">Заявки пока не опубликованы или нет данных</td></tr>}
              </tbody>
            </table>
          </div>

          {data.goalies.length > 0 && (
            <div className="card overflow-x-auto">
              <div className="border-b border-line px-4 py-2">
                <h3 className="text-xs font-extrabold tracking-wide uppercase">Вратари</h3>
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {["№", "Вратарь", "Команда", "И (сезон)", "%ОБ", "КН", "И vs", "В–П vs", "%ОБ vs", "КН vs", "Сухие vs"].map((h, i) => (
                      <th key={h} className={`th ${i < 3 ? "text-left" : "text-right"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.goalies.map((g) => (
                    <tr key={g.side + g.name}>
                      <td className="td font-mono text-xs text-ink-soft">{g.jersey ?? ""}</td>
                      <td className="td"><button className="font-bold text-ice hover:text-accent hover:underline" onClick={() => setCard({ name: g.name, kind: "goalie" })}>{g.name}</button></td>
                      <td className="td text-xs text-ink-soft">{teamOf(g.side)}</td>
                      <td className="td-num">{g.season.gp || "—"}</td>
                      <td className="td-num">{fmtPct(g.season.svPct)}</td>
                      <td className="td-num">{g.season.gaa !== null ? g.season.gaa.toFixed(2) : "—"}</td>
                      <td className="td-num">{g.vsOpp.gp || "—"}</td>
                      <td className="td-num">{g.vsOpp.gp ? `${g.vsOpp.w}–${g.vsOpp.l}` : "—"}</td>
                      <td className="td-num">{fmtPct(g.vsOpp.svPct)}</td>
                      <td className="td-num">{g.vsOpp.gaa !== null ? g.vsOpp.gaa.toFixed(2) : "—"}</td>
                      <td className="td-num">{g.vsOpp.gp ? g.vsOpp.shutouts : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {card?.kind === "skater" && <PlayerCard name={card.name} onClose={() => setCard(null)} />}
      {card?.kind === "goalie" && <GoalieCard name={card.name} onClose={() => setCard(null)} />}
      {histOpen !== null && <HistMatchCard id={histOpen} onClose={() => setHistOpen(null)} />}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-ink-soft uppercase">{label}</div>
      <div className="font-mono font-bold">{value}</div>
    </div>
  );
}
