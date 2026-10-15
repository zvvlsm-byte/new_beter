import Link from "next/link";
import { db } from "@/db";
import type { Match } from "@/db/schema";
import { arenaCapacities, matches } from "@/db/schema";
import { fmtDateRu } from "@/lib/clean";
import { computeAttendance } from "@/lib/compute";
import { computeCapacityStats } from "@/lib/capacity";
import { AttendanceView } from "./AttendanceView";
import { ArenaCapacityEditor } from "./ArenaCapacityEditor";
import { CapacityInfographics } from "./CapacityInfographics";

export const dynamic = "force-dynamic";

function matchLabel(m: Match): string {
  return `${m.homeTeam} ${m.homeScore}:${m.awayScore} ${m.awayTeam}`;
}

export default async function AttendancePage() {
  const [allMatches, capacityRows] = await Promise.all([
    db.select().from(matches),
    db.select().from(arenaCapacities),
  ]);
  // существующие расчёты посещаемости — без изменений
  const { teams, gamesWithData, totalAll, avgAll, top, bottom } = computeAttendance(allMatches);
  // новое: вместимость арен, аншлаги и заполняемость
  const capacity = computeCapacityStats(allMatches, capacityRows);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Зрители</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Посещаемость по домашним матчам каждой команды: всего и в среднем. Клик по заголовку столбца сортирует таблицу.
          Если у матча нет числа зрителей, кнопка «Догрузить зрителей» на главной соберёт его из протоколов по ссылкам.
          Ниже можно задать вместимость каждой арены — тогда добавится инфографика по аншлагам и заполняемости.
        </p>
      </div>

      {gamesWithData === 0 ? (
        <div className="card px-6 py-14 text-center">
          <p className="text-lg font-bold">Данных о зрителях пока нет</p>
          <p className="mt-1 text-sm text-ink-soft">
            Импортируйте протоколы — <Link href="/import" className="font-semibold text-accent hover:underline">начать</Link>
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="card border-l-4 border-l-ice px-4 py-3">
              <div className="text-[11px] font-bold tracking-wide text-ink-soft uppercase">Всего зрителей</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums">{totalAll.toLocaleString("ru-RU")}</div>
              <div className="text-xs text-ink-soft">по {gamesWithData} матч. с данными</div>
            </div>
            <div className="card border-l-4 border-l-ok px-4 py-3">
              <div className="text-[11px] font-bold tracking-wide text-ink-soft uppercase">Средняя посещаемость</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums">{avgAll !== null ? avgAll.toLocaleString("ru-RU") : "—"}</div>
              <div className="text-xs text-ink-soft">зрителей за матч</div>
            </div>
            <div className="card border-l-4 border-l-accent px-4 py-3">
              <div className="text-[11px] font-bold tracking-wide text-ink-soft uppercase">Самый посещаемый матч</div>
              {top ? (
                <>
                  <div className="mt-1 font-mono text-2xl font-bold tabular-nums">{(top.attendance ?? 0).toLocaleString("ru-RU")}</div>
                  <div className="text-xs text-ink-soft">{fmtDateRu(top.date)} · {matchLabel(top)}</div>
                </>
              ) : (
                <div className="mt-1 text-sm text-ink-soft">нет данных</div>
              )}
            </div>
            <div className="card border-l-4 border-l-warn px-4 py-3">
              <div className="text-[11px] font-bold tracking-wide text-ink-soft uppercase">Самый малопосещаемый матч</div>
              {bottom ? (
                <>
                  <div className="mt-1 font-mono text-2xl font-bold tabular-nums">{(bottom.attendance ?? 0).toLocaleString("ru-RU")}</div>
                  <div className="text-xs text-ink-soft">{fmtDateRu(bottom.date)} · {matchLabel(bottom)}</div>
                </>
              ) : (
                <div className="mt-1 text-sm text-ink-soft">нет данных</div>
              )}
            </div>
          </div>

          <AttendanceView teams={teams} />

          <p className="text-xs text-ink-soft">
            Зрители — это общее число на матче, поэтому они учитываются как домашняя посещаемость хозяев площадки.
          </p>
        </>
      )}

      {/* НОВОЕ: ручной ввод вместимости арен + инфографика по аншлагам и заполняемости */}
      <ArenaCapacityEditor arenas={capacity.arenas} />
      <CapacityInfographics data={capacity} />
    </div>
  );
}
