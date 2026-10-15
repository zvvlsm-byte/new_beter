"use client";

import { useEffect, useMemo, useState } from "react";
import type { PlayerPenaltyRow, TeamPenaltyTableRow } from "@/lib/compute";
import { fmtDateRu, fmtNum } from "@/lib/clean";

export type PenaltyListRow = {
  id: number;
  team: string;
  player: string | null;
  minutes: number;
  period: number;
  time: string | null;
  infraction: string | null;
  matchDate: string | null;
  matchLabel: string | null;
  matchId: number;
  coincidental: boolean;
  penaltyShot: boolean;
};

type Sort = { key: string; dir: 1 | -1 } | null;

type LeaderItem = { name: string; value: string; sub: string };
type LeaderModalData = {
  title: string;
  subtitle?: string;
  sections: { title: string; items: LeaderItem[] }[];
  onFilter?: () => void;
};

const NO_INFRACTION = "Без указания причины";

const MEDAL = ["bg-[#d4a017] text-white", "bg-[#9aa3a8] text-white", "bg-[#b26d3c] text-white"];

function LeaderModal({ data, onClose }: { data: LeaderModalData; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card mt-16 w-full max-w-xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold tracking-tight">{data.title}</h3>
            {data.subtitle && <p className="text-xs text-ink-soft">{data.subtitle}</p>}
          </div>
          <button className="btn px-3" onClick={onClose}>✕</button>
        </div>
        <div className={`grid gap-4 ${data.sections.length > 1 ? "sm:grid-cols-2" : ""}`}>
          {data.sections.map((s) => (
            <div key={s.title}>
              <h4 className="mb-1.5 text-[11px] font-bold tracking-wide text-ink-soft uppercase">{s.title}</h4>
              {s.items.length === 0 && <p className="text-sm text-ink-soft">—</p>}
              <ol className="space-y-1">
                {s.items.map((it, i) => (
                  <li key={`${it.name}-${i}`} className="flex items-center gap-2 rounded-md border border-line bg-white px-2.5 py-1.5">
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${MEDAL[i] ?? "bg-paper text-ink-soft"}`}>{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{it.name}</span>
                      {it.sub && <span className="block truncate text-[11px] text-ink-soft">{it.sub}</span>}
                    </span>
                    <span className="font-mono text-lg font-bold tabular-nums">{it.value}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        {data.onFilter && (
          <button className="btn mt-4 w-full" onClick={data.onFilter}>
            Показать все такие удаления в списке ↓
          </button>
        )}
      </div>
    </div>
  );
}

function toggle(sort: Sort, key: string): Sort {
  if (sort?.key === key) return sort.dir === -1 ? { key, dir: 1 } : null;
  return { key, dir: -1 };
}

function numOrInf(v: unknown): number {
  return typeof v === "number" ? v : -Infinity;
}

const TEAM_COLS: { key: string; label: string; title: string }[] = [
  { key: "team", label: "Команда", title: "Команда (клик — по алфавиту)" },
  { key: "gp", label: "И", title: "Игры" },
  { key: "b2", label: "Штр_2", title: "Количество 2-минутных удалений" },
  { key: "b5", label: "Штр_5", title: "Количество 5-минутных удалений" },
  { key: "b10", label: "Штр_10", title: "Количество 10-минутных дисциплинарных" },
  { key: "b20", label: "Штр_20", title: "Количество 20-минутных и больше" },
  { key: "b25", label: "Штр_25", title: "Количество 25-минутных" },
  { key: "penaltyShots", label: "ШБр", title: "Штрафные броски (назначенные против игроков команды)" },
  { key: "teamPim", label: "ШтрК", title: "Штрафное время команды: командные (скамеечные) штрафы, минуты" },
  { key: "goaliePim", label: "ШтрВ", title: "Штрафное время вратарей, минуты" },
  { key: "homePim", label: "Штр_Д", title: "Штрафное время в домашних матчах, минуты" },
  { key: "awayPim", label: "Штр_В", title: "Штрафное время в гостевых матчах, минуты" },
  { key: "pim", label: "Штр", title: "Всего штрафных минут" },
  { key: "pimPerGame", label: "Штр/И", title: "Среднее штрафных минут за игру" },
  { key: "oppPim", label: "ШтрС", title: "Штрафное время соперников в матчах с этой командой, минуты" },
  { key: "oppPimPerGame", label: "ШтрС/И", title: "Среднее штрафное время соперника за игру" },
];

const PLAYER_COLS: { key: string; label: string; title?: string }[] = [
  { key: "player", label: "Игрок" },
  { key: "teams", label: "Команда" },
  { key: "count", label: "Удал.", title: "Количество удалений" },
  { key: "minutes", label: "Мин", title: "Штрафные минуты" },
  { key: "b2", label: "2′", title: "2-минутные" },
  { key: "b4", label: "4′", title: "4-минутные" },
  { key: "b5", label: "5′", title: "5-минутные" },
  { key: "b10", label: "10′", title: "10-минутные" },
  { key: "b20", label: "20′+", title: "20-минутные и больше" },
  { key: "bOther", label: "Прочие", title: "Нестандартная длительность" },
];

export function PenaltiesView({
  teamTable,
  byPlayer,
  list,
}: {
  teamTable: TeamPenaltyTableRow[];
  byPlayer: PlayerPenaltyRow[];
  list: PenaltyListRow[];
}) {
  const [team, setTeam] = useState("all");
  const [minutes, setMinutes] = useState("all");
  const [infraction, setInfraction] = useState("all");
  const [teamSort, setTeamSort] = useState<Sort>(null);
  const [playerSort, setPlayerSort] = useState<Sort>(null);
  const [modal, setModal] = useState<LeaderModalData | null>(null);

  const teams = useMemo(() => [...new Set(list.map((p) => p.team))].sort((a, b) => a.localeCompare(b, "ru")), [list]);

  // типы штрафов (нарушения) — по частоте
  const infractions = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of list) {
      const k = p.infraction?.trim() || NO_INFRACTION;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"));
  }, [list]);

  const filteredList = useMemo(
    () =>
      list.filter(
        (p) =>
          (team === "all" || p.team === team) &&
          (minutes === "all" ||
            (minutes === "ps" ? p.penaltyShot : !p.penaltyShot && String(p.minutes) === minutes)) &&
          (infraction === "all" || (p.infraction?.trim() || NO_INFRACTION) === infraction),
      ),
    [list, team, minutes, infraction],
  );
  const filteredMinutes = filteredList.reduce((a, p) => a + p.minutes, 0);

  useEffect(() => {
    if (!modal) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && setModal(null);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [modal]);

  const sortedTeams = useMemo(() => {
    const ext = teamTable.map((r) => ({
      ...r,
      pimPerGame: r.gp ? r.pim / r.gp : 0,
      oppPimPerGame: r.gp ? r.oppPim / r.gp : 0,
    }));
    if (!teamSort) return ext;
    return [...ext].sort((a, b) => {
      if (teamSort.key === "team") return a.team.localeCompare(b.team, "ru") * teamSort.dir;
      const av = a[teamSort.key as keyof typeof a];
      const bv = b[teamSort.key as keyof typeof b];
      return (numOrInf(av) - numOrInf(bv)) * teamSort.dir || a.team.localeCompare(b.team, "ru");
    });
  }, [teamTable, teamSort]);

  const sortedPlayers = useMemo(() => {
    if (!playerSort) return byPlayer;
    return [...byPlayer].sort((a, b) => {
      if (playerSort.key === "player") return a.player.localeCompare(b.player, "ru") * playerSort.dir;
      if (playerSort.key === "teams") return a.teams.join().localeCompare(b.teams.join(), "ru") * playerSort.dir;
      const av = a[playerSort.key as keyof PlayerPenaltyRow];
      const bv = b[playerSort.key as keyof PlayerPenaltyRow];
      return (numOrInf(av) - numOrInf(bv)) * playerSort.dir || a.player.localeCompare(b.player, "ru");
    });
  }, [byPlayer, playerSort]);

  const arrow = (sort: Sort, key: string) => (sort?.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : "");

  // ---- инфографика: лидеры по видам штрафов ----
  const top = (get: (r: PlayerPenaltyRow) => number) => {
    let best: PlayerPenaltyRow | null = null;
    for (const r of byPlayer) {
      if (get(r) > 0 && (!best || get(r) > get(best))) best = r;
    }
    return best;
  };
  const topCount = top((r) => r.count);
  const topMinutes = top((r) => r.minutes);
  const top2 = top((r) => r.b2);
  const top5 = top((r) => r.b5);
  const top10 = top((r) => r.b10);
  const top20 = top((r) => r.b20);

  // топ-5 по показателю (для всплывающего окна при клике на карточку лидера)
  const top5Of = (get: (r: PlayerPenaltyRow) => number, fmt: (r: PlayerPenaltyRow) => string, sub: (r: PlayerPenaltyRow) => string): LeaderItem[] =>
    byPlayer
      .filter((r) => get(r) > 0)
      .sort((a, b) => get(b) - get(a) || b.minutes - a.minutes || a.player.localeCompare(b.player, "ru"))
      .slice(0, 5)
      .map((r) => ({ name: r.player, value: fmt(r), sub: sub(r) }));

  const cards: { label: string; value: string; name: string; sub: string; top: LeaderItem[] }[] = [
    ...(topCount ? [{ label: "Больше всех удалений", value: String(topCount.count), name: topCount.player, sub: `${topCount.teams.join(", ")} · ${topCount.minutes} мин`, top: top5Of((r) => r.count, (r) => String(r.count), (r) => `${r.teams.join(", ")} · ${r.minutes} мин`) }] : []),
    ...(topMinutes ? [{ label: "Больше всех минут штрафа", value: `${topMinutes.minutes}′`, name: topMinutes.player, sub: `${topMinutes.teams.join(", ")} · ${topMinutes.count} удал.`, top: top5Of((r) => r.minutes, (r) => `${r.minutes}′`, (r) => `${r.teams.join(", ")} · ${r.count} удал.`) }] : []),
    ...(top2 ? [{ label: "Лидер по 2-минутным", value: String(top2.b2), name: top2.player, sub: top2.teams.join(", "), top: top5Of((r) => r.b2, (r) => String(r.b2), (r) => r.teams.join(", ")) }] : []),
    ...(top5 ? [{ label: "Лидер по 5-минутным", value: String(top5.b5), name: top5.player, sub: top5.teams.join(", "), top: top5Of((r) => r.b5, (r) => String(r.b5), (r) => r.teams.join(", ")) }] : []),
    ...(top10 ? [{ label: "Лидер по 10-минутным", value: String(top10.b10), name: top10.player, sub: top10.teams.join(", "), top: top5Of((r) => r.b10, (r) => String(r.b10), (r) => r.teams.join(", ")) }] : []),
    ...(top20 ? [{ label: "Лидер по 20-минутным", value: String(top20.b20), name: top20.player, sub: top20.teams.join(", "), top: top5Of((r) => r.b20, (r) => String(r.b20), (r) => r.teams.join(", ")) }] : []),
  ];

  // ---- лидеры по каждому виду нарушения (включая командные штрафы и ШБ) ----
  const infractionCards = useMemo(() => {
    const byInfraction = new Map<
      string,
      {
        total: number;
        ps: number;
        byPlayer: Map<string, number>;
        byPlayerTeams: Map<string, Set<string>>; // команда(ы) игрока в рамках этого нарушения
        byTeam: Map<string, number>;
      }
    >();
    for (const p of list) {
      const inf = p.infraction?.trim();
      if (!inf) continue;
      let e = byInfraction.get(inf);
      if (!e) {
        e = { total: 0, ps: 0, byPlayer: new Map(), byPlayerTeams: new Map(), byTeam: new Map() };
        byInfraction.set(inf, e);
      }
      e.total += 1;
      if (p.penaltyShot) e.ps += 1;
      if (p.player) {
        e.byPlayer.set(p.player, (e.byPlayer.get(p.player) ?? 0) + 1);
        let ts = e.byPlayerTeams.get(p.player);
        if (!ts) {
          ts = new Set();
          e.byPlayerTeams.set(p.player, ts);
        }
        ts.add(p.team);
      }
      e.byTeam.set(p.team, (e.byTeam.get(p.team) ?? 0) + 1);
    }
    const sortedOf = (m: Map<string, number>): [string, number][] =>
      [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"));
    return [...byInfraction.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([infraction, e]) => {
        // порядок тот же, что и раньше: по числу удалений, затем по алфавиту
        const topPlayers = sortedOf(e.byPlayer).slice(0, 5).map(([name, count]) => ({
          name,
          count,
          team: [...(e.byPlayerTeams.get(name) ?? [])].sort((a, b) => a.localeCompare(b, "ru")).join(", "),
        }));
        return {
          infraction,
          total: e.total,
          ps: e.ps,
          player: topPlayers[0] ?? null,
          team: sortedOf(e.byTeam)[0] ?? null,
          topPlayers,
          topTeams: sortedOf(e.byTeam).slice(0, 5),
        };
      });
  }, [list]);

  return (
    <div className="space-y-6">
      {cards.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((c, i) => (
            <button
              type="button"
              key={`${c.label}-${i}`}
              onClick={() => setModal({ title: c.label, sections: [{ title: "Топ-5 игроков", items: c.top }] })}
              className="card group cursor-pointer border-l-4 border-l-accent px-4 py-3 text-left transition hover:-translate-y-px hover:shadow-md"
              title="Показать топ-5"
            >
              <div className="flex items-center justify-between text-[11px] font-bold tracking-wide text-ink-soft uppercase">
                <span>{c.label}</span>
                <span className="text-[10px] font-semibold text-accent opacity-60 group-hover:opacity-100">топ-5 →</span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold tabular-nums">{c.value}</span>
                <span className="text-sm font-bold">{c.name}</span>
              </div>
              <div className="text-xs text-ink-soft">{c.sub}</div>
            </button>
          ))}
        </div>
      )}

      {infractionCards.length > 0 && (
        <section className="space-y-3">
          <div className="border-b border-line pb-2">
            <h2 className="text-sm font-extrabold tracking-wide uppercase">Лидеры по видам нарушений</h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              По каждому нарушению — кто чаще всех его получает: игрок и команда. Командные штрафы (без игрока) тоже учитываются — у них лидер только команда.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {infractionCards.map((c) => (
              <button
                type="button"
                key={c.infraction}
                title="Показать топ-5"
                onClick={() =>
                  setModal({
                    title: c.infraction,
                    subtitle: `${c.total} удалений${c.ps > 0 ? ` · ШБ ${c.ps}` : ""}`,
                    sections: [
                      {
                        title: "Топ-5 игроков",
                        items: c.topPlayers.map((p) => ({
                          name: p.name,
                          value: String(p.count),
                          sub: p.team || "",
                        })),
                      },
                      { title: "Топ-5 команд", items: c.topTeams.map(([n, v]) => ({ name: n, value: String(v), sub: "" })) },
                    ],
                    onFilter: () => {
                      setInfraction(c.infraction);
                      setModal(null);
                      document.getElementById("all-penalties")?.scrollIntoView({ behavior: "smooth" });
                    },
                  })
                }
                className="card cursor-pointer border-l-4 border-l-warn px-4 py-3 text-left transition hover:-translate-y-px hover:shadow-md"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-xs font-bold tracking-wide whitespace-normal text-ink uppercase" title={c.infraction}>
                    {c.infraction}
                  </div>
                  <span className="font-mono text-xs font-bold whitespace-nowrap text-ink-soft tabular-nums">
                    {c.total}×{c.ps > 0 ? ` · ШБ ${c.ps}` : ""}
                  </span>
                </div>
                <div className="mt-1.5 text-sm">
                  <span className="text-xs text-ink-soft">Игрок: </span>
                  <span className="font-bold">{c.player ? `${c.player.name} (${c.player.count})` : "—"}</span>
                </div>
                {c.player && (
                  <div className="mt-0.5" title="Команда игрока в этом нарушении">
                    <span className="badge bg-ice-soft text-ice">{c.player.team || "команда не указана"}</span>
                  </div>
                )}
                <div className="text-sm">
                  <span className="text-xs text-ink-soft">Команда: </span>
                  <span className="font-bold">{c.team ? `${c.team[0]} (${c.team[1]})` : "—"}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="card overflow-x-auto">
        <div className="border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-extrabold tracking-wide uppercase">Штрафы по командам</h2>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="th text-left">№</th>
              {TEAM_COLS.map((c) => (
                <th
                  key={c.key}
                  title={c.title}
                  onClick={() => setTeamSort((s) => toggle(s, c.key))}
                  className={`th cursor-pointer transition select-none hover:text-ink ${c.key === "team" ? "text-left" : "text-right"} ${teamSort?.key === c.key ? "text-accent" : ""}`}
                >
                  {c.label}{arrow(teamSort, c.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedTeams.map((r, i) => (
              <tr key={r.team} className={i % 2 ? "bg-paper/50" : ""}>
                <td className="td font-mono text-xs text-ink-soft">{i + 1}</td>
                <td className="td font-bold whitespace-normal">{r.team}</td>
                <td className="td-num">{r.gp}</td>
                <td className="td-num">{r.b2 || "—"}</td>
                <td className="td-num">{r.b5 || "—"}</td>
                <td className="td-num">{r.b10 || "—"}</td>
                <td className="td-num">{r.b20 || "—"}</td>
                <td className="td-num">{r.b25 || "—"}</td>
                <td className="td-num">{r.penaltyShots || "—"}</td>
                <td className="td-num">{r.teamPim || "—"}</td>
                <td className="td-num">{r.goaliePim || "—"}</td>
                <td className="td-num">{r.homePim || "—"}</td>
                <td className="td-num">{r.awayPim || "—"}</td>
                <td className="td-num font-bold">{r.pim}</td>
                <td className="td-num">{fmtNum(r.pimPerGame)}</td>
                <td className="td-num">{r.oppPim}</td>
                <td className="td-num">{fmtNum(r.oppPimPerGame)}</td>
              </tr>
            ))}
            {!sortedTeams.length && (
              <tr><td colSpan={17} className="td py-8 text-center text-sm text-ink-soft">Пока нет данных</td></tr>
            )}
          </tbody>
        </table>
        <p className="px-4 py-3 text-xs text-ink-soft">
          Штр_2…Штр_25 — количество удалений по длительности · ШБр — назначенные штрафные броски ·
          ШтрК — командные (скамеечные) штрафы · ШтрВ — штрафы вратарей · Штр_Д/Штр_В — дома/в гостях ·
          Штр/И и ШтрС/И — средние за игру. Все столбцы сортируются кликом.
        </p>
      </section>

      <section className="card overflow-x-auto">
        <div className="border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-extrabold tracking-wide uppercase">Штрафы по игрокам</h2>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {PLAYER_COLS.map((c) => (
                <th
                  key={c.key}
                  title={c.title ?? (c.key === "player" ? "Игрок (клик — по алфавиту)" : undefined)}
                  onClick={() => setPlayerSort((s) => toggle(s, c.key))}
                  className={`th transition select-none ${c.key === "player" || c.key === "teams" ? "cursor-pointer text-left hover:text-ink" : "cursor-pointer text-right hover:text-ink"} ${playerSort?.key === c.key ? "text-accent" : ""}`}
                >
                  {c.label}{arrow(playerSort, c.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedPlayers.map((r, i) => (
              <tr key={r.player} className={i % 2 ? "bg-paper/50" : ""}>
                <td className="td font-bold">{r.player}</td>
                <td className="td text-xs text-ink-soft">{r.teams.join(", ")}</td>
                <td className="td-num">{r.count}</td>
                <td className="td-num font-bold">{r.minutes}</td>
                <td className="td-num">{r.b2 || "—"}</td>
                <td className="td-num">{r.b4 || "—"}</td>
                <td className="td-num">{r.b5 || "—"}</td>
                <td className="td-num">{r.b10 || "—"}</td>
                <td className="td-num">{r.b20 || "—"}</td>
                <td className="td-num">{r.bOther || "—"}</td>
              </tr>
            ))}
            {!sortedPlayers.length && (
              <tr><td colSpan={10} className="td py-8 text-center text-sm text-ink-soft">Пока нет данных</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {modal && <LeaderModal data={modal} onClose={() => setModal(null)} />}

      <section className="space-y-3" id="all-penalties">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-sm font-extrabold tracking-wide uppercase">Все удаления</h2>
          <select className="inp max-w-72" value={infraction} onChange={(e) => setInfraction(e.target.value)} title="Тип штрафа">
            <option value="all">Любой тип штрафа</option>
            {infractions.map(([inf, n]) => (
              <option key={inf} value={inf}>{inf} ({n})</option>
            ))}
          </select>
          <select className="inp max-w-52" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="all">Все команды</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="inp max-w-40" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
            <option value="all">Любые минуты</option>
            <option value="ps">ШБ (штрафной бросок)</option>
            {[2, 4, 5, 10, 20, 25].map((m) => <option key={m} value={String(m)}>{m} мин</option>)}
          </select>
          <span className="text-xs text-ink-soft">{filteredList.length} удалений · {filteredMinutes} мин</span>
          {(team !== "all" || minutes !== "all" || infraction !== "all") && (
            <button
              className="text-xs font-semibold text-accent hover:underline"
              onClick={() => {
                setTeam("all");
                setMinutes("all");
                setInfraction("all");
              }}
            >
              сбросить фильтры
            </button>
          )}
        </div>

        <div className="card overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Дата", "Матч", "Команда", "Пер", "Время", "Игрок", "Мин", "Причина"].map((h) => (
                  <th key={h} className="th text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredList.map((p, i) => (
                <tr key={p.id} className={i % 2 ? "bg-paper/50" : ""}>
                  <td className="td font-mono text-xs text-ink-soft">{p.matchDate ? fmtDateRu(p.matchDate) : "—"}</td>
                  <td className="td text-xs">{p.matchLabel ?? "—"}</td>
                  <td className="td text-xs font-semibold">{p.team}</td>
                  <td className="td-num">{p.period}</td>
                  <td className="td-num">{p.time ?? "—"}</td>
                  <td className={`td ${p.player ? "" : "font-semibold text-warn"}`}>
                    {p.player ?? "Командный штраф"}
                    {p.coincidental && (
                      <span className="badge ml-2 bg-ice-soft text-ice" title="Обоюдное удаление: у соперника штраф в то же время, составы равны">об.</span>
                    )}
                  </td>
                  <td className="td-num font-bold">
                    {p.penaltyShot ? (
                      <span className="badge bg-accent/15 text-accent" title="Штрафной бросок">ШБ</span>
                    ) : (
                      p.minutes
                    )}
                  </td>
                  <td className="td text-xs whitespace-normal">{p.infraction ?? "—"}</td>
                </tr>
              ))}
              {!filteredList.length && (
                <tr><td colSpan={8} className="td py-8 text-center text-sm text-ink-soft">Ничего не найдено</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-soft">
          Командные штрафы не всегда попадают в протокол — добавляйте их вручную при редактировании матча.
          ШБ — штрафной бросок (0 минут, в штрафное время не входит). Клик по заголовку столбца сортирует таблицу.
        </p>
      </section>
    </div>
  );
}
