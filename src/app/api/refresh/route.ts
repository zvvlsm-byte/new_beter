import { and, eq, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { goalieGames, matches, penalties, skaterGames } from "@/db/schema";
import { cleanName, parseMMSS } from "@/lib/clean";
import { parseProtocolHtml } from "@/lib/parse";

export const maxDuration = 300;

/**
 * Пересчитывает сохранённые матчи из их протоколов по ссылкам: заново разбирает
 * составы (включая сдвиг колонок у матчей с овертаймом), вратарей, удаления
 * (ШБ и обоюдные), зрителей, счёт и голы по периодам.
 * Список голов не трогается; добавленные вручную командные штрафы сохраняются.
 */
export async function POST() {
  const all = await db.select().from(matches);
  const targets = all.filter((m) => m.sourceUrl && /^https?:\/\//.test(m.sourceUrl));
  let updated = 0;
  let failed = 0;

  for (const m of targets) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const resp = await fetch(m.sourceUrl as string, {
        signal: ctrl.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "ru,en;q=0.8",
        },
      });
      clearTimeout(timer);
      if (!resp.ok) {
        failed += 1;
        continue;
      }
      const html = await resp.text();
      if (!/СТАТИСТИКА ИГРОКОВ|Статистический отчет/i.test(html)) {
        failed += 1;
        continue;
      }
      const parsed = parseProtocolHtml(html, m.sourceUrl as string);

      await db.transaction(async (tx) => {
        await tx
          .update(matches)
          .set({
            attendance: parsed.attendance,
            periods: parsed.periods,
            homeScore: parsed.homeScore,
            awayScore: parsed.awayScore,
            winType: parsed.winType,
          })
          .where(eq(matches.id, m.id));

        // пересчитываем полевых игроков и вратари из протокола
        await tx.delete(skaterGames).where(eq(skaterGames.matchId, m.id));
        await tx.delete(goalieGames).where(eq(goalieGames.matchId, m.id));

        const sides = ["home", "away"] as const;
        const skRows = sides.flatMap((side) =>
          parsed.skaters[side].map((s) => ({
            matchId: m.id,
            side,
            name: cleanName(s.name),
            rawName: s.rawName,
            jersey: s.jersey,
            position: s.position || null,
            goals: s.goals,
            assists: s.assists,
            plusMinus: s.plusMinus,
            shots: s.shots,
            shotsOnGoal: s.shotsOnGoal,
            hits: s.hits,
            blocks: s.blocks,
            pim: s.pim,
            toiSeconds: parseMMSS(s.toi),
            faceoffs: s.faceoffs,
            faceoffWins: s.faceoffWins,
            periodToi: s.periodToi.length ? s.periodToi : null,
          })),
        );
        if (skRows.length) await tx.insert(skaterGames).values(skRows);

        const gRows = sides.flatMap((side) =>
          parsed.goalies[side].map((g) => ({
            matchId: m.id,
            side,
            name: cleanName(g.name),
            rawName: g.rawName,
            jersey: g.jersey,
            toiSeconds: parseMMSS(g.toi),
            saves: g.saves,
            goalsAgainst: g.goalsAgainst,
            result: g.result || null,
            goals: g.goals,
            assists: g.assists,
            shots: g.shots,
            shotsOnGoal: g.shotsOnGoal,
            hits: g.hits,
            blocks: g.blocks,
            pim: g.pim,
            periodToi: g.periodToi.length ? g.periodToi : null,
          })),
        );
        if (gRows.length) await tx.insert(goalieGames).values(gRows);

        // заменяем только индивидуальные удаления; командные (добавленные вручную) сохраняем
        await tx
          .delete(penalties)
          .where(and(eq(penalties.matchId, m.id), isNotNull(penalties.player)));

        const penRows = parsed.penalties
          .filter((p) => p.player && p.player.trim())
          .map((p) => ({
            matchId: m.id,
            side: p.side,
            period: p.period || 1,
            time: p.time || null,
            minutes: p.minutes,
            player: cleanName(p.player),
            infraction: p.infraction || null,
            coincidental: !!p.coincidental,
            penaltyShot: !!p.penaltyShot,
          }));
        if (penRows.length) await tx.insert(penalties).values(penRows);
      });
      updated += 1;
    } catch {
      failed += 1;
    }
  }

  return NextResponse.json({ updated, failed, checked: targets.length });
}
