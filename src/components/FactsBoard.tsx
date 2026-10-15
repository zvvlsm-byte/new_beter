"use client";

import { splitFacts, type LayoutFact } from "@/lib/factsLayout";

const TONE = { good: "border-l-ok", bad: "border-l-bad", neutral: "border-l-ice" } as const;
const TONE_BADGE = { good: "bg-ok/10 text-ok", bad: "bg-bad/10 text-bad", neutral: "bg-ice-soft text-ice" } as const;
const TONE_SIGN = { good: "+", bad: "−", neutral: "•" } as const;

function FactCard({ f }: { f: LayoutFact }) {
  return (
    <div className={`card border-l-4 ${TONE[f.tone]} px-3 py-2`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold tracking-wide text-ink-soft uppercase">{f.tag}</span>
        <span className={`badge ${TONE_BADGE[f.tone]}`}>{TONE_SIGN[f.tone]}</span>
      </div>
      <div className="text-sm">{f.text}</div>
    </div>
  );
}

function Column({ title, sub, list }: { title: string; sub: string; list: LayoutFact[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 border-b border-line pb-1">
        <span className="truncate text-sm font-extrabold">{title}</span>
        <span className="shrink-0 text-[11px] text-ink-soft">{sub}</span>
      </div>
      {list.length ? list.map((f, i) => <FactCard key={i} f={f} />) : <p className="text-xs text-ink-soft">Фактов нет</p>}
    </div>
  );
}

/**
 * «Интересные факты»: слева — домашняя команда, справа — гостевая, ниже — общее по матчу.
 * Внутри колонки — по убыванию: положительные вверху, отрицательные внизу.
 */
export function FactsBoard({
  facts,
  homeTeam,
  awayTeam,
  title = "Интересные факты",
  showHint = true,
}: {
  facts: LayoutFact[];
  homeTeam: string;
  awayTeam: string;
  title?: string | null;
  showHint?: boolean;
}) {
  const { home, away, general } = splitFacts(facts);
  return (
    <div className="space-y-3">
      {title && (
        <div>
          <h3 className="text-sm font-extrabold tracking-wide uppercase">{title}</h3>
          {showHint && (
            <p className="text-[11px] text-ink-soft">
              Слева — домашняя команда, справа — гостевая. Внутри колонки по убыванию: положительные вверху, отрицательные внизу.
            </p>
          )}
        </div>
      )}
      {!facts.length ? (
        <p className="text-sm text-ink-soft">Пока фактов нет — нужно больше матчей в базе или архиве.</p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Column title={homeTeam} sub="хозяева" list={home} />
            <Column title={awayTeam} sub="гости" list={away} />
          </div>
          {general.length > 0 && (
            <div className="space-y-2">
              <div className="border-b border-line pb-1 text-sm font-extrabold">Общее по матчу</div>
              <div className="grid gap-2 md:grid-cols-2">
                {general.map((f, i) => <FactCard key={i} f={f} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
