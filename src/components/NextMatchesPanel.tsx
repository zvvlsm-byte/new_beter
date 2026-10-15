"use client";

import { useState } from "react";
import type { ConsistencyEntry, DayForm, FormEntry, FormTone } from "@/lib/formStreaks";
import { ddmm } from "@/lib/streaks";
import type { ScoringStreak } from "@/lib/scoringStreaks";
import { ScoringStreaksPanel } from "./ScoringStreaksPanel";

const TONE: Record<FormTone, string> = {
  good: "border-l-ok",
  bad: "border-l-bad",
  neutral: "border-l-ice",
};

const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
};
const matchesWord = (n: number) => plural(n, "матч", "матча", "матчей");

const LIMIT = 12;

function StreakCard({
  e,
  date,
  onName,
}: {
  e: FormEntry;
  date: string;
  onName?: (name: string, kind: "skater" | "goalie") => void;
}) {
  const stale = e.lastDate !== date;
  return (
    <div className={`card border-l-4 ${TONE[e.tone]} px-3 py-2`} title={e.hint}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-bold tracking-wide text-ink-soft uppercase">{e.label}</div>
        <span
          className={`badge ${e.tone === "good" ? "bg-ok/10 text-ok" : e.tone === "bad" ? "bg-bad/10 text-bad" : "bg-ice-soft text-ice"}`}
          title="Доля сыгранных матчей, которую охватывает серия"
        >
          {Math.round(e.share * 100)}% игр
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="font-mono text-xl font-bold tabular-nums">{e.len}</span>
        <span className="text-xs text-ink-soft">{matchesWord(e.len)} подряд</span>
        {e.sumLabel && <span className="ml-auto text-xs font-semibold">{e.sumLabel}</span>}
      </div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
        {onName ? (
          <button
            className="text-sm font-bold text-ice underline-offset-2 transition hover:text-accent hover:underline"
            onClick={() => onName(e.name, e.kind)}
            title="Открыть поматчевую статистику"
          >
            {e.name}
          </button>
        ) : (
          <span className="text-sm font-bold">{e.name}</span>
        )}
        <span className="text-xs text-ink-soft">{e.team}</span>
      </div>
      <div className="flex items-center justify-between text-[11px] text-ink-soft">
        <span>
          из {e.gp} {matchesWord(e.gp)} · с {ddmm(e.fromDate)}
        </span>
        {stale && <span title="Последний матч игрока на эту дату">посл. {ddmm(e.lastDate)}</span>}
      </div>
    </div>
  );
}

function Grid({
  list,
  date,
  onName,
}: {
  list: FormEntry[];
  date: string;
  onName?: (name: string, kind: "skater" | "goalie") => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, LIMIT);
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((e) => (
          <StreakCard key={`${e.kind}|${e.key}|${e.name}`} e={e} date={date} onName={onName} />
        ))}
      </div>
      {list.length > LIMIT && (
        <button className="btn mt-2 px-3 py-1 text-xs" onClick={() => setAll((v) => !v)}>
          {all ? "Свернуть" : `Показать все (${list.length})`}
        </button>
      )}
    </>
  );
}

function Consistency({
  list,
  onName,
}: {
  list: ConsistencyEntry[];
  onName?: (name: string, kind: "skater" | "goalie") => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 8);
  if (!list.length) return null;
  return (
    <div className="card overflow-x-auto">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2">
        <div>
          <h3 className="text-xs font-extrabold tracking-wide uppercase">Стабильно набирают очки</h3>
          <p className="text-[11px] text-ink-soft">
            Не обязательно подряд: очки хотя бы в половине сыгранных матчей (от 6 игр).
          </p>
        </div>
        {list.length > 8 && (
          <button className="btn px-3 py-1 text-xs" onClick={() => setAll((v) => !v)}>
            {all ? "Свернуть" : `Все (${list.length})`}
          </button>
        )}
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="th text-left">Игрок</th>
            <th className="th text-left">Команда</th>
            <th className="th text-right" title="Матчей с очками / сыграно">Матчи с очками</th>
            <th className="th text-right" title="Доля матчей с очками">%</th>
            <th className="th text-right" title="Голы + передачи">Г+П</th>
            <th className="th text-right" title="Очки">О</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((c, i) => (
            <tr key={c.name} className={i % 2 ? "bg-paper/50" : ""}>
              <td className="td font-bold">
                {onName ? (
                  <button
                    className="text-ice underline-offset-2 transition hover:text-accent hover:underline"
                    onClick={() => onName(c.name, "skater")}
                  >
                    {c.name}
                  </button>
                ) : (
                  c.name
                )}
              </td>
              <td className="td text-xs text-ink-soft">{c.team}</td>
              <td className="td-num">
                <b>{c.withPts}</b> из {c.gp}
              </td>
              <td className="td-num">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-16 overflow-hidden rounded bg-line">
                    <span className="block h-full bg-ok" style={{ width: `${Math.round(c.share * 100)}%` }} />
                  </span>
                  {Math.round(c.share * 100)}
                </span>
              </td>
              <td className="td-num">
                {c.goals}+{c.assists}
              </td>
              <td className="td-num bg-ice-soft/60 font-bold">{c.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Блок «К следующим матчам»: активные серии на выбранный игровой день. */
export function NextMatchesPanel({
  form,
  date,
  onName,
  scoring,
}: {
  form: DayForm | undefined;
  date: string;
  onName?: (name: string, kind: "skater" | "goalie") => void;
  scoring?: ScoringStreak[];
}) {
  if (!form) return null;
  const empty = !form.skaters.length && !form.goalies.length && !form.consistency.length;
  return (
    <section className="space-y-3">
      <div className="border-b border-line pb-1.5">
        <h2 className="text-sm font-extrabold tracking-wide uppercase">К следующим матчам</h2>
        <p className="text-xs text-ink-soft">
          Серии, которые продолжаются на {ddmm(date)} и могут продлиться в следующей игре. Показываем только существенные —
          в пересчёте на сыгранные матчи: серия должна охватывать не меньше трети игр игрока (или быть длинной сама по себе).
          Короткие серии в 1–2 матча не учитываются; полевые — от 5 сыгранных матчей, вратари — от 3; только те, кто играл
          в последние 7 дней. Спад «без очков» показываем только у результативных игроков.
        </p>
      </div>

      {empty && <p className="py-2 text-sm text-ink-soft">Существенных серий на эту дату пока нет.</p>}

      {form.skaters.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-extrabold tracking-wide text-ink-soft uppercase">
            Полевые игроки · {form.skaters.length}
          </h3>
          <Grid list={form.skaters} date={date} onName={onName} />
        </div>
      )}

      {form.goalies.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-extrabold tracking-wide text-ink-soft uppercase">
            Вратари · {form.goalies.length}
          </h3>
          <Grid list={form.goalies} date={date} onName={onName} />
        </div>
      )}

      <Consistency list={form.consistency} onName={onName} />

      <ScoringStreaksPanel list={scoring} onName={onName} />
    </section>
  );
}
