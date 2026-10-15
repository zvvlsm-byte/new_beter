import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { seasonImports } from "@/db/schema";
import { fetchHockeyByTeam } from "@/lib/hockeyby";
import { saveSeasonImport, writeSeasonsFile } from "@/lib/seasonsDb";
import { STAGES, type Stage } from "@/lib/seasonStats";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Изменить стадию / сезон загрузки. */
export async function PATCH(req: Request, ctx: Ctx) {
  const id = parseInt((await ctx.params).id, 10);
  const body = (await req.json().catch(() => ({}))) as { stage?: string; season?: string };
  const set: Partial<typeof seasonImports.$inferInsert> = {};
  if (body.stage && STAGES.some((s) => s.key === body.stage)) set.stage = body.stage;
  if (body.season && /^\d{4}-\d{4}$/.test(body.season)) set.season = body.season;
  if (!Object.keys(set).length) return NextResponse.json({ error: "Нечего менять" }, { status: 400 });
  await db.update(seasonImports).set(set).where(eq(seasonImports.id, id));
  await writeSeasonsFile();
  return NextResponse.json({ ok: true });
}

/** Обновить загрузку с hockey.by (перекачать по той же ссылке). */
export async function POST(_req: Request, ctx: Ctx) {
  const id = parseInt((await ctx.params).id, 10);
  const [imp] = await db.select().from(seasonImports).where(eq(seasonImports.id, id));
  if (!imp) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  try {
    const page = await fetchHockeyByTeam(imp.url);
    const nid = await saveSeasonImport(page, { stage: imp.stage as Stage, season: imp.season });
    return NextResponse.json({ id: nid, skaters: page.skaters.length, goalies: page.goalies.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const id = parseInt((await ctx.params).id, 10);
  await db.delete(seasonImports).where(eq(seasonImports.id, id));
  await writeSeasonsFile();
  return NextResponse.json({ ok: true });
}
