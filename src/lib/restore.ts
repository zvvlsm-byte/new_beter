import fs from "fs/promises";
import path from "path";
import { db } from "@/db";
import { goalieGames, goals, matches, penalties, skaterGames } from "@/db/schema";
import type { Snapshot } from "./snapshot";

/**
 * Автовосстановление проекта: если в БД ещё нет ни одного матча, а в
 * data/snapshot.json лежит снимок — загружаем его целиком (данные не меняются,
 * переносятся как есть, включая посещаемость).
 */
export async function restoreMatchesFromFileIfEmpty(): Promise<number> {
  const existing = await db.select({ id: matches.id }).from(matches).limit(1);
  if (existing.length) return 0;
  let raw: string;
  try {
    raw = await fs.readFile(path.join(process.cwd(), "data", "snapshot.json"), "utf8");
  } catch {
    return 0;
  }
  const snap = JSON.parse(raw) as Snapshot;
  if (!snap || !Array.isArray(snap.matches)) return 0;
  let count = 0;
  await db.transaction(async (tx) => {
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
          attendance: m.attendance ?? null,
          stage: m.stage === "playoff" || m.stage === "playin" ? m.stage : "regular",
        })
        .returning({ id: matches.id });
      const nid = ins.id;
      const strip = <T extends { id: number; matchId: number }>(r: T) => {
        const { id: _id, matchId: _mid, ...rest } = r;
        void _id;
        void _mid;
        return { ...rest, matchId: nid };
      };
      const sk = (entry.skaters ?? []).map(strip);
      if (sk.length) await tx.insert(skaterGames).values(sk);
      const gl = (entry.goalies ?? []).map(strip);
      if (gl.length) await tx.insert(goalieGames).values(gl);
      const go = (entry.goals ?? []).map(strip);
      if (go.length) await tx.insert(goals).values(go);
      const pe = (entry.penalties ?? []).map(strip);
      if (pe.length) await tx.insert(penalties).values(pe);
      count += 1;
    }
  });
  return count;
}
