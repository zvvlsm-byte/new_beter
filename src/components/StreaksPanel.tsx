"use client";

import { ddmm, type RecordInfo, type StreakInfo } from "@/lib/streaks";

const TONE: Record<StreakInfo["tone"], string> = {
  good: "border-l-ok",
  bad: "border-l-bad",
  neutral: "border-l-ice",
};

const plural = (n: number) => {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return "матч";
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return "матча";
  return "матчей";
};

export function StreaksPanel({ streaks, records }: { streaks: StreakInfo[]; records: RecordInfo[] }) {
  if (!streaks.length && !records.length) return null;
  return (
    <section className="mt-6 space-y-3">
      <div className="border-b border-line pb-1.5">
        <h4 className="text-sm font-extrabold tracking-wide uppercase">Интересные серии</h4>
        <p className="text-xs text-ink-soft">
          Лучшие серии сезона подряд идущих матчей (по нашим протоколам). «Сейчас» — серия, которая продолжается на последний матч.
        </p>
      </div>
      {streaks.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {streaks.map((s) => (
            <div key={s.key} className={`card border-l-4 ${TONE[s.tone]} px-3 py-2`} title={s.hint}>
              <div className="text-[11px] font-bold tracking-wide text-ink-soft uppercase">{s.label}</div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="font-mono text-xl font-bold tabular-nums">{s.best}</span>
                <span className="text-xs text-ink-soft">{plural(s.best)}</span>
                {s.sumLabel && <span className="ml-auto text-xs font-semibold">{s.sumLabel}</span>}
              </div>
              <div className="flex items-center justify-between text-[11px] text-ink-soft">
                <span>{s.bestFrom && s.bestTo ? `${ddmm(s.bestFrom)} – ${ddmm(s.bestTo)}` : ""}</span>
                {s.current > 0 && (
                  <span className={`badge ${s.current === s.best ? "bg-accent/15 text-accent" : "bg-ice-soft text-ice"}`}>
                    сейчас {s.current}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {records.length > 0 && (
        <>
          <h5 className="pt-1 text-xs font-extrabold tracking-wide text-ink-soft uppercase">Рекорды в одном матче и итоги</h5>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {records.map((r) => (
              <div key={r.key} className="rounded-md border border-line bg-white px-3 py-2">
                <div className="text-[10px] font-bold tracking-wide text-ink-soft uppercase">{r.label}</div>
                <div className="font-mono text-lg font-bold tabular-nums">{r.value}</div>
                <div className="truncate text-[11px] text-ink-soft" title={r.sub}>{r.sub}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
