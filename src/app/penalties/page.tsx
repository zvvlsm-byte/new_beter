import { db } from "@/db";
import { goalieGames, matches, penalties } from "@/db/schema";
import { computePenaltyStats, computeTeamPenaltyTable } from "@/lib/compute";
import { PenaltiesView, type PenaltyListRow } from "./PenaltiesView";

export const dynamic = "force-dynamic";

export default async function PenaltiesPage() {
  const [allMatches, allPenalties, allGoalies] = await Promise.all([
    db.select().from(matches),
    db.select().from(penalties),
    db.select().from(goalieGames),
  ]);
  const teamTable = computeTeamPenaltyTable(allMatches, allPenalties, allGoalies);
  const { byPlayer, list } = computePenaltyStats(allMatches, allPenalties);

  const rows: PenaltyListRow[] = list
    .map((p) => ({
      id: p.id,
      team: p.team,
      player: p.player,
      minutes: p.minutes,
      period: p.period,
      time: p.time,
      infraction: p.infraction,
      matchDate: p.match?.date ?? null,
      matchId: p.matchId,
      matchLabel: p.match ? `${p.match.homeTeam} ${p.match.homeScore}:${p.match.awayScore} ${p.match.awayTeam}` : null,
      coincidental: !!p.coincidental,
      penaltyShot: !!p.penaltyShot,
    }))
    .sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? ""));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Штрафы</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Сводка удалений по командам (количество по длительности, ШБ, командные и вратарские штрафы, дом/выезд, средние),
          разбивка по игрокам и лидеры по каждому виду нарушений. Клик по заголовку столбца сортирует таблицу.
        </p>
      </div>
      <PenaltiesView teamTable={teamTable} byPlayer={byPlayer} list={rows} />
    </div>
  );
}
