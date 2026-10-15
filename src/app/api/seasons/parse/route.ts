import { NextResponse } from "next/server";
import { fetchHockeyByTeam } from "@/lib/hockeyby";

export const dynamic = "force-dynamic";

/** Предпросмотр: разобрать ссылки hockey.by без сохранения. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { urls?: string[] };
  const urls = (body.urls ?? []).map((u) => u.trim()).filter(Boolean).slice(0, 40);
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const p = await fetchHockeyByTeam(url);
        return {
          ok: true as const,
          url: p.url,
          season: p.season,
          league: p.league,
          divisionName: p.divisionName,
          team: p.team,
          stage: p.guessedStage,
          skaters: p.skaters.length,
          goalies: p.goalies.length,
          skaterColumns: p.skaterColumns,
          goalieColumns: p.goalieColumns,
        };
      } catch (e) {
        return { ok: false as const, url, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  return NextResponse.json({ results });
}
