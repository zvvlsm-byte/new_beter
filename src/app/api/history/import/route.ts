import { NextResponse } from "next/server";
import { fetchHtml, parseHistoricProtocol, protocolIdFromUrl, protocolUrl } from "@/lib/history";
import { findHistByExtId, findHistSameMatch, saveHistGame, writeHistoryFile } from "@/lib/historyDb";
import type { HistGame } from "@/db/schema";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ddmmyyyy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const gameLabel = (g: Pick<HistGame, "date" | "homeTeam" | "awayTeam" | "homeScore" | "awayScore">) =>
  `${ddmmyyyy(g.date)} · ${g.homeTeam} ${g.homeScore}:${g.awayScore} ${g.awayTeam}`;
const dupGame = (g: HistGame) => ({
  id: g.id, extId: g.extId, date: g.date, season: g.season, competition: g.competition,
  homeTeam: g.homeTeam, awayTeam: g.awayTeam, homeScore: g.homeScore, awayScore: g.awayScore,
});

/**
 * Импорт одного старого протокола: body { url } или { id }.
 * writeFile=false — для пакетной загрузки (файл-резерв пишется в конце через PUT).
 * Защита от дубля: если протокол (или тот же матч под другим id) уже в архиве —
 * возвращается { ok:false, duplicate:true }. force=true — осознанно перезагрузить.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { url?: string; id?: number; writeFile?: boolean; force?: boolean };
  const id = body.id ?? (body.url ? protocolIdFromUrl(body.url) : null);
  if (!id) return NextResponse.json({ error: "Укажите ссылку вида https://hockey.by/new-admin/games/11575/?print=protocol" }, { status: 400 });
  const url = protocolUrl(id);
  try {
    // 1) такой протокол уже загружен
    if (!body.force) {
      const ex = await findHistByExtId(id);
      if (ex) {
        return NextResponse.json({
          ok: false, duplicate: true, id,
          error: `Такой протокол уже есть в архиве: ${gameLabel(ex)}`,
          existing: dupGame(ex),
        });
      }
    }
    const html = await fetchHtml(url);
    const parsed = parseHistoricProtocol(html, id, url);
    if (!parsed.players.length) throw new Error("в протоколе нет составов");
    // 2) тот же матч (дата + команды) уже есть под другим id протокола
    if (!body.force) {
      const same = await findHistSameMatch(parsed);
      if (same) {
        return NextResponse.json({
          ok: false, duplicate: true, id,
          error: `Этот матч уже есть в архиве (протокол #${same.extId}): ${gameLabel(same)}`,
          existing: dupGame(same),
        });
      }
    }
    await saveHistGame(parsed, { writeFile: body.writeFile !== false });
    return NextResponse.json({
      ok: true,
      game: {
        extId: id, date: parsed.date, season: parsed.season, competition: parsed.competition,
        homeTeam: parsed.homeTeam, awayTeam: parsed.awayTeam, homeScore: parsed.homeScore, awayScore: parsed.awayScore,
        players: parsed.players.length, goalies: parsed.goalies.length,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, id, error: e instanceof Error ? e.message : "ошибка" });
  }
}

/** Записать файл-резерв data/history.json (после пакетной загрузки). */
export async function PUT() {
  await writeHistoryFile();
  return NextResponse.json({ ok: true });
}
