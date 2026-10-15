import { desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { matches, skaterGames, statRefreshRuns, type StatChange } from "@/db/schema";
import { diffMatchSkaters, fetchStatProtocol, skaterRowsFromParsed, type NewSkaterRow } from "@/lib/playerStatsDiff";
import { writeSnapshotFile } from "@/lib/snapshot";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Текущая (незакрытая) проверка — для плашки на странице «Матчи». */
export async function GET() {
  const [run] = await db
    .select()
    .from(statRefreshRuns)
    .where(eq(statRefreshRuns.dismissed, false))
    .orderBy(desc(statRefreshRuns.id))
    .limit(1);
  return NextResponse.json({ run: run ?? null });
}

/**
 * Шаг 1: пройти по протоколам всех матчей со ссылкой и собрать список изменений
 * статистики/времени ПОЛЕВЫХ игроков. Ничего не меняется в базе, пока
 * пользователь не ответит «да» по конкретным изменениям.
 */
export async function POST() {
  const all = await db.select().from(matches);
  const targets = all.filter((m) => m.sourceUrl && /^https?:\/\//.test(m.sourceUrl));
  const ids = targets.map((m) => m.id);
  const current = ids.length ? await db.select().from(skaterGames).where(inArray(skaterGames.matchId, ids)) : [];
  const changes: StatChange[] = [];
  const failedInfo: string[] = [];

  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const m = targets[cursor++];
      try {
        const parsed = await fetchStatProtocol(m.sourceUrl as string);
        const fresh = skaterRowsFromParsed(m.id, parsed);
        if (!fresh.length) throw new Error("в протоколе нет полевых игроков");
        changes.push(...diffMatchSkaters(m, current.filter((c) => c.matchId === m.id), fresh));
      } catch (e) {
        failedInfo.push(`${m.date} ${m.homeTeam} — ${m.awayTeam}: ${e instanceof Error ? e.message : "ошибка"}`);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  changes.sort((a, b) => b.date.localeCompare(a.date) || a.matchId - b.matchId || a.side.localeCompare(b.side) || a.name.localeCompare(b.name, "ru"));

  // предыдущие незакрытые проверки заменяются новой
  await db.update(statRefreshRuns).set({ dismissed: true }).where(eq(statRefreshRuns.dismissed, false));
  const [run] = await db
    .insert(statRefreshRuns)
    .values({ checked: targets.length, failed: failedInfo.length, failedInfo, changes })
    .returning();
  return NextResponse.json({ run });
}

/**
 * Шаг 2: применить решения. body: { runId, decisions: { [changeId]: boolean } }.
 * «Да» — изменение записывается в базу, «нет» — помечается отклонённым.
 */
export async function PUT(req: Request) {
  const body = (await req.json()) as { runId: number; decisions: Record<string, boolean> };
  const [run] = await db.select().from(statRefreshRuns).where(eq(statRefreshRuns.id, body.runId));
  if (!run) return NextResponse.json({ error: "Проверка не найдена" }, { status: 404 });
  const decisions = body.decisions ?? {};
  const next = run.changes.map((c) => ({ ...c }));
  let applied = 0;
  await db.transaction(async (tx) => {
    for (const c of next) {
      if (c.status !== "pending" || !(c.id in decisions)) continue;
      if (!decisions[c.id]) {
        c.status = "rejected";
        continue;
      }
      const row = c.newRow as unknown as NewSkaterRow | null;
      if (c.kind === "update" && c.skaterId && row) {
        await tx
          .update(skaterGames)
          .set({
            goals: row.goals, assists: row.assists, plusMinus: row.plusMinus, shots: row.shots,
            shotsOnGoal: row.shotsOnGoal, hits: row.hits, blocks: row.blocks, pim: row.pim,
            toiSeconds: row.toiSeconds, faceoffs: row.faceoffs, faceoffWins: row.faceoffWins,
            periodToi: row.periodToi, jersey: row.jersey, position: row.position ?? undefined,
            rawName: row.rawName ?? undefined,
          })
          .where(eq(skaterGames.id, c.skaterId));
      } else if (c.kind === "add" && row) {
        await tx.insert(skaterGames).values({ ...row, matchId: c.matchId });
      } else if (c.kind === "remove" && c.skaterId) {
        await tx.delete(skaterGames).where(eq(skaterGames.id, c.skaterId));
      }
      c.status = "applied";
      applied += 1;
    }
    await tx.update(statRefreshRuns).set({ changes: next }).where(eq(statRefreshRuns.id, run.id));
  });
  if (applied) await writeSnapshotFile();
  return NextResponse.json({ applied, run: { ...run, changes: next } });
}

/** Закрыть плашку. */
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = parseInt(searchParams.get("id") ?? "", 10);
  if (id) await db.update(statRefreshRuns).set({ dismissed: true }).where(eq(statRefreshRuns.id, id));
  else await db.update(statRefreshRuns).set({ dismissed: true }).where(eq(statRefreshRuns.dismissed, false));
  return NextResponse.json({ ok: true });
}
