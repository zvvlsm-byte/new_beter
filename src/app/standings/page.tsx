import Link from "next/link";
import { db } from "@/db";
import { goalieGames, goals, matches, penalties, skaterGames, specialTeamOverrides } from "@/db/schema";
import { computeStandings, type StandingsRow } from "@/lib/compute";
import { computeTeamCorsi } from "@/lib/corsi";
import { fmtPct } from "@/lib/clean";
import { getActiveStage, idsOfStage, relatedOfStage } from "@/lib/seasonMode";
import type { Goal, GoalieGame, Match, Penalty, SkaterGame } from "@/db/schema";
import { EditableSpecialTeamsTable, type EditableSpecialRow, type SpecVals } from "./EditableSpecialTeamsTable";
import { ShotsTable } from "./ShotsTable";
import { SpecialTeamsTable } from "./SpecialTeamsTable";
import { StandingsTable } from "./StandingsTable";

export const dynamic = "force-dynamic";

function standingsBundle(
  ms: Match[],
  gs: Goal[],
  ps: Penalty[],
  sk: SkaterGame[],
  gk: GoalieGame[],
) {
  const rows = computeStandings(ms, gs, ps, sk, gk);
  const corsi = computeTeamCorsi(ms, sk, gk);
  const rowsCorsi = rows.map((r) => {
    const c = corsi.get(r.team);
    return {
      ...r,
      corsiFor: c?.cf ?? 0,
      corsiAgainst: c?.ca ?? 0,
      corsiDiff: c?.diff ?? 0,
      corsiPct: c?.pct ?? null,
    };
  });
  return { rows, rowsCorsi };
}

function sliceStage(
  ids: Set<number>,
  allMatches: Match[],
  allGoals: Goal[],
  allPenalties: Penalty[],
  allSkaters: SkaterGame[],
  allGoalies: GoalieGame[],
) {
  const ms = allMatches.filter((m) => ids.has(m.id));
  return standingsBundle(
    ms,
    relatedOfStage(allGoals, ids),
    relatedOfStage(allPenalties, ids),
    relatedOfStage(allSkaters, ids),
    relatedOfStage(allGoalies, ids),
  );
}

