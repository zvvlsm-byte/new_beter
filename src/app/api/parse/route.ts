import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { matches } from "@/db/schema";
import { parseProtocolHtml } from "@/lib/parse";
import { parseProtocolText, type TextItem } from "@/lib/parseText";
import { getActiveStage } from "@/lib/seasonMode";
import type { ParsedMatch } from "@/lib/types";

async function withActiveStage(parsed: ParsedMatch): Promise<ParsedMatch> {
  if (parsed.stage !== "regular") return parsed;
  const active = await getActiveStage();
  if (active !== "regular") parsed.stage = active;
  return parsed;
}

export type DuplicateInfo = {
  id: number;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
};

/** Ищем в базе матч с тем же источником (ссылка) или той же парой команд и датой. */
async function findDuplicate(parsed: ParsedMatch, url?: string): Promise<DuplicateInfo | null> {
  try {
    if (url) {
      const byUrl = await db
        .select()
        .from(matches)
        .where(eq(matches.sourceUrl, url.trim()))
        .limit(1);
      if (byUrl.length) {
        const m = byUrl[0];
        return { id: m.id, date: m.date, homeTeam: m.homeTeam, awayTeam: m.awayTeam, homeScore: m.homeScore, awayScore: m.awayScore };
      }
    }
    if (parsed.homeTeam && parsed.awayTeam && parsed.date) {
      const byTeams = await db
        .select()
        .from(matches)
        .where(and(eq(matches.date, parsed.date), eq(matches.homeTeam, parsed.homeTeam), eq(matches.awayTeam, parsed.awayTeam)))
        .limit(1);
      if (byTeams.length) {
        const m = byTeams[0];
        return { id: m.id, date: m.date, homeTeam: m.homeTeam, awayTeam: m.awayTeam, homeScore: m.homeScore, awayScore: m.awayScore };
      }
    }
  } catch {
    // база недоступна — не мешаем импорту
  }
  return null;
}

export async function POST(req: Request) {
  let body: { url?: string; items?: TextItem[]; lines?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  if (body.url) {
    const url = body.url.trim();
    if (!/^https?:\/\//.test(url)) {
      return NextResponse.json({ error: "Ссылка должна начинаться с http:// или https://" }, { status: 400 });
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const resp = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "ru,en;q=0.8",
        },
      });
      clearTimeout(timer);
      if (!resp.ok) {
        return NextResponse.json({ error: `Сайт вернул ошибку ${resp.status}. Проверьте ссылку.` }, { status: 422 });
      }
      const html = await resp.text();
      if (!/СТАТИСТИКА ИГРОКОВ|Статистический отчет/i.test(html)) {
        return NextResponse.json(
          { error: "Похоже, по ссылке нет статистического отчёта. Нужна страница вида ?print=pdfstat." },
          { status: 422 },
        );
      }
      const parsed = await withActiveStage(parseProtocolHtml(html, url));
      const duplicateOf = await findDuplicate(parsed, url);
      return NextResponse.json({ parsed, duplicateOf });
    } catch (e) {
      const msg = e instanceof Error && e.name === "AbortError" ? "Превышено время ожидания (20 сек)." : "Не удалось загрузить страницу.";
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  if (Array.isArray(body.items) && body.items.length) {
    const parsed = await withActiveStage(parseProtocolText(body.items));
    const duplicateOf = await findDuplicate(parsed);
    return NextResponse.json({ parsed, duplicateOf });
  }

  if (Array.isArray(body.lines) && body.lines.length) {
    const parsed = await withActiveStage(parseProtocolText(body.lines));
    const duplicateOf = await findDuplicate(parsed);
    return NextResponse.json({ parsed, duplicateOf });
  }

  return NextResponse.json({ error: "Нужна ссылка, текст или PDF" }, { status: 400 });
}
