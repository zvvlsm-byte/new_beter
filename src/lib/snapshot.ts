import fs from "fs/promises";
import path from "path";
import { db } from "@/db";
import { goals, goalieGames, matches, penalties, skaterGames } from "@/db/schema";

/**
 * Полный снимок данных: все матчи вместе с вложенными составами, вратарями,
 * голами и удалениями. Используется для экспорта, записи в файл и восстановления.
 */
export async function buildSnapshot() {
  const [allMatches, allSkaters, allGoalies, allGoals, allPens] = await Promise.all([
    db.select().from(matches),
    db.select().from(skaterGames),
    db.select().from(goalieGames),
    db.select().from(goals),
    db.select().from(penalties),
  ]);
  const byMatch = <T extends { matchId: number }>(arr: T[], id: number) =>
    arr.filter((x) => x.matchId === id);
  return {
    version: 1 as const,
    app: "ledovyi-protokol",
    exportedAt: new Date().toISOString(),
    matches: allMatches.map((m) => ({
      match: m,
      skaters: byMatch(allSkaters, m.id),
      goalies: byMatch(allGoalies, m.id),
      goals: byMatch(allGoals, m.id),
      penalties: byMatch(allPens, m.id),
    })),
  };
}

export type Snapshot = Awaited<ReturnType<typeof buildSnapshot>>;

const SNAPSHOT_DIR = () => path.join(process.cwd(), "data");
const SNAPSHOT_FILE = () => path.join(SNAPSHOT_DIR(), "snapshot.json");

/** Автоматическая запись снимка в локальный файл проекта (лучшая попытка). */
export async function writeSnapshotFile(): Promise<void> {
  try {
    const snap = await buildSnapshot();
    await fs.mkdir(SNAPSHOT_DIR(), { recursive: true });
    await fs.writeFile(SNAPSHOT_FILE(), JSON.stringify(snap, null, 2), "utf8");
  } catch (e) {
    console.error("[snapshot] не удалось записать файл:", e);
  }
}

/** Восстановление данных из снимка: полностью заменяет текущие данные. */
export async function importSnapshot(snap: Snapshot): Promise<number> {
  if (!snap || !Array.isArray(snap.matches)) {
    throw new Error("Некорректный файл данных: нет списка матчей");
  }
  let count = 0;
  await db.transaction(async (tx) => {
    await tx.delete(penalties);
    await tx.delete(goals);
    await tx.delete(goalieGames);
    await tx.delete(skaterGames);
    await tx.delete(matches);

    for (const entry of snap.matches) {
      const m = entry.match;
      const [ins] = await tx
        .insert(matches)
        .values({
          date: m.date,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          winType: m.winType ?? "reg",
          periods: m.periods ?? [],
          sourceUrl: m.sourceUrl ?? null,
          notes: m.notes ?? null,
          stage: m.stage === "playoff" || m.stage === "playin" ? m.stage : "regular",
        })
        .returning({ id: matches.id });
      const nid = ins.id;

      const sk = (entry.skaters ?? []).map((r) => {
        const { id, matchId, ...rest } = r;
        return { ...rest, matchId: nid };
      });
      if (sk.length) await tx.insert(skaterGames).values(sk);

      const gl = (entry.goalies ?? []).map((r) => {
        const { id, matchId, ...rest } = r;
        return { ...rest, matchId: nid };
      });
      if (gl.length) await tx.insert(goalieGames).values(gl);

      const go = (entry.goals ?? []).map((r) => {
        const { id, matchId, ...rest } = r;
        return { ...rest, matchId: nid };
      });
      if (go.length) await tx.insert(goals).values(go);

      const pe = (entry.penalties ?? []).map((r) => {
        const { id, matchId, ...rest } = r;
        return { ...rest, matchId: nid };
      });
      if (pe.length) await tx.insert(penalties).values(pe);

      count += 1;
    }
  });
  return count;
}
