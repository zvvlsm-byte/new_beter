import { fmtDateRu } from "@/lib/clean";
import type { CapacitySummary } from "@/lib/capacity";

const fmtInt = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : Math.round(n).toLocaleString("ru-RU");
const fmtPct1 = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${Math.round(n * 10) / 10}%`;

const barColor = (p: number) =>
  p >= 100 ? "bg-accent" : p >= 80 ? "bg-ok" : p >= 60 ? "bg-ice" : p >= 40 ? "bg-warn" : "bg-ink-soft";

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: string;
}) {
  return (
    <div className={`card border-l-4 ${accent} px-4 py-3`}>
      <div className="text-[11px] font-bold tracking-wide text-ink-soft uppercase">{label}</div>
      <div className="mt-1 font-mono text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-ink-soft">{sub}</div>
    </div>
  );
}

/**
 * НОВАЯ инфографика по вместимости арен и аншлагам.
 * Существующая таблица посещаемости (AttendanceView) не изменяется.
 */
export function CapacityInfographics({ data }: { data: CapacitySummary }) {
  if (!data.arenasWithCapacity) {
    return (
      <section className="card px-6 py-10 text-center">
        <h2 className="text-sm font-extrabold tracking-wide uppercase">Аншлаги и заполняемость арен</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-ink-soft">
          Заполните вместимость домашних арен в блоке выше — здесь появится инфографика:
          аншлаги, процент заполняемости по каждой арене, распределение матчей по заполненности
          и свободные места.
        </p>
      </section>
    );
  }

  const arenas = data.arenas.filter((a) => a.capacity !== null);
  const maxSeats = Math.max(1, ...arenas.map((a) => a.capacity ?? 0));

  return (
    <section className="space-y-4">
      <div className="border-b border-line pb-2">
        <h2 className="text-sm font-extrabold tracking-wide uppercase">Аншлаги и заполняемость арен</h2>
        <p className="mt-0.5 text-xs text-ink-soft">
          Считается только по домашним матчам, где известны и зрители, и вместимость арены:
          таких матчей {data.matchesTotal} из {data.arenasWithCapacity} арен с указанной вместимостью.
          Аншлаг — зрителей не меньше вместимости.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Общая заполняемость"
          value={fmtPct1(data.fillPct)}
          sub={`${fmtInt(data.attendance)} из ${fmtInt(data.seats)} мест`}
          accent="border-l-ice"
        />
        <StatCard
          label="Аншлаги"
          value={String(data.sellouts)}
          sub={
            data.matchesTotal
              ? `${fmtPct1(data.selloutPct)} матчей с известной вместимостью`
              : "нет матчей для расчёта"
          }
          accent="border-l-accent"
        />
        <StatCard
          label="Свободные места"
          value={fmtInt(data.freeSeats)}
          sub={`в среднем ${fmtInt(data.matchesTotal ? data.freeSeats / data.matchesTotal : null)} на матч`}
          accent="border-l-warn"
        />
        <StatCard
          label="Самая заполненная арена"
          value={data.bestFill ? fmtPct1(data.bestFill.fillPct) : "—"}
          sub={data.bestFill ? `${data.bestFill.team}${data.bestFill.arenaName ? ` · ${data.bestFill.arenaName}` : ""}` : "нет данных"}
          accent="border-l-ok"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        {/* заполняемость по аренам */}
        <div className="card p-4">
          <h3 className="text-xs font-extrabold tracking-wide text-ink-soft uppercase">
            Заполняемость по аренам
          </h3>
          <div className="mt-3 space-y-2">
            {arenas.map((a) => (
              <div key={a.team} className="grid grid-cols-[minmax(120px,1.1fr)_3fr_auto] items-center gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold" title={a.team}>{a.team}</div>
                  <div className="truncate text-[11px] text-ink-soft" title={a.arenaName ?? ""}>
                    {a.arenaName ?? "арена не указана"} · {fmtInt(a.capacity)} мест
                  </div>
                </div>
                <div>
                  <div className="h-4 w-full overflow-hidden rounded bg-paper">
                    <div
                      className={`h-full rounded ${barColor(a.fillPct ?? 0)}`}
                      style={{ width: `${Math.min(100, a.fillPct ?? 0)}%` }}
                      title={`Заполняемость ${fmtPct1(a.fillPct)}`}
                    />
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-soft">
                    средняя {fmtInt(a.avg)} зрит. · аншлагов {a.sellouts}
                    {a.games ? ` из ${a.games}` : ""}
                  </div>
                </div>
                <div className="text-right font-mono text-sm font-bold tabular-nums">
                  {fmtPct1(a.fillPct)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-2.5 text-[11px] text-ink-soft">
            {[
              ["bg-accent", "аншлаг (100%+)"],
              ["bg-ok", "80–99%"],
              ["bg-ice", "60–79%"],
              ["bg-warn", "40–59%"],
              ["bg-ink-soft", "ниже 40%"],
            ].map(([c, l]) => (
              <span key={l} className="inline-flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-sm ${c}`} />
                {l}
              </span>
            ))}
          </div>
        </div>

        {/* распределение матчей + рекорды */}
        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="text-xs font-extrabold tracking-wide text-ink-soft uppercase">
              Матчи по заполняемости
            </h3>
            {data.matchesTotal ? (
              <>
                <div className="mt-3 flex h-5 w-full overflow-hidden rounded">
                  {data.buckets.map((b) =>
                    b.count ? (
                      <div
                        key={b.key}
                        className={`${b.color} h-full`}
                        style={{ width: `${(b.count / data.matchesTotal) * 100}%` }}
                        title={`${b.label}: ${b.count}`}
                      />
                    ) : null,
                  )}
                </div>
                <ul className="mt-3 space-y-1 text-xs">
                  {data.buckets.map((b) => (
                    <li key={b.key} className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${b.color}`} />
                      <span className="flex-1 text-ink-soft">{b.label}</span>
                      <span className="font-mono font-bold tabular-nums">{b.count}</span>
                      <span className="w-12 text-right font-mono text-ink-soft tabular-nums">
                        {data.matchesTotal ? Math.round((b.count / data.matchesTotal) * 100) : 0}%
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-2 text-sm text-ink-soft">
                Нет матчей, где известны и зрители, и вместимость. Догрузите зрителей на главной.
              </p>
            )}
          </div>

          <div className="card p-4">
            <h3 className="text-xs font-extrabold tracking-wide text-ink-soft uppercase">Рекорды арен</h3>
            <ul className="mt-2 space-y-1.5 text-sm">
              <li className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-ink-soft">Самая вместительная</span>
                <span className="text-right font-bold">
                  {data.biggestArena ? `${data.biggestArena.team} · ${fmtInt(data.biggestArena.capacity)}` : "—"}
                </span>
              </li>
              <li className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-ink-soft">Больше всех аншлагов</span>
                <span className="text-right font-bold">
                  {data.mostSellouts && data.mostSellouts.sellouts
                    ? `${data.mostSellouts.team} · ${data.mostSellouts.sellouts}`
                    : "аншлагов пока не было"}
                </span>
              </li>
              <li className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-ink-soft">Наименее заполненная</span>
                <span className="text-right font-bold">
                  {data.worstFill ? `${data.worstFill.team} · ${fmtPct1(data.worstFill.fillPct)}` : "—"}
                </span>
              </li>
              <li className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-ink-soft">Максимум зрителей на матче</span>
                <span className="text-right font-bold">
                  {data.matches.length
                    ? `${fmtInt(Math.max(...data.matches.map((m) => m.attendance)))}`
                    : "—"}
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* аншлаги */}
      <div className="card overflow-x-auto">
        <div className="border-b border-line px-4 py-2.5">
          <h3 className="text-sm font-extrabold tracking-wide uppercase">
            Аншлаги — {data.sellouts}
          </h3>
          <p className="mt-0.5 text-xs text-ink-soft">
            Матчи, где зрителей не меньше вместимости арены. Свежие сверху.
          </p>
        </div>
        {data.selloutMatches.length ? (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Дата", "Арена", "Матч", "Зрители", "Вместимость", "Заполн.", "Своб. мест"].map((h) => (
                  <th key={h} className={`th ${h === "Зрители" || h === "Вместимость" || h === "Заполн." || h === "Своб. мест" ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.selloutMatches.map((m, i) => (
                <tr key={m.matchId} className={i % 2 ? "bg-paper/50" : ""}>
                  <td className="td font-mono text-xs text-ink-soft">{fmtDateRu(m.date)}</td>
                  <td className="td text-xs whitespace-normal">
                    {m.arenaName ?? m.homeTeam}
                  </td>
                  <td className="td text-xs whitespace-normal">{m.label}</td>
                  <td className="td-num font-bold">{fmtInt(m.attendance)}</td>
                  <td className="td-num">{fmtInt(m.capacity)}</td>
                  <td className="td-num">
                    <span className="badge bg-accent/15 text-accent">{fmtPct1(m.fillPct)}</span>
                  </td>
                  <td className="td-num text-ink-soft">{m.freeSeats || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-ink-soft">
            Аншлагов пока не было: максимальная заполняемость — {fmtPct1(data.matches[0]?.fillPct ?? null)}.
          </p>
        )}
      </div>

      {/* самые заполненные матчи */}
      {data.matches.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="border-b border-line px-4 py-2.5">
            <h3 className="text-sm font-extrabold tracking-wide uppercase">
              Самые заполненные матчи — топ {Math.min(10, data.matches.length)}
            </h3>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Дата", "Арена", "Матч", "Зрители", "Вместимость", "Заполн."].map((h) => (
                  <th key={h} className={`th ${h === "Зрители" || h === "Вместимость" || h === "Заполн." ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.matches.slice(0, 10).map((m, i) => (
                <tr key={m.matchId} className={i % 2 ? "bg-paper/50" : ""}>
                  <td className="td font-mono text-xs text-ink-soft">{fmtDateRu(m.date)}</td>
                  <td className="td text-xs whitespace-normal">{m.arenaName ?? m.homeTeam}</td>
                  <td className="td text-xs whitespace-normal">{m.label}</td>
                  <td className="td-num font-bold">{fmtInt(m.attendance)}</td>
                  <td className="td-num">{fmtInt(m.capacity)}</td>
                  <td className="td-num">
                    <span className="inline-flex items-center gap-2">
                      <span className="hidden h-2 w-16 overflow-hidden rounded bg-paper sm:inline-block">
                        <span
                          className={`block h-full ${barColor(m.fillPct)}`}
                          style={{ width: `${Math.min(100, m.fillPct)}%` }}
                        />
                      </span>
                      <span className="font-mono font-bold tabular-nums">{fmtPct1(m.fillPct)}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2.5 text-xs text-ink-soft">
            Вместимость арены задаётся вручную в блоке «Вместимость арен» — на существующие
            расчёты посещаемости и статистики она не влияет.
          </p>
        </div>
      )}

      {/* сравнение вместимости и средней посещаемости */}
      <div className="card p-4">
        <h3 className="text-xs font-extrabold tracking-wide text-ink-soft uppercase">
          Вместимость против средней посещаемости
        </h3>
        <div className="mt-3 space-y-2.5">
          {arenas.map((a) => {
            const capW = ((a.capacity ?? 0) / maxSeats) * 100;
            const attW = ((a.avg ?? 0) / maxSeats) * 100;
            return (
              <div key={a.team}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-bold">{a.team}</span>
                  <span className="text-ink-soft">
                    {fmtInt(a.avg)} / {fmtInt(a.capacity)} · {fmtPct1(a.avgFillPct)}
                  </span>
                </div>
                <div className="relative mt-1 h-5 w-full overflow-hidden rounded bg-paper">
                  <div className="absolute inset-y-0 left-0 rounded bg-ice/25" style={{ width: `${Math.min(100, capW)}%` }} />
                  <div className={`absolute inset-y-0 left-0 rounded ${barColor(a.avgFillPct ?? 0)}`} style={{ width: `${Math.min(100, attW)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-ink-soft">
          Светлая полоса — вместимость арены, цветная — средняя посещаемость (масштаб общий).
        </p>
      </div>
    </section>
  );
}