export default async function StandingsPage() {
  const [allMatches, allGoals, allPenalties, allSkaters, allGoalies, overrides, activeStage] = await Promise.all([
    db.select().from(matches),
    db.select().from(goals),
    db.select().from(penalties),
    db.select().from(skaterGames),
    db.select().from(goalieGames),
    db.select().from(specialTeamOverrides),
    getActiveStage(),
  ]);
  const regularIds = idsOfStage(allMatches, "regular");
  const playoffIds = new Set([...idsOfStage(allMatches, "playoff"), ...idsOfStage(allMatches, "playin")]);
  const showPlayoff = activeStage === "playoff" || activeStage === "playin" || playoffIds.size > 0;
  const main = showPlayoff
    ? sliceStage(regularIds, allMatches, allGoals, allPenalties, allSkaters, allGoalies)
    : standingsBundle(allMatches, allGoals, allPenalties, allSkaters, allGoalies);
  const playoff = showPlayoff
    ? sliceStage(playoffIds, allMatches, allGoals, allPenalties, allSkaters, allGoalies)
    : { rows: [] as StandingsRow[], rowsCorsi: [] as ReturnType<typeof standingsBundle>["rowsCorsi"] };
  const rows = main.rows;
  const rowsCorsi = main.rowsCorsi;

  // таблица «Протокол»: рассчитанные значения + ручные корректировки
  const ovByTeam = new Map(overrides.map((o) => [o.team, o]));
  const editableRows: EditableSpecialRow[] = rows.map((r) => {
    const calc: SpecVals = {
      // попытки — по официальному сплиттеру (большие дробятся голом)
      ppAttempts: r.offPpAttempts,
      ppGoals: r.ppGoals,
      ppGoalsAgainst: r.gaPowerplay,
      ppTime: r.oppPim,
      pkAttempts: r.offPkAttempts,
      pkGoalsAgainst: r.gaShorthanded,
      pkGoals: r.shGoals,
      pkTime: r.pim,
    };
    const o = ovByTeam.get(r.team);
    const vals: SpecVals = o
      ? {
          ppAttempts: o.ppAttempts ?? calc.ppAttempts,
          ppGoals: o.ppGoals ?? calc.ppGoals,
          ppGoalsAgainst: o.ppGoalsAgainst ?? calc.ppGoalsAgainst,
          ppTime: o.ppTimeMinutes ?? calc.ppTime,
          pkAttempts: o.pkAttempts ?? calc.pkAttempts,
          pkGoalsAgainst: o.pkGoalsAgainst ?? calc.pkGoalsAgainst,
          pkGoals: o.pkGoals ?? calc.pkGoals,
          pkTime: o.pkTimeMinutes ?? calc.pkTime,
        }
      : { ...calc };
    return { team: r.team, gp: r.gp, calc, vals, overridden: !!o };
  });

  const withGames = rows.filter((r) => r.gp > 0);
  const bestPP = [...rows].filter((r) => r.ppPct !== null).sort((a, b) => (b.ppPct ?? 0) - (a.ppPct ?? 0))[0];
  const bestPK = [...rows].filter((r) => r.pkPct !== null).sort((a, b) => (b.pkPct ?? 0) - (a.pkPct ?? 0))[0];
  const mostHits = [...rows].sort((a, b) => b.hits - a.hits)[0];
  const bestShots = [...rows].sort((a, b) => b.shots - a.shots)[0];
  const bestAttack = [...withGames].sort((a, b) => b.gf - a.gf)[0];
  const bestDefense = [...withGames].sort((a, b) => a.ga - b.ga)[0];
  const mostBlocks = [...rows].sort((a, b) => b.blocks - a.blocks)[0];
  const bestShotPct = [...rows].filter((r) => r.shotPct !== null).sort((a, b) => (b.shotPct ?? 0) - (a.shotPct ?? 0))[0];
  const mostDisciplined = [...withGames].sort((a, b) => a.pimAll - b.pimAll)[0];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Турнирная таблица</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Считается автоматически по всем сохранённым матчам. Клик по заголовку столбца сортирует по убыванию,
          повторный клик — по возрастанию, третий — возвращает места по очкам. Наведите курсор на заголовок — будет подсказка с формулой.
        </p>
      </div>

      {!rows.length ? (
        <div className="card px-6 py-14 text-center">
          <p className="text-lg font-bold">Таблица пуста</p>
          <p className="mt-1 text-sm text-ink-soft">
            Добавьте хотя бы один матч через{" "}
            <Link href="/import" className="font-semibold text-accent hover:underline">импорт протокола</Link>.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <h2 className="text-sm font-extrabold tracking-wide uppercase">
              Общая таблица{showPlayoff ? " · регулярный чемпионат" : ""}
            </h2>
            <StandingsTable rows={rowsCorsi} />
          </div>
          {showPlayoff && (
            <div className="space-y-2">
              <h2 className="text-sm font-extrabold tracking-wide uppercase">Общая таблица · плей-офф</h2>
              {playoff.rowsCorsi.length ? (
                <StandingsTable rows={playoff.rowsCorsi} />
              ) : (
                <div className="card px-4 py-6 text-sm text-ink-soft">Матчей плей-офф пока нет — таблица появится после первого протокола.</div>
              )}
            </div>
          )}
          <div className="space-y-2">
            <h2 className="text-sm font-extrabold tracking-wide uppercase">
              Большинство и меньшинство{showPlayoff ? " · регулярный чемпионат" : ""}
            </h2>
            <SpecialTeamsTable rows={rows} />
          </div>
          {showPlayoff && playoff.rows.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-extrabold tracking-wide uppercase">Большинство и меньшинство · плей-офф</h2>
              <SpecialTeamsTable rows={playoff.rows} />
            </div>
          )}
          <div className="space-y-2">
            <h2 className="text-sm font-extrabold tracking-wide uppercase">
              Большинство и меньшинство (Протокол) <span className="font-semibold text-ink-soft normal-case">— Official Stats</span>
            </h2>
            <EditableSpecialTeamsTable rows={editableRows} />
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-extrabold tracking-wide uppercase">
              Броски и реализация (дом / гости){showPlayoff ? " · регулярный чемпионат" : ""}
            </h2>
            <ShotsTable rows={rows} />
          </div>
          {showPlayoff && playoff.rows.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-extrabold tracking-wide uppercase">Броски и реализация · плей-офф</h2>
              <ShotsTable rows={playoff.rows} />
            </div>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <h2 className="pt-2 text-sm font-extrabold tracking-wide uppercase">Лидеры сезона</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <LeaderCard label="Лучшая атака" team={bestAttack?.team} value={String(bestAttack?.gf ?? "—")} sub={`${bestAttack?.gp ?? 0} матч., разница ${((bestAttack?.gf ?? 0) - (bestAttack?.ga ?? 0)) >= 0 ? "+" : ""}${(bestAttack?.gf ?? 0) - (bestAttack?.ga ?? 0)}`} tone="accent" />
            <LeaderCard label="Лучшая оборона" team={bestDefense?.team} value={String(bestDefense?.ga ?? "—")} sub={`пропущено за ${bestDefense?.gp ?? 0} матч.`} tone="ice" />
            <LeaderCard label="Лучшее большинство" team={bestPP?.team} value={fmtPct(bestPP?.ppPct ?? null)} sub={`${bestPP?.ppGoals ?? 0} гол. в большинстве`} tone="ok" />
            <LeaderCard label="Лучшее меньшинство" team={bestPK?.team} value={fmtPct(bestPK?.pkPct ?? null)} sub={`пропущено ${bestPK?.gaShorthanded ?? 0} в меньшинстве`} tone="warn" />
            <LeaderCard label="Больше всех силовых" team={mostHits?.team} value={String(mostHits?.hits ?? 0)} sub={`блоков: ${mostHits?.blocks ?? 0}`} tone="accent" />
            <LeaderCard label="Больше всех блоков" team={mostBlocks?.team} value={String(mostBlocks?.blocks ?? 0)} sub={`силовых: ${mostBlocks?.hits ?? 0}`} tone="ice" />
            <LeaderCard label="Больше всех бросков" team={bestShots?.team} value={String(bestShots?.shots ?? 0)} sub={`реализация ${fmtPct(bestShots?.shotPct ?? null)}`} tone="ok" />
            <LeaderCard label="Лучшая реализация" team={bestShotPct?.team} value={fmtPct(bestShotPct?.shotPct ?? null)} sub={`${bestShotPct?.gf ?? 0} гол. / ${bestShotPct?.shots ?? 0} бр.`} tone="warn" />
            <LeaderCard label="Самая дисциплинированная" team={mostDisciplined?.team} value={`${mostDisciplined?.pimAll ?? "—"}′`} sub="меньше всех штрафных минут" tone="ice" />
          </div>

          <div className="card p-4 text-xs leading-relaxed text-ink-soft">
            <p className="mb-1 font-bold text-ink">Условные обозначения</p>
            <p>
              <b>Общая таблица:</b> И — игры · В/ВО/ВБул — победы (основное время / овертайм / буллиты) · П/ПО/ПБул — поражения ·
              О — очки (победа = 2, поражение в ОТ/по буллитам = 1, в основное время = 0) · %О = О ÷ (И×2) ·
              Г/ПШ — забито/пропущено · Ибз — игры, где команда не забросила ни одной шайбы · И0 — игры «на ноль» (соперник не забил) ·
              Штр. — ВСЕ штрафные минуты команды, включая обоюдные удаления · ШтрС — все штрафные минуты соперника ·
              %Б/%М — реализация большинства и игра в меньшинстве (подробнее в таблице ниже) ·
              Сил./Блок./Бр — силовые, блокированные, броски команды · СилС/БлокС — силовые и блоки соперников против этой команды ·
              РБ — реализация бросков (Г ÷ Бр) · ПВ — голы в пустые ворота ·
              CF (Корси за) = голы + броски в створ + мимо + заблокированные соперником (по протоколу: Б своей команды + БлБ соперника) ·
              CA (Корси против) — то же для соперника · Корси± = CF − CA · CF% = CF ÷ (CF + CA) × 100%. Корси по каждому матчу — в «Сводке матча».
            </p>
            <p className="mt-1">
              <b>Большинство и меньшинство:</b> Бол — полученные численные преимущества · Мен — игры в меньшинстве ·
              ШБ/ШМ — шайбы в большинстве/меньшинстве · ПШБ/ПШМ — пропущено в большинстве/меньшинстве ·
              %Б = ШБ ÷ Бол · %М = 100% − (ПШМ ÷ Мен) · ВПБ/ВПМ — время в большинстве/меньшинстве (мин) · ВПБ/И и ВПМ/И — среднее за игру.
              Попытки большинства/меньшинства считаются по индивидуальным штрафам: каждый малый (2′) и большой (5′) = 1 попытка ·
              двойной малый (4′ или 2+2) = 2 попытки · два игрока одной команды в одну секунду = 2 параллельные попытки (5х3) ·
              5+20 и 2+10 — только малая/большая часть · обоюдные и дисциплинарные 10′/20′/25′ не считаются ·
              ШБ (0′) большинства не даёт · в овертайме удаление даёт большинство 4х3 ·
              гол в большинстве аннулирует первый малый штраф (большие 5′ отбываются полностью) — учитывается во времени ВПБ/ВПМ.
              В Штр./ШтрС общей таблицы входят все минуты без исключений.
            </p>
            <p className="mt-1">
              <b>Броски:</b> БВ — броски в створ · ЗШ — заброшенные шайбы · %БВ = ЗШ ÷ БВ · индексы _Д и _В — дома и в гостях.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function LeaderCard({ label, team, value, sub, tone }: {
  label: string; team?: string; value: string; sub: string; tone: "accent" | "ice" | "ok" | "warn";
}) {
  const tones: Record<string, string> = {
    accent: "border-l-accent",
    ice: "border-l-ice",
    ok: "border-l-ok",
    warn: "border-l-warn",
  };
  return (
    <div className={`card border-l-4 ${tones[tone]} px-4 py-3`}>
      <div className="text-[11px] font-bold tracking-wide text-ink-soft uppercase">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-mono text-2xl font-bold tabular-nums">{value}</span>
        <span className="text-sm font-bold">{team ?? "—"}</span>
      </div>
      <div className="text-xs text-ink-soft">{sub}</div>
    </div>
  );
}
