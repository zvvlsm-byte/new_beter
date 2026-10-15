import { NextResponse } from "next/server";
import { db } from "@/db";
import { arenaCapacities } from "@/db/schema";

export const dynamic = "force-dynamic";

/** Все сохранённые вместимости арен. */
export async function GET() {
  const rows = await db.select().from(arenaCapacities);
  return NextResponse.json(rows);
}

export type ArenaCapacityPayload = {
  team: string;
  arenaName?: string | null;
  capacity?: number | string | null;
};

/**
 * Сохраняет вместимость арены (по команде-хозяйке).
 * Если и вместимость, и название пустые — строка удаляется.
 */
export async function POST(req: Request) {
  let body: { rows: ArenaCapacityPayload[] };
  try {
    body = (await req.json()) as { rows: ArenaCapacityPayload[] };
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const { eq } = await import("drizzle-orm");

  let saved = 0;
  let removed = 0;
  for (const r of rows) {
    const team = String(r.team ?? "").trim();
    if (!team) continue;

    const rawCap = r.capacity;
    const capacity =
      rawCap === null || rawCap === undefined || rawCap === "" || !Number.isFinite(Number(rawCap))
        ? null
        : Math.max(0, Math.round(Number(rawCap)));
    const arenaName = String(r.arenaName ?? "").trim() || null;

    if (capacity === null && arenaName === null) {
      const del = await db
        .delete(arenaCapacities)
        .where(eq(arenaCapacities.team, team))
        .returning({ id: arenaCapacities.id });
      if (del.length) removed += 1;
      continue;
    }

    await db
      .insert(arenaCapacities)
      .values({ team, arenaName, capacity, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: arenaCapacities.team,
        set: { arenaName, capacity, updatedAt: new Date() },
      });
    saved += 1;
  }
  return NextResponse.json({ ok: true, saved, removed });
}
