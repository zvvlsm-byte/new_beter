/**
 * Режим сезона (РЧ / плей-офф) и стадия матча.
 * Не меняет формулы подсчёта — только помечает и фильтрует матчи.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, type Match } from "@/db/schema";
import { type Stage } from "./seasonStats";

export const ACTIVE_STAGE_KEY = "activeStage";

export function matchStage(m: { stage?: string | null }): Stage {
  if (m.stage === "playoff" || m.stage === "playin") return m.stage;
  return "regular";
}

export function normalizeStage(raw: string | null | undefined): Stage {
  if (raw === "playoff" || raw === "playin" || raw === "regular") return raw;
  return "regular";
}

export function matchesOfStage<T extends { stage?: string | null }>(list: T[], stage: Stage): T[] {
  return list.filter((m) => matchStage(m) === stage);
}

export function relatedOfStage<T extends { matchId: number }>(rows: T[], matchIds: Set<number>): T[] {
  return rows.filter((r) => matchIds.has(r.matchId));
}

export function idsOfStage(matches: Match[], stage: Stage): Set<number> {
  return new Set(matchesOfStage(matches, stage).map((m) => m.id));
}

export async function getActiveStage(): Promise<Stage> {
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, ACTIVE_STAGE_KEY)).limit(1);
    return normalizeStage(row?.value);
  } catch {
    return "regular";
  }
}

export async function setActiveStage(stage: Stage): Promise<void> {
  const value = normalizeStage(stage);
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, ACTIVE_STAGE_KEY)).limit(1);
  if (row) await db.update(appSettings).set({ value }).where(eq(appSettings.key, ACTIVE_STAGE_KEY));
  else await db.insert(appSettings).values({ key: ACTIVE_STAGE_KEY, value });
}
