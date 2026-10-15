import { db } from "@/db";
import { goalieGames, matches } from "@/db/schema";
import { computeGoalieSeason } from "@/lib/compute";
import { getActiveStage, idsOfStage, relatedOfStage } from "@/lib/seasonMode";
import { GoaliesTable } from "./GoaliesTable";

export const dynamic = "force-dynamic";

export default async function GoaliesPage() {
  const [allMatches, allGoalies, activeStage] = await Promise.all([
    db.select().from(matches),
    db.select().from(goalieGames),
    getActiveStage(),
  ]);
  const regularIds = idsOfStage(allMatches, "regular");
  const playoffIds = new Set([...idsOfStage(allMatches, "playoff"), ...idsOfStage(allMatches, "playin")]);
  const showStageFilter = activeStage === "playoff" || activeStage === "playin" || playoffIds.size > 0;
  const regularMatches = allMatches.filter((m) => regularIds.has(m.id));
  const playoffMatches = allMatches.filter((m) => playoffIds.has(m.id));

  const rows = showStageFilter
    ? computeGoalieSeason(regularMatches, relatedOfStage(allGoalies, regularIds))
    : computeGoalieSeason(allMatches, allGoalies);
  const playoffRows = showStageFilter
    ? computeGoalieSeason(playoffMatches, relatedOfStage(allGoalies, playoffIds))
    : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Вратари</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Отдельная вратарская статистика: сейвы, броски, процент отражённых, коэффициент надёжности и среднее время на льду.
          {showStageFilter ? " Фильтр РЧ / плей-офф не смешивает стадии." : ""}
        </p>
      </div>
      {rows.length || playoffRows.length ? (
        <GoaliesTable rows={rows} playoffRows={playoffRows} showStageFilter={showStageFilter} />
      ) : (
        <div className="card px-6 py-14 text-center text-sm text-ink-soft">
          Пока нет данных — импортируйте первый протокол.
        </div>
      )}
    </div>
  );
}
