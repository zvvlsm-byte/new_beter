import { NextResponse } from "next/server";
import { fetchUpcomingGame } from "@/lib/history";
import { buildPreview } from "@/lib/preview";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Анализ предстоящего матча по ссылке hockey.by/gamecenter/<id>/ */
export async function POST(req: Request) {
  const { url } = (await req.json().catch(() => ({}))) as { url?: string };
  if (!url) return NextResponse.json({ error: "Вставьте ссылку на матч" }, { status: 400 });
  try {
    const game = await fetchUpcomingGame(url);
    const preview = await buildPreview(game);
    return NextResponse.json(preview);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ошибка анализа" }, { status: 400 });
  }
}
