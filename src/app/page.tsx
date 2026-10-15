import { and, desc, isNotNull, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { matches, skaterGames } from "@/db/schema";
import { fmtDateRu } from "@/lib/clean";
import { EnrichButton } from "@/components/EnrichButton";
import { PlayerStatsRefresh } from "@/components/PlayerStatsRefresh";
import { SeasonControls } from "@/components/SeasonControls";
import { getActiveStage, matchStage } from "@/lib/seasonMode";

export const dynamic = "force-dynamic";

const WIN_LABEL = { reg: "осн. время", ot: "ОТ", so: "Б" } as const;

export default async function HomePage() {
  // запросы разделены: при джойне матчей с игроками строка матча задваивается
  // на каждого игрока и сумма голов раздувается (7 голов × 38 игроков = 266)
  const [list, matchAgg, playerAgg, missingAgg, refreshAgg] = await Promise.all([
    db.select().from(matches).orderBy(desc(matches.date), desc(matches.id)).limit(200),
    db
      .select({
        matchesCount: sql<number>`count(*)`,
        goals: sql<number>`coalesce(sum(${matches.homeScore} + ${matches.awayScore}), 0)`,
      })
      .from(matches),
    db
      .select({ players: sql<number>`count(distinct lower(${skaterGames.name}))` })
      .from(skaterGames),
    db
      .select({ n: sql<number>`count(*)` })
      .from(matches)
      .where(and(isNull(matches.attendance), isNotNull(matches.sourceUrl))),
    db
      .select({ n: sql<number>`count(*)` })
      .from(matches)
      .where(isNotNull(matches.sourceUrl)),
  ]);
  const missingAttendance = Number(missingAgg[0]?.n ?? 0);
  const refreshableMatches = Number(refreshAgg[0]?.n ?? 0);

  // дубликаты матчей (одна и та же пара команд в один день) искажают статистику
  const dupeRows = await db
    .select({
      homeTeam: matches.homeTeam,
      awayTeam: matches.awayTeam,
      date: matches.date,
      n: sql<number>`count(*)`,
    })
    .from(matches)
    .groupBy(matches.homeTeam, matches.awayTeam, matches.date)
    .having(sql`count(*) > 1`);
  const c = {
    matchesCount: matchAgg[0]?.matchesCount ?? 0,
    goals: matchAgg[0]?.goals ?? 0,
    players: playerAgg[0]?.players ?? 0,
  };
  const teams = new Set(list.flatMap((m) => [m.homeTeam, m.awayTeam]));
  const activeStage = await getActiveStage();
  const playoffCount = list.filter((m) => matchStage(m) !== "regular").length;

  return (
    <div className="space-y-5 pb-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Матчи</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Все загруженные протоколы. Откройте матч, чтобы поправить данные, или импортируйте новый протокол.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SeasonControls
            matchCount={Number(c?.matchesCount ?? 0)}
            playoffCount={playoffCount}
            activeStage={activeStage}
          />
          <EnrichButton missingCount={missingAttendance} />
          <PlayerStatsRefresh matchCount={refreshableMatches} />
          <Link href="/import" className="btn-primary">+ Импорт протокола</Link>
        </div>
      </div>

      {dupeRows.length > 0 && (
        <div className="card border-warn/50 bg-warn/10 px-4 py-3">
          <p className="text-sm font-bold text-warn">⚠ Похоже, в базе есть дубликаты матчей</p>
          <p className="mt-1 text-sm text-ink">
            {dupeRows.map((d) => `${d.homeTeam} — ${d.awayTeam} от ${fmtDateRu(d.date)} (${d.n} шт.)`).join("; ")}.
            Дубликаты искажают турнирную таблицу и все статистики: откройте матчи и удалите лишние копии.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Матчей в базе", value: Number(c?.matchesCount ?? 0) },
          { label: "Команд", value: teams.size },
          { label: "Заброшено шайб", value: Number(c?.goals ?? 0) },
          { label: "Игроков в статистике", value: Number(c?.players ?? 0) },
        ].map((s) => (
          <div key={s.label} className="card px-4 py-3">
            <div className="font-mono text-2xl font-bold tabular-nums">{s.value}</div>
            <div className="text-xs font-semibold tracking-wide text-ink-soft uppercase">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["Дата", "Хозяева", "Счёт", "Гости", "По периодам", "Зрители", "Итог", ""].map((h) => (
                <th key={h} className={`th ${h === "Счёт" || h === "" ? "text-right" : "text-left"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((m) => {
              const homeWon = m.homeScore > m.awayScore;
              return (
                <tr key={m.id} className="group hover:bg-paper/70">
                  <td className="td font-mono text-xs text-ink-soft">{fmtDateRu(m.date)}</td>
                  <td className={`td font-semibold ${homeWon ? "" : "text-ink-soft"}`}>{m.homeTeam}</td>
                  <td className="td text-right">
                    <Link href={`/matches/${m.id}`} className="rounded bg-ink px-2 py-0.5 font-mono text-sm font-bold text-white group-hover:bg-accent">
                      {m.homeScore}:{m.awayScore}
                    </Link>
                  </td>
                  <td className={`td font-semibold ${!homeWon ? "" : "text-ink-soft"}`}>{m.awayTeam}</td>
                  <td className="td font-mono text-xs text-ink-soft">
                    {m.periods.length ? m.periods.map((x) => `${x.h}:${x.a}`).join(" ") : "—"}
                  </td>
                  <td className="td-num text-xs">{m.attendance !== null ? m.attendance.toLocaleString("ru-RU") : "—"}</td>
                  <td className="td">
                    <span className="badge bg-ice-soft text-ice">{WIN_LABEL[m.winType]}</span>
                    {matchStage(m) === "playoff" && <span className="badge ml-1 bg-accent/15 text-accent">ПО</span>}
                    {matchStage(m) === "playin" && <span className="badge ml-1 bg-warn/15 text-warn">плей-ин</span>}
                  </td>
                  <td className="td text-right">
                    <Link href={`/matches/${m.id}`} className="text-sm font-semibold text-ice hover:underline">
                      открыть →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {!list.length && (
              <tr>
                <td colSpan={8} className="px-4 py-14 text-center">
                  <p className="text-lg font-bold">Пока нет ни одного матча</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    Импортируйте первый протокол —{" "}
                    <Link href="/import" className="font-semibold text-accent hover:underline">начать</Link>
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
