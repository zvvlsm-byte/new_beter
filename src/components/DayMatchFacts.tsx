"use client";

import { useEffect, useState } from "react";
import type { DayMatchFacts as DayMatch } from "@/lib/dayFacts";
import { FactsBoard } from "./FactsBoard";

/** «Статистика дня» → анализ матчей дня: факты по хозяевам, гостям и общее по матчу. */
export function DayMatchFacts({ date }: { date: string }) {
  const [list, setList] = useState<DayMatch[] | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!date) return;
    let alive = true;
    setList(null);
    fetch(`/api/day-facts?date=${date}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const ms: DayMatch[] = d.matches ?? [];
        setList(ms);
        setOpen(ms.length ? { [ms[0].match.id]: true } : {});
      })
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [date]);

  return (
    <section className="space-y-3">
      <div className="border-b border-line pb-1.5">
        <h2 className="text-sm font-extrabold tracking-wide uppercase">Анализ матчей дня · интересные факты</h2>
        <p className="text-xs text-ink-soft">
          Слева — домашняя команда, справа — гостевая. Внутри колонки по убыванию: положительные вверху, отрицательные внизу
          (удаления игроков идут в минус). Ниже — общее по матчу. Клик по матчу — развернуть/свернуть.
        </p>
      </div>
      {list === null && <p className="text-sm text-ink-soft">Загрузка…</p>}
      {list && !list.length && <p className="text-sm text-ink-soft">Матчей в этот день нет.</p>}
      {list?.map(({ match: m, facts }) => {
        const isOpen = !!open[m.id];
        return (
          <div key={m.id} className="card">
            <div className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <button
                className="flex flex-1 items-baseline gap-2 text-left"
                onClick={() => setOpen((o) => ({ ...o, [m.id]: !o[m.id] }))}
              >
                <span className="text-ink-soft">{isOpen ? "▾" : "▸"}</span>
                <span className="font-extrabold">{m.homeTeam}</span>
                <span className="font-mono font-bold text-accent">
                  {m.homeScore}:{m.awayScore}
                  {m.winType === "ot" ? " ОТ" : m.winType === "so" ? " Б" : ""}
                </span>
                <span className="font-extrabold">{m.awayTeam}</span>
                <span className="text-[11px] text-ink-soft">· фактов: {facts.length}</span>
              </button>
              <a className="text-xs font-semibold text-ice hover:underline" href={`/matches/${m.id}`}>Протокол матча →</a>
            </div>
            {isOpen && (
              <div className="border-t border-line p-4">
                <FactsBoard facts={facts} homeTeam={m.homeTeam} awayTeam={m.awayTeam} title={null} />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
