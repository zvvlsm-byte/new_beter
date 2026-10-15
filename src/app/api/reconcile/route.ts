import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { goalieGames, matches, penalties } from "@/db/schema";
import {
  buildReconcileDiff,
  looksLikeOfficialProtocol,
  parseOfficialProtocolHtml,
  type CurrentGoalie,
} from "@/lib/official";

/**
 * Сверка сохранённого матча с официальным протоколом (например,
 * https://hockey.by/new-admin/games/<id>/?print=protocol).
 * Возвращает список расхождений — каждое пользователь принимает или отклоняет.
 */
export async function POST(req: Request) {
  let body: { matchId?: number; url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const matchId = Number(body.matchId);
  const url = (body.url ?? "").trim();
  if (!Number.isFinite(matchId)) {
    return NextResponse.json({ error: "Не указан матч" }, { status: 400 });
  }
  if (!/^https?:\/\//.test(url)) {
    return NextResponse.json(
      { error: "Ссылка должна начинаться с http:// или https://" },
      { status: 400 },
    );
  }

  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) return NextResponse.json({ error: "Матч не найден" }, { status: 404 });

  // ---- загружаем официальный протокол ----
  let html: string;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ru,en;q=0.8",
      },
    });
    clearTimeout(timer);
    if (!resp.ok) {
      return NextResponse.json(
        { error: `Сайт вернул ошибку ${resp.status}. Проверьте ссылку.` },
        { status: 422 },
      );
    }
    html = await resp.text();
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "AbortError"
        ? "Превышено время ожидания (20 сек)."
        : "Не удалось загрузить страницу.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (!looksLikeOfficialProtocol(html)) {
    return NextResponse.json(
      {
        error:
          "Похоже, по ссылке нет официального протокола. Нужна страница вида /games/<id>/?print=protocol с таблицами удалений и вратарей.",
      },
      { status: 422 },
    );
  }

  const official = parseOfficialProtocolHtml(html);
  if (!official.penalties.length && !official.goalies.length) {
    return NextResponse.json(
      { error: "Не удалось разобрать официальный протокол: таблицы удалений и вратарей пусты." },
      { status: 422 },
    );
  }

  // ---- текущие данные матча ----
  const [penaltyList, goalieList] = await Promise.all([
    db.select().from(penalties).where(eq(penalties.matchId, matchId)).orderBy(asc(penalties.id)),
    db.select().from(goalieGames).where(eq(goalieGames.matchId, matchId)).orderBy(asc(goalieGames.id)),
  ]);

  const goalies: CurrentGoalie[] = goalieList.map((g, index) => ({
    index,
    side: g.side,
    jersey: g.jersey,
    name: g.name,
    toiSeconds: g.toiSeconds,
    saves: g.saves,
    goalsAgainst: g.goalsAgainst,
  }));

  const { items, matched } = buildReconcileDiff(official, {
    penalties: penaltyList.map((x) => ({
      side: x.side,
      period: x.period,
      time: x.time ?? "",
      minutes: x.minutes,
      player: x.player ?? "",
      infraction: x.infraction ?? "",
      coincidental: x.coincidental,
      penaltyShot: x.penaltyShot,
    })),
    goalies,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  });

  // предупреждение, если команды в протоколе не совпадают с матчем
  const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е");
  let teamWarning: string | null = null;
  if (
    official.homeTeam &&
    official.awayTeam &&
    (norm(official.homeTeam) !== norm(match.homeTeam) || norm(official.awayTeam) !== norm(match.awayTeam))
  ) {
    teamWarning = `В официальном протоколе команды «${official.homeTeam}» и «${official.awayTeam}» — они не совпадают с матчем «${match.homeTeam}» — «${match.awayTeam}». Проверьте ссылку.`;
  }

  return NextResponse.json({
    official: {
      homeTeam: official.homeTeam,
      awayTeam: official.awayTeam,
      penaltyCount: official.penalties.length,
      goalieCount: official.goalies.length,
    },
    teamWarning,
    matched,
    items,
  });
}
