"use client";

import { useMemo, useState } from "react";
import { GoalieCard } from "@/components/GoalieCard";
import { PlayerCard } from "@/components/PlayerCard";
import {
  GOALIE_COLS,
  SKATER_COLS,
  STAGES,
  aggregateGoalies,
  aggregateSkaters,
  fmtStat,
  seasonLabel,
  seasonStartYear,
  stageLabel,
  stageShort,
  type SeasonImportMeta,
  type SeasonsPayload,
  type Stage,
  type Stats,
} from "@/lib/seasonStats";

type Preview =
  | {
      ok: true; url: string; season: string; league: string | null; divisionName: string | null; team: string;
      stage: Stage; skaters: number; goalies: number; skaterColumns: string[]; goalieColumns: string[];
      saved?: boolean; saving?: boolean; error?: string;
    }
  | { ok: false; url: string; error: string };

type AggRow = {
  key: string;
  name: string;
  teams: string[];
  seasons: string[];
  stages: string[];
  position: string | null;
  stats: Stats;
};

export function SeasonsView({ initial }: { initial: SeasonsPayload }) {
  const [data, setData] = useState<SeasonsPayload>(initial);
  const [tab, setTab] = useState<"skaters" | "goalies">("skaters");
  const [season, setSeason] = useState("all");
  const [stage, setStage] = useState<"all" | Stage>("all");
  const [team, setTeam] = useState("all");
  const [q, setQ] = useState("");
  const [bySeason, setBySeason] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "points", dir: -1 });
  const [card, setCard] = useState<{ name: string; kind: "skater" | "goalie" } | null>(null);
  const [showImports, setShowImports] = useState(initial.imports.length === 0);

  const reload = async () => {
    const r = await fetch("/api/seasons", { cache: "no-store" });
    if (r.ok) setData(await r.json());
  };

  const impById = useMemo(() => new Map(data.imports.map((i) => [i.id, i])), [data.imports]);
  const seasons = useMemo(
    () => [...new Set(data.imports.map((i) => i.season))].sort((a, b) => seasonStartYear(b) - seasonStartYear(a)),
    [data.imports],
  );
  const teams = useMemo(
    () => [...new Set(data.imports.map((i) => i.team))].sort((a, b) => a.localeCompare(b, "ru")),
    [data.imports],
  );

  const cols = tab === "skaters" ? SKATER_COLS : GOALIE_COLS;
  const agg = tab === "skaters" ? aggregateSkaters : aggregateGoalies;

  const { rows, usedCols, total } = useMemo(() => {
    const src = tab === "skaters" ? data.skaters : data.goalies;
    const qq = q.trim().toLowerCase();
    const groups = new Map<string, { row: AggRow; list: Stats[] }>();
    for (const r of src) {
      const imp = impById.get(r.importId);
      if (!imp) continue;
      if (season !== "all" && imp.season !== season) continue;
      if (stage !== "all" && imp.stage !== stage) continue;
      if (team !== "all" && imp.team !== team) continue;
      if (qq && !r.name.toLowerCase().includes(qq)) continue;
      const key = bySeason ? `${r.nameKey}|${imp.season}` : r.nameKey;
      let g = groups.get(key);
      if (!g) {
        g = {
          row: { key, name: r.name, teams: [], seasons: [], stages: [], position: r.position ?? null, stats: {} },
          list: [],
        };
        groups.set(key, g);
      }
      if (!g.row.teams.includes(imp.team)) g.row.teams.push(imp.team);
      if (!g.row.seasons.includes(imp.season)) g.row.seasons.push(imp.season);
      if (!g.row.stages.includes(imp.stage)) g.row.stages.push(imp.stage);
      if (!g.row.position && r.position) g.row.position = r.position;
      g.list.push(r.stats);
    }
    const out: AggRow[] = [];
    const all: Stats[] = [];
    for (const g of groups.values()) {
      g.row.stats = agg(g.list);
      g.row.seasons.sort((a, b) => seasonStartYear(a) - seasonStartYear(b));
      out.push(g.row);
      all.push(...g.list);
    }
    const used = cols.filter((c) => out.some((r) => r.stats[c.key] != null));
    return { rows: out, usedCols: used, total: out.length ? agg(all) : null };
  }, [tab, data, impById, season, stage, team, q, bySeason, cols, agg]);

  const sortKey = usedCols.some((c) => c.key === sort.key) || sort.key === "name" || sort.key === "season"
    ? sort.key
    : tab === "skaters" ? "points" : "gp";

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name, "ru") * sort.dir;
      if (sortKey === "season") {
        return (seasonStartYear(a.seasons[0] ?? "") - seasonStartYear(b.seasons[0] ?? "")) * sort.dir || a.name.localeCompare(b.name, "ru");
      }
      const av = a.stats[sortKey];
      const bv = b.stats[sortKey];
      const an = typeof av === "number" ? av : -Infinity;
      const bn = typeof bv === "number" ? bv : -Infinity;
      return (an - bn) * sort.dir || a.name.localeCompare(b.name, "ru");
    });
  }, [rows, sortKey, sort.dir]);

  const toggleSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === -1 ? 1 : -1 } : { key, dir: key === "name" ? 1 : -1 }));
  const arrow = (key: string) => (sortKey === key ? (sort.dir === -1 ? " ↓" : " ↑") : "");

  return (
    <div className="space-y-5">
      <ImportPanel onSaved={reload} />

      <section className="card">
        <button
          className="flex w-full items-center justify-between px-4 py-2.5 text-left"
          onClick={() => setShowImports((v) => !v)}
        >
          <h2 className="text-sm font-extrabold tracking-wide uppercase">
            Загруженные данные · {data.imports.length} {data.imports.length === 1 ? "загрузка" : "загрузок"}
          </h2>
          <span className="text-xs text-ink-soft">{showImports ? "свернуть ▲" : "показать ▼"}</span>
        </button>
        {showImports && <ImportsList imports={data.imports} onChanged={reload} />}
      </section>

      {data.imports.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-line">
              {(["skaters", "goalies"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setTab(t);
                    setSort({ key: t === "skaters" ? "points" : "gp", dir: -1 });
                  }}
                  className={`px-3 py-1.5 text-sm font-semibold ${tab === t ? "bg-ink text-white" : "bg-white text-ink-soft hover:text-ink"}`}
                >
                  {t === "skaters" ? "Полевые" : "Вратари"}
                </button>
              ))}
            </div>
            <select className="inp max-w-44" value={season} onChange={(e) => setSeason(e.target.value)}>
              <option value="all">За все время</option>
              {seasons.map((s) => <option key={s} value={s}>Сезон {seasonLabel(s)}</option>)}
            </select>
            <select className="inp max-w-52" value={stage} onChange={(e) => setStage(e.target.value as "all" | Stage)}>
              <option value="all">Все стадии (сумма)</option>
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select className="inp max-w-48" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="all">Все команды</option>
              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="inp max-w-56" placeholder="Поиск игрока…" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="flex items-center gap-1.5 text-sm text-ink-soft">
              <input type="checkbox" checked={bySeason} onChange={(e) => setBySeason(e.target.checked)} />
              разбивка по сезонам
            </label>
            <span className="text-xs text-ink-soft">{sorted.length} строк · клик по заголовку сортирует, по игроку — карточка</span>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="th text-left">№</th>
                  <th
                    className={`th cursor-pointer text-left select-none hover:text-ink ${sortKey === "name" ? "text-accent" : ""}`}
                    onClick={() => toggleSort("name")}
                  >
                    {tab === "skaters" ? "Игрок" : "Вратарь"}{arrow("name")}
                  </th>
                  <th className="th text-left">Команда</th>
                  <th
                    className={`th cursor-pointer text-left select-none hover:text-ink ${sortKey === "season" ? "text-accent" : ""}`}
                    onClick={() => toggleSort("season")}
                  >
                    {bySeason ? "Сезон" : "Сезоны"}{arrow("season")}
                  </th>
                  {usedCols.map((c) => (
                    <th
                      key={c.key}
                      title={c.title}
                      onClick={() => toggleSort(c.key)}
                      className={`th cursor-pointer text-right select-none hover:text-ink ${sortKey === c.key ? "text-accent" : ""}`}
                    >
                      {c.label}{arrow(c.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => (
                  <tr key={r.key} className={i % 2 ? "bg-paper/50" : ""}>
                    <td className="td font-mono text-xs text-ink-soft">{i + 1}</td>
                    <td className="td">
                      <button
                        className="cursor-pointer font-bold text-ink hover:text-accent hover:underline"
                        onClick={() => setCard({ name: r.name, kind: tab === "skaters" ? "skater" : "goalie" })}
                      >
                        {r.name}
                      </button>
                      {r.position && <span className="ml-1.5 text-[10px] text-ink-soft">{r.position.slice(0, 3).toLowerCase()}</span>}
                    </td>
                    <td className="td text-xs text-ink-soft">{r.teams.join(", ")}</td>
                    <td className="td text-xs text-ink-soft">
                      {r.seasons.length > 2
                        ? `${seasonLabel(r.seasons[0])} – ${seasonLabel(r.seasons[r.seasons.length - 1])} (${r.seasons.length})`
                        : r.seasons.map(seasonLabel).join(", ")}
                      {stage === "all" && r.stages.length > 0 && (
                        <span className="ml-1 text-[10px]">· {r.stages.map(stageShort).join("+")}</span>
                      )}
                    </td>
                    {usedCols.map((c) => (
                      <td key={c.key} className={`td-num ${c.key === sortKey ? "bg-ice-soft/50 font-bold" : ""}`}>
                        {fmtStat(r.stats[c.key], c.kind, c.key)}
                      </td>
                    ))}
                  </tr>
                ))}
                {!sorted.length && (
                  <tr><td colSpan={usedCols.length + 4} className="td py-8 text-center text-sm text-ink-soft">Ничего не найдено</td></tr>
                )}
              </tbody>
              {total && (
                <tfoot>
                  <tr className="bg-ice-soft/40 font-bold">
                    <td className="td" colSpan={4}>Итого по выборке</td>
                    {usedCols.map((c) => (
                      <td key={c.key} className="td-num">{fmtStat(total[c.key], c.kind, c.key)}</td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="text-xs text-ink-soft">
            «—» — показатель в этом сезоне на hockey.by не вёлся; при суммировании он не учитывается, а проценты и средние
            считаются только по сезонам, где данные есть. Скрыты столбцы, по которым нет данных в выборке.
          </p>
        </section>
      )}

      {card?.kind === "skater" && <PlayerCard name={card.name} onClose={() => setCard(null)} />}
      {card?.kind === "goalie" && <GoalieCard name={card.name} onClose={() => setCard(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Загрузка по ссылкам
// ---------------------------------------------------------------------------

function ImportPanel({ onSaved }: { onSaved: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const parse = async () => {
    const urls = text.split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));
    if (!urls.length) {
      setMsg("Вставьте хотя бы одну ссылку вида https://hockey.by/statistic/competition/?division=493&command=4286");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/seasons/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const d = (await r.json()) as { results: Preview[] };
      setPreviews(d.results);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const update = (i: number, patch: Partial<Extract<Preview, { ok: true }>>) =>
    setPreviews((ps) => ps.map((p, j) => (j === i && p.ok ? { ...p, ...patch } : p)));

  const saveOne = async (i: number) => {
    const p = previews[i];
    if (!p || !p.ok) return false;
    update(i, { saving: true, error: undefined });
    const r = await fetch("/api/seasons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: p.url, stage: p.stage, season: p.season }),
    });
    const d = await r.json();
    update(i, { saving: false, saved: r.ok, error: r.ok ? undefined : d.error });
    return r.ok;
  };

  const saveAll = async () => {
    setBusy(true);
    let n = 0;
    for (let i = 0; i < previews.length; i++) {
      const p = previews[i];
      if (p.ok && !p.saved && (await saveOne(i))) n += 1;
    }
    await onSaved();
    setBusy(false);
    setMsg(`Сохранено: ${n}`);
  };

  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="text-sm font-extrabold tracking-wide uppercase">Загрузить с hockey.by</h2>
        <p className="text-xs text-ink-soft">
          На hockey.by: Статистика → Команда → выберите сезон, турнир, дивизион (этап / плей-офф) и команду, скопируйте
          ссылку. Можно вставить сразу несколько ссылок (каждую с новой строки). Повторная загрузка той же ссылки
          обновляет данные, а не дублирует.
        </p>
      </div>
      <textarea
        className="inp min-h-20 font-mono text-xs"
        placeholder={"https://hockey.by/statistic/competition/?division=493&command=4286\nhttps://hockey.by/statistic/competition/?division=33&command=100"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={busy} onClick={parse}>
          {busy ? "Загружаем…" : "Разобрать ссылки"}
        </button>
        {previews.some((p) => p.ok && !p.saved) && (
          <button className="btn" disabled={busy} onClick={saveAll}>Сохранить все</button>
        )}
        {msg && <span className="text-sm text-ink-soft">{msg}</span>}
      </div>

      {previews.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["Команда", "Сезон", "Турнир / дивизион", "Стадия", "Игроки", "Столбцы", ""].map((h) => (
                  <th key={h} className="th text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previews.map((p, i) =>
                p.ok ? (
                  <tr key={p.url}>
                    <td className="td font-bold">{p.team}</td>
                    <td className="td">
                      <input
                        className="inp w-28 font-mono text-xs"
                        value={p.season}
                        onChange={(e) => update(i, { season: e.target.value })}
                        title="Формат 2018-2019"
                      />
                    </td>
                    <td className="td text-xs">{p.league} · {p.divisionName}</td>
                    <td className="td">
                      <select className="inp w-48" value={p.stage} onChange={(e) => update(i, { stage: e.target.value as Stage })}>
                        {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                    </td>
                    <td className="td text-xs">{p.skaters} пол. · {p.goalies} вр.</td>
                    <td className="td max-w-64 text-[11px] whitespace-normal text-ink-soft">
                      {p.skaterColumns.map((k) => SKATER_COLS.find((c) => c.key === k)?.label ?? k).join(" ")}
                    </td>
                    <td className="td">
                      {p.saved ? (
                        <span className="badge bg-ok/15 text-ok">сохранено</span>
                      ) : (
                        <button
                          className="btn"
                          disabled={p.saving}
                          onClick={async () => {
                            if (await saveOne(i)) await onSaved();
                          }}
                        >
                          {p.saving ? "…" : "Сохранить"}
                        </button>
                      )}
                      {p.error && <div className="text-xs text-bad">{p.error}</div>}
                    </td>
                  </tr>
                ) : (
                  <tr key={p.url}>
                    <td className="td text-xs text-bad" colSpan={7}>{p.url} — {p.error}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Список загрузок
// ---------------------------------------------------------------------------

function ImportsList({ imports, onChanged }: { imports: SeasonImportMeta[]; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<number | null>(null);
  const sorted = [...imports].sort(
    (a, b) =>
      seasonStartYear(b.season) - seasonStartYear(a.season) ||
      STAGES.findIndex((s) => s.key === a.stage) - STAGES.findIndex((s) => s.key === b.stage) ||
      a.team.localeCompare(b.team, "ru"),
  );

  const act = async (id: number, init: RequestInit) => {
    setBusy(id);
    const r = await fetch(`/api/seasons/${id}`, init);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.error ?? "Ошибка");
    }
    await onChanged();
    setBusy(null);
  };

  if (!imports.length) {
    return <p className="border-t border-line px-4 py-4 text-sm text-ink-soft">Пока ничего не загружено.</p>;
  }

  return (
    <div className="overflow-x-auto border-t border-line">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {["Сезон", "Стадия", "Команда", "Турнир / дивизион", "Игроки", "Загружено", ""].map((h) => (
              <th key={h} className="th text-left">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((imp, i) => (
            <tr key={imp.id} className={i % 2 ? "bg-paper/50" : ""}>
              <td className="td font-mono font-semibold">
                {seasonLabel(imp.season)}
                {imp.live && <span className="badge ml-1 bg-ice-soft text-ice">текущий</span>}
              </td>
              <td className="td">
                {imp.live ? (
                  <span className="text-xs">{stageLabel(imp.stage)}</span>
                ) : (
                  <select
                    className="inp w-44 py-1 text-xs"
                    value={imp.stage}
                    disabled={busy === imp.id}
                    onChange={(e) =>
                      act(imp.id, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ stage: e.target.value }),
                      })
                    }
                    title={stageLabel(imp.stage)}
                  >
                    {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                )}
              </td>
              <td className="td font-bold">{imp.team}</td>
              <td className="td text-xs text-ink-soft">
                {imp.live || imp.url.startsWith("live://") ? (
                  <span>{imp.league} · {imp.divisionName}</span>
                ) : (
                  <a href={imp.url} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
                    {imp.league} · {imp.divisionName} ↗
                  </a>
                )}
              </td>
              <td className="td text-xs">{imp.skaterCount} пол. · {imp.goalieCount} вр.</td>
              <td className="td font-mono text-xs text-ink-soft">{new Date(imp.importedAt).toLocaleDateString("ru-RU")}</td>
              <td className="td space-x-1 text-right">
                {imp.live ? (
                  <span className="text-[11px] text-ink-soft">из протоколов · в архив — кнопка на «Матчи»</span>
                ) : (
                  <>
                    {!imp.url.startsWith("live://") && (
                      <button className="btn py-1 text-xs" disabled={busy === imp.id} onClick={() => act(imp.id, { method: "POST" })} title="Перекачать с hockey.by">
                        ⟳ Обновить
                      </button>
                    )}
                    <button
                      className="btn-danger py-1 text-xs"
                      disabled={busy === imp.id}
                      onClick={() => confirm(`Удалить ${imp.team} ${seasonLabel(imp.season)} (${stageLabel(imp.stage)})?`) && act(imp.id, { method: "DELETE" })}
                    >
                      Удалить
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
