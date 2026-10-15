import Link from "next/link";
import { db } from "@/db";
import { goalieGames, matches, skaterGames } from "@/db/schema";
import { computeGoalieDays, computePlayerDays } from "@/lib/compute";
import { computeDayForm, type DayForm } from "@/lib/formStreaks";
import { computeScoringStreaks, type ScoringStreak } from "@/lib/scoringStreaks";
import { DayView } from "./DayView";

export const dynamic = "force-dynamic";

export default async function DayPage() {
  const [allMatches, allSkaters, allGoalies] = await Promise.all([
    db.select().from(matches),
    db.select().from(skaterGames),
    db.select().from(goalieGames),
  ]);
  const playerDays = computePlayerDays(allMatches, allSkaters);
  const goalieDays = computeGoalieDays(allMatches, allGoalies);

  // «К следующим матчам»: активные существенные серии на каждый игровой день
  const dates = [...new Set(allMatches.map((m) => m.date))];
  const formByDate: Record<string, DayForm> = {};
  for (const d of dates) formByDate[d] = computeDayForm(allMatches, allSkaters, allGoalies, d);
  // бомбардирские серии сезона (действующие и прерванные) на каждый игровой день
  const scoringByDate: Record<string, ScoringStreak[]> = {};
  for (const d of dates) scoringByDate[d] = computeScoringStreaks(allMatches, allSkaters, d).slice(0, 60);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Статистика дня</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Лучшие показатели игроков и вратарей в выбранный игровой день. Если в один день несколько матчей — показатели суммируются.
        </p>
      </div>
      {playerDays.length ? (
        <DayView playerDays={playerDays} goalieDays={goalieDays} formByDate={formByDate} scoringByDate={scoringByDate} />
      ) : (
        <div className="card px-6 py-14 text-center">
          <p className="text-lg font-bold">Пока нет данных</p>
          <p className="mt-1 text-sm text-ink-soft">
            Импортируйте протоколы — <Link href="/import" className="font-semibold text-accent hover:underline">начать</Link>
          </p>
        </div>
      )}
    </div>
  );
}
