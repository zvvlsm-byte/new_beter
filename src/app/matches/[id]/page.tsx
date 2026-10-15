import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { goals, goalieGames, matches, penalties, skaterGames } from "@/db/schema";
import { MatchEditor } from "@/components/MatchEditor";
import type { MatchPayload } from "@/lib/api";
import { fmtDateRu } from "@/lib/clean";

export const dynamic = "force-dynamic";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) notFound();
  const [match] = await db.select().from(matches).where(eq(matches.id, id));
  if (!match) notFound();

  const [skaters, goalies, goalList, penaltyList] = await Promise.all([
    db.select().from(skaterGames).where(eq(skaterGames.matchId, id)),
    db.select().from(goalieGames).where(eq(goalieGames.matchId, id)),
    db.select().from(goals).where(eq(goals.matchId, id)),
    db.select().from(penalties).where(eq(penalties.matchId, id)),
  ]);

  const payload: MatchPayload = {
    date: match.date,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    winType: match.winType,
    stage: match.stage === "playoff" || match.stage === "playin" ? match.stage : "regular",
    periods: match.periods,
    sourceUrl: match.sourceUrl ?? "",
    notes: match.notes ?? "",
    attendance: match.attendance ?? null,
    skaters: skaters.map((s) => ({
      side: s.side, jersey: s.jersey, position: s.position ?? "Н", name: s.name,
      goals: s.goals, assists: s.assists, plusMinus: s.plusMinus, shots: s.shots,
      shotsOnGoal: s.shotsOnGoal, hits: s.hits, blocks: s.blocks, pim: s.pim,
      toi: s.toiSeconds ? `${Math.floor(s.toiSeconds / 60)}:${String(s.toiSeconds % 60).padStart(2, "0")}` : "",
      faceoffs: s.faceoffs, faceoffWins: s.faceoffWins,
      periodToi: s.periodToi ?? [],
    })),
    goalies: goalies.map((g) => ({
      side: g.side, jersey: g.jersey, name: g.name,
      toi: g.toiSeconds ? `${Math.floor(g.toiSeconds / 60)}:${String(g.toiSeconds % 60).padStart(2, "0")}` : "",
      saves: g.saves, goalsAgainst: g.goalsAgainst, result: (g.result ?? "") as "" | "W" | "L",
      goals: g.goals, assists: g.assists, shots: g.shots, shotsOnGoal: g.shotsOnGoal,
      hits: g.hits, blocks: g.blocks, pim: g.pim, periodToi: g.periodToi ?? [],
    })),
    goals: goalList.map((g) => ({
      side: g.side, period: g.period, time: g.time ?? "",
      strength: (["eq", "pp", "sh"].includes(g.strength) ? g.strength : "eq") as "eq" | "pp" | "sh",
      emptyNet: g.emptyNet, scorer: g.scorer, assist1: g.assist1 ?? "", assist2: g.assist2 ?? "",
    })),
    penalties: penaltyList.map((p) => ({
      side: p.side, period: p.period, time: p.time ?? "", minutes: p.minutes,
      player: p.player ?? "", infraction: p.infraction ?? "", coincidental: p.coincidental,
      penaltyShot: p.penaltyShot,
    })),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-wide text-ink-soft uppercase">
            Матч №{match.id} · {fmtDateRu(match.date)}
            {match.sourceUrl ? (
              <>
                {" · "}
                <a href={match.sourceUrl} target="_blank" rel="noreferrer" className="text-ice hover:underline">
                  протокол-источник ↗
                </a>
              </>
            ) : null}
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight">
            {match.homeTeam} <span className="font-mono text-accent">{match.homeScore}:{match.awayScore}</span> {match.awayTeam}
          </h1>
          {match.notes ? <p className="mt-1 text-sm text-ink-soft">Заметка: {match.notes}</p> : null}
        </div>
        <Link href="/" className="btn">← Все матчи</Link>
      </div>
      <MatchEditor initial={payload} matchId={match.id} />
    </div>
  );
}
