import Link from "next/link";
import { db } from "@/db";
import { goals, matches, penalties } from "@/db/schema";
import { computePeriodStats } from "@/lib/compute";
import { PeriodsView } from "./PeriodsView";

export const dynamic = "force-dynamic";

export default async function PeriodsPage() {
  const [allMatches, allPenalties, allGoals] = await Promise.all([
    db.select().from(matches),
    db.select().from(penalties),
    db.select().from(goals),
  ]);
  const rows = computePeriodStats(allMatches, allPenalties, allGoals);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Статистика по периодам</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Всё, что есть в протоколах, в разрезе периодов: заброшенные и пропущенные шайбы, броски в створ
          (свои и от соперника), удаления и штрафные минуты.
        </p>
      </div>

      {!rows.length ? (
        <div className="card px-6 py-14 text-center">
          <p className="text-lg font-bold">Пока нет данных</p>
          <p className="mt-1 text-sm text-ink-soft">
            Импортируйте протоколы — <Link href="/import" className="font-semibold text-accent hover:underline">начать</Link>
          </p>
        </div>
      ) : (
        <PeriodsView rows={rows} />
      )}
    </div>
  );
}
