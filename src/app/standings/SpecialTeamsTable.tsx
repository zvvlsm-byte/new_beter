"use client";

import { useMemo, useState } from "react";
import type { StandingsRow } from "@/lib/compute";
import { fmtNum, fmtPct } from "@/lib/clean";

type ExtRow = StandingsRow & { ppTimePerGame: number; pkTimePerGame: number };

const COLS: { key: keyof ExtRow; label: string; title: string }[] = [
  { key: "team", label: "Команда", title: "Команда (клик — по алфавиту)" },
  { key: "gp", label: "И", title: "Игры" },
  { key: "ppOpp", label: "Бол", title: "Попытки большинства по индивидуальным штрафам соперника: каждый малый (2′) и большой (5′) = 1 попытка; двойной малый (4′ или 2+2) = 2; два игрока в одну секунду = 2 параллельные попытки (5х3). Обоюдные, ШБ (0′) и дисциплинарные 10′/20′/25′ не считаются" },
  { key: "ppGoals", label: "ШБ", title: "Шайбы, заброшенные в большинстве" },
  { key: "ppPct", label: "%Б", title: "Реализация большинства: ШБ / Бол" },
  { key: "gaPowerplay", label: "ПШБ", title: "Пропущено, играя в большинстве (соперник забил в меньшинстве)" },
  { key: "oppPim", label: "ВПБ", title: "Время в большинстве: гол в большинстве аннулирует первый малый штраф, поэтому время считается до гола; большие штрафы (5′) отбываются полностью" },
  { key: "ppTimePerGame", label: "ВПБ/И", title: "Среднее время в большинстве за игру" },
  { key: "pkOwn", label: "Мен", title: "Игры в меньшинстве по своим штрафам: каждый малый (2′) и большой (5′) = 1 раз; двойной малый = 2; два своих игрока в одну секунду = 2 (соперник 5х3). Обоюдные, ШБ (0′) и дисциплинарные 10′/20′/25′ не считаются" },
  { key: "gaShorthanded", label: "ПШМ", title: "Пропущено, играя в меньшинстве" },
  { key: "pkPct", label: "%М", title: "Надёжность меньшинства: 100% − (ПШМ / Мен)" },
  { key: "shGoals", label: "ШМ", title: "Шайбы, заброшенные в меньшинстве" },
  { key: "pim", label: "ВПМ", title: "Время в меньшинстве: гол соперника в большинстве аннулирует первый малый штраф — время считается до гола" },
  { key: "pkTimePerGame", label: "ВПМ/И", title: "Среднее время в меньшинстве за игру" },
];

export function SpecialTeamsTable({ rows }: { rows: StandingsRow[] }) {
  const [sort, setSort] = useState<{ key: keyof ExtRow; dir: 1 | -1 } | null>(null);

  const sorted = useMemo(() => {
    const ext: ExtRow[] = rows.map((r) => ({
      ...r,
      ppTimePerGame: r.gp ? r.oppPim / r.gp : 0,
      pkTimePerGame: r.gp ? r.pim / r.gp : 0,
    }));
    if (!sort) return ext;
    return [...ext].sort((a, b) => {
      if (sort.key === "team") return a.team.localeCompare(b.team, "ru") * sort.dir;
      const av = a[sort.key];
      const bv = b[sort.key];
      const an = typeof av === "number" ? av : -Infinity;
      const bn = typeof bv === "number" ? bv : -Infinity;
      return (an - bn) * sort.dir || a.team.localeCompare(b.team, "ru");
    });
  }, [rows, sort]);

  const toggleSort = (key: keyof ExtRow) =>
    setSort((s) => (s?.key === key ? (s.dir === -1 ? { key, dir: 1 } : null) : { key, dir: -1 }));

  const arrow = (key: keyof ExtRow) => (sort?.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : "");

  return (
    <div className="card overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th colSpan={7} className="border-b border-line bg-ok px-2 py-1 text-left text-[11px] font-bold tracking-wider text-white uppercase">Большинство</th>
            <th colSpan={7} className="border-b border-line bg-accent px-2 py-1 text-left text-[11px] font-bold tracking-wider text-white uppercase">Меньшинство</th>
          </tr>
          <tr>
            <th className="th text-left">№</th>
            {COLS.map((c) => (
              <th
                key={c.key}
                title={c.title}
                onClick={() => toggleSort(c.key)}
                className={`th cursor-pointer transition select-none hover:text-ink ${c.key === "team" ? "text-left" : "text-right"} ${sort?.key === c.key ? "text-accent" : ""}`}
              >
                {c.label}{arrow(c.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.team} className={i % 2 ? "bg-paper/50" : ""}>
              <td className="td w-8 font-mono text-xs text-ink-soft">{i + 1}</td>
              <td className="td font-bold whitespace-normal">{r.team}</td>
              <td className="td-num">{r.gp}</td>
              <td className="td-num">{r.ppOpp}</td>
              <td className="td-num">{r.ppGoals}</td>
              <td className="td-num bg-ice-soft/60 font-bold">{fmtPct(r.ppPct)}</td>
              <td className="td-num">{r.gaPowerplay}</td>
              <td className="td-num">{fmtNum(r.oppPim)}</td>
              <td className="td-num">{fmtNum(r.ppTimePerGame)}</td>
              <td className="td-num">{r.pkOwn}</td>
              <td className="td-num">{r.gaShorthanded}</td>
              <td className="td-num bg-ice-soft/60 font-bold">{fmtPct(r.pkPct)}</td>
              <td className="td-num">{r.shGoals}</td>
              <td className="td-num">{fmtNum(r.pim)}</td>
              <td className="td-num">{fmtNum(r.pkTimePerGame)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-3 text-xs text-ink-soft">
        Попытки большинства считаются по индивидуальным штрафам (как в официальной системе лиги), а не по интервалам неравенства составов:
        каждый малый (2′) и большой (5′) штраф = 1 попытка · двойной малый (4′ или 2+2 одного игрока) = 2 попытки ·
        два игрока одной команды в одну секунду = 2 параллельные попытки (соперник играет 5х3) ·
        5+20 и 2+10 — считается только малая/большая часть ·
        обоюдные удаления (игроки обеих команд в одну секунду) и дисциплинарные 10′/20′/25′ не считаются — численность на льду не меняется ·
        штрафной бросок (0′) большинства не даёт · в овертайме удаление даёт большинство 4х3 ·
        гол в большинстве аннулирует первый малый штраф (поэтому ВПБ/ВПМ могут быть дробными), большие штрафы отбываются полностью.
      </p>
    </div>
  );
}
