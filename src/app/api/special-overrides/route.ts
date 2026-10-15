import { NextResponse } from "next/server";
import { db } from "@/db";
import { specialTeamOverrides } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(specialTeamOverrides);
  return NextResponse.json(rows);
}

export type OverridePayload = {
  team: string;
  ppAttempts: number | null;
  ppGoals: number | null;
  ppGoalsAgainst: number | null;
  ppTimeMinutes: number | null;
  pkAttempts: number | null;
  pkGoalsAgainst: number | null;
  pkGoals: number | null;
  pkTimeMinutes: number | null;
};

/** Сохраняет корректировки команд. Если все поля null — корректировка команды удаляется. */
export async function POST(req: Request) {
  let body: { rows: OverridePayload[] };
  try {
    body = (await req.json()) as { rows: OverridePayload[] };
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }
  const rows = Array.isArray(body.rows) ? body.rows : [];
  let saved = 0;
  let removed = 0;
  for (const r of rows) {
    const team = String(r.team ?? "").trim();
    if (!team) continue;
    const allNull =
      r.ppAttempts === null && r.ppGoals === null && r.ppGoalsAgainst === null &&
      r.ppTimeMinutes === null && r.pkAttempts === null && r.pkGoalsAgainst === null &&
      r.pkGoals === null && r.pkTimeMinutes === null;
    if (allNull) {
      const { eq } = await import("drizzle-orm");
      const del = await db.delete(specialTeamOverrides).where(eq(specialTeamOverrides.team, team)).returning({ id: specialTeamOverrides.id });
      if (del.length) removed += 1;
      continue;
    }
    await db
      .insert(specialTeamOverrides)
      .values({
        team,
        ppAttempts: r.ppAttempts,
        ppGoals: r.ppGoals,
        ppGoalsAgainst: r.ppGoalsAgainst,
        ppTimeMinutes: r.ppTimeMinutes,
        pkAttempts: r.pkAttempts,
        pkGoalsAgainst: r.pkGoalsAgainst,
        pkGoals: r.pkGoals,
        pkTimeMinutes: r.pkTimeMinutes,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: specialTeamOverrides.team,
        set: {
          ppAttempts: r.ppAttempts,
          ppGoals: r.ppGoals,
          ppGoalsAgainst: r.ppGoalsAgainst,
          ppTimeMinutes: r.ppTimeMinutes,
          pkAttempts: r.pkAttempts,
          pkGoalsAgainst: r.pkGoalsAgainst,
          pkGoals: r.pkGoals,
          pkTimeMinutes: r.pkTimeMinutes,
          updatedAt: new Date(),
        },
      });
    saved += 1;
  }
  return NextResponse.json({ ok: true, saved, removed });
}
