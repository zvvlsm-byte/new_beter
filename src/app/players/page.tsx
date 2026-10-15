import { db } from "@/db";
import { matches, skaterGames } from "@/db/schema";
import { computePlayerSeason } from "@/lib/compute";
import { getActiveStage, idsOfStage, relatedOfStage } from "@/lib/seasonMode";
import { PlayersTable } from "./PlayersTable";

export const dynamic = "force-dynamic";

export default async function PlayersPage() {
  const [allMatches, allSkaters, activeStage] = await Promise.all([
    db.select().from(matches),
    db.select().from(skaterGames),
    getActiveStage(),
  ]);
  const extend = (base: ReturnType<typeof computePlayerSeason>) =>
    base.map((r) => {
      const hours = r.toi / 3600;
      return {
        ...r,
        goalsPer60: hours > 0 ? r.goals / hours : null,
        shotsPer60: hours > 0 ? r.shotsOnGoal / hours : null,
      };
    });

  const regularIds = idsOfStage(allMatches, "regular");
  const playoffIds = new Set([...idsOfStage(allMatches, "playoff"), ...idsOfStage(allMatches, "playin")]);
  const showStageFilter = activeStage === "playoff" || activeStage === "playin" || playoffIds.size > 0;

  const regularMatches = allMatches.filter((m) => regularIds.has(m.id));
  const playoffMatches = allMatches.filter((m) => playoffIds.has(m.id));

  const mainRows = showStageFilter
    ? extend(computePlayerSeason(regularMatches, relatedOfStage(allSkaters, regularIds)))
    : extend(computePlayerSeason(allMatches, allSkaters));
  const playoffRows = showStageFilter
    ? extend(computePlayerSeason(playoffMatches, relatedOfStage(allSkaters, playoffIds)))
    : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Статистика игроков</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Суммарные показатели за все матчи. Г/60, Бр/60, Силовые/60 и Блок/60 считаются от фактического времени на льду,
          среднее время — суммарное время, делённое на количество матчей.
          {showStageFilter ? " Фильтр РЧ / плей-офф не смешивает стадии." : ""}
        </p>
      </div>
      {mainRows.length || playoffRows.length ? (
        <PlayersTable rows={mainRows} playoffRows={playoffRows} showStageFilter={showStageFilter} />
      ) : (
        <div className="card px-6 py-14 text-center text-sm text-ink-soft">
          Пока нет данных — импортируйте первый протокол.
        </div>
      )}
    </div>
  );
}
