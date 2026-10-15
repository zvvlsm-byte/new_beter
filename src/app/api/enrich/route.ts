import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { matches } from "@/db/schema";
import { extractAttendance } from "@/lib/parse";

export const maxDuration = 120;

/** Догружает недостающее количество зрителей по сохранённым ссылкам на протоколы. */
export async function POST() {
  const missing = await db
    .select()
    .from(matches)
    .where(and(isNull(matches.attendance)));

  const targets = missing.filter((m) => m.sourceUrl && /^https?:\/\//.test(m.sourceUrl));
  let updated = 0;
  let failed = 0;

  for (const m of targets) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
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
      const att = extractAttendance(html);
      if (att !== null) {
        await db.update(matches).set({ attendance: att }).where(eq(matches.id, m.id));
        updated += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return NextResponse.json({
    updated,
    failed,
    skipped: missing.length - targets.length,
    checked: targets.length,
  });
}
