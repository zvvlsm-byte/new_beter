import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { goals, goalieGames, matches, penalties, skaterGames } from "@/db/schema";
import type { MatchPayload } from "@/lib/api";
import { validatePayload } from "@/lib/api";
import { cleanName, parseMMSS } from "@/lib/clean";
import { normalizeStage } from "@/lib/seasonMode";
import { writeSnapshotFile } from "@/lib/snapshot";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id: idStr } = await ctx.params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const [match] = await db.select().from(matches).where(eq(matches.id, id));
  if (!match) return NextResponse.json({ error: "Матч не найден" }, { status: 404 });
  const [skaters, goalies, goalList, penaltyList] = await Promise.all([
    db.select().from(skaterGames).where(eq(skaterGames.matchId, id)).orderBy(asc(skaterGames.jersey)),
    db.select().from(goalieGames).where(eq(goalieGames.matchId, id)).orderBy(asc(goalieGames.jersey)),
    db.select().from(goals).where(eq(goals.matchId, id)).orderBy(asc(goals.id)),
    db.select().from(penalties).where(eq(penalties.matchId, id)).orderBy(asc(penalties.id)),
  ]);
  return NextResponse.json({ match, skaters, goalies, goals: goalList, penalties: penaltyList });
}

export async function PUT(req: Request, ctx: Ctx) {
  const { id: idStr } = await ctx.params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  let body: MatchPayload;
  try {
    body = (await req.json()) as MatchPayload;
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }
  const err = validatePayload(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  await db.transaction(async (tx) => {
    await tx.update(matches).set({
      date: body.date,
      homeTeam: body.homeTeam.trim(),
      awayTeam: body.awayTeam.trim(),
      homeScore: body.homeScore,
      awayScore: body.awayScore,
      winType: body.winType,
      periods: body.periods ?? [],
      sourceUrl: body.sourceUrl || null,
      notes: body.notes || null,
      attendance: body.attendance ?? null,
      stage: normalizeStage(body.stage),
    }).where(eq(matches.id, id));

    await tx.delete(skaterGames).where(eq(skaterGames.matchId, id));
    await tx.delete(goalieGames).where(eq(goalieGames.matchId, id));
    await tx.delete(goals).where(eq(goals.matchId, id));
    await tx.delete(penalties).where(eq(penalties.matchId, id));

    const skRows = (body.skaters ?? [])
      .filter((s) => s.name && s.name.trim())
      .map((s) => ({
        matchId: id, side: s.side, name: cleanName(s.name), rawName: s.name,
        jersey: s.jersey, position: s.position || null,
        goals: s.goals || 0, assists: s.assists || 0, plusMinus: s.plusMinus || 0,
        shots: s.shots || 0, shotsOnGoal: s.shotsOnGoal || 0, hits: s.hits || 0,
        blocks: s.blocks || 0, pim: s.pim || 0, toiSeconds: parseMMSS(s.toi),
        faceoffs: s.faceoffs || 0, faceoffWins: s.faceoffWins || 0,
        periodToi: s.periodToi?.length ? s.periodToi : null,
      }));
    if (skRows.length) await tx.insert(skaterGames).values(skRows);

    const gRows = (body.goalies ?? [])
      .filter((g) => g.name && g.name.trim())
      .map((g) => ({
        matchId: id, side: g.side, name: cleanName(g.name), rawName: g.name,
        jersey: g.jersey, toiSeconds: parseMMSS(g.toi),
        saves: g.saves || 0, goalsAgainst: g.goalsAgainst || 0, result: g.result || null,
        goals: g.goals || 0, assists: g.assists || 0, shots: g.shots || 0,
        shotsOnGoal: g.shotsOnGoal || 0, hits: g.hits || 0, blocks: g.blocks || 0,
        pim: g.pim || 0, periodToi: g.periodToi?.length ? g.periodToi : null,
      }));
    if (gRows.length) await tx.insert(goalieGames).values(gRows);

    const goalRows = (body.goals ?? [])
      .filter((g) => g.scorer && g.scorer.trim())
      .map((g) => ({
        matchId: id, side: g.side, period: g.period || 1, time: g.time || null,
        strength: g.strength || "eq", emptyNet: !!g.emptyNet,
        scorer: cleanName(g.scorer),
        assist1: g.assist1 ? cleanName(g.assist1) : null,
        assist2: g.assist2 ? cleanName(g.assist2) : null,
      }));
    if (goalRows.length) await tx.insert(goals).values(goalRows);

    const penRows = (body.penalties ?? [])
      .filter((p) => p.minutes > 0 || p.penaltyShot)
      .map((p) => ({
        matchId: id, side: p.side, period: p.period || 1, time: p.time || null,
        minutes: p.minutes,
        player: p.player && p.player.trim() ? cleanName(p.player) : null,
        infraction: p.infraction || null,
        coincidental: !!p.coincidental,
        penaltyShot: !!p.penaltyShot,
      }));
    if (penRows.length) await tx.insert(penalties).values(penRows);
  });

  await writeSnapshotFile();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id: idStr } = await ctx.params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  await db.delete(matches).where(eq(matches.id, id));
  await writeSnapshotFile();
  return NextResponse.json({ ok: true });
}
