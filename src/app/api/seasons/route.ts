import { NextResponse } from "next/server";
import { fetchHockeyByTeam } from "@/lib/hockeyby";
import { loadSeasonsPayload, saveSeasonImport } from "@/lib/seasonsDb";
import { STAGES, type Stage } from "@/lib/seasonStats";

export const dynamic = "force-dynamic";

/** Весь архив: загрузки + строки игроков и вратарей. */
export async function GET() {
  return NextResponse.json(await loadSeasonsPayload());
}

/** Загрузить и сохранить статистику команды по ссылке hockey.by. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { url?: string; stage?: string; season?: string };
    if (!body.url) return NextResponse.json({ error: "Не указана ссылка" }, { status: 400 });
    const page = await fetchHockeyByTeam(body.url);
    const stage: Stage = STAGES.some((s) => s.key === body.stage) ? (body.stage as Stage) : page.guessedStage;
    const season = body.season && /^\d{4}-\d{4}$/.test(body.season) ? body.season : page.season;
    const id = await saveSeasonImport(page, { stage, season });
    return NextResponse.json({
      id, season, stage, team: page.team, skaters: page.skaters.length, goalies: page.goalies.length,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
