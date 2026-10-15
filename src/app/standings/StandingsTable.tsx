"use client";

import { useMemo, useState } from "react";
import type { StandingsRow } from "@/lib/compute";
import { fmtPct } from "@/lib/clean";

/** Строка таблицы + Корси (новые колонки, считаются отдельно в lib/corsi.ts). */
export type StandingsRowCorsi = StandingsRow & {
  corsiFor: number;
  corsiAgainst: number;
  corsiDiff: number;
  corsiPct: number | null;
};

type SortKey = keyof StandingsRowCorsi;

const COLS: { key: SortKey; label: string; title: string; num?: boolean }[] = [
  { key: "team", label: "Команда", title: "Команда (клик — сортировка по алфавиту)" },
  { key: "gp", label: "И", title: "Игры", num: true },
  { key: "w", label: "В", title: "Победы в основное время (2 очка)", num: true },
  { key: "wot", label: "ВО", title: "Победы в овертайме (2 очка)", num: true },
  { key: "wso", label: "ВБул", title: "Победы по буллитам (2 очка)", num: true },
  { key: "l", label: "П", title: "Поражения в основное время (0 очков)", num: true },
  { key: "lot", label: "ПО", title: "Поражения в овертайме (1 очко)", num: true },
  { key: "lso", label: "ПБул", title: "Поражения по буллитам (1 очко)", num: true },
  { key: "pts", label: "О", title: "Очки: любая победа — 2, поражение в ОТ/по буллитам — 1, в основное время — 0", num: true },
  { key: "ptsPct", label: "%О", title: "Процент набранных очков: О / (И×2)", num: true },
  { key: "gf", label: "Г", title: "Заброшенные шайбы", num: true },
  { key: "ga", label: "ПШ", title: "Пропущенные шайбы", num: true },
  { key: "blankGames", label: "Ибз", title: "Игры без заброшенных шайб (команда не забила ни разу)", num: true },
  { key: "cleanSheets", label: "И0", title: "Игры «на ноль»: соперник не забросил ни одной шайбы", num: true },
  { key: "pimAll", label: "Штр.", title: "ВСЕ штрафные минуты команды, включая обоюдные удаления", num: true },
  { key: "ppPct", label: "%Б", title: "Реализация большинства: голы в большинстве / удаления соперника, давшие преимущество (без обоюдных и штрафных бросков). Подробности — в таблице «Большинство и меньшинство»", num: true },
  { key: "pkPct", label: "%М", title: "Игра в меньшинстве: 100% − (пропущено в меньшинстве / свои удаления, давшие меньшинство; без обоюдных и штрафных бросков). Подробности — в таблице «Большинство и меньшинство»", num: true },
  { key: "oppPimAll", label: "ШтрС", title: "Штрафное время соперника: ВСЕ минуты соперника, включая обоюдные удаления", num: true },
  { key: "hits", label: "Сил.", title: "Силовые приёмы команды", num: true },
  { key: "hitsAgainst", label: "СилС", title: "Силовые приёмы соперников против этой команды (сумма хитов соперника в её матчах)", num: true },
  { key: "blocks", label: "Блок.", title: "Заблокированные броски команды", num: true },
  { key: "blocksAgainst", label: "БлокС", title: "Блокированные броски соперников против этой команды (сумма блоков соперника в её матчах)", num: true },
  { key: "shots", label: "Бр", title: "Броски (всего)", num: true },
  { key: "shotPct", label: "РБ", title: "Реализация бросков: голы / броски", num: true },
  { key: "enGoals", label: "ПВ", title: "Голы в пустые ворота", num: true },
  { key: "corsiFor", label: "CF", title: "Corsi For (Корси за): голы + броски в створ + броски мимо + броски, заблокированные соперником. Сумма по всем матчам", num: true },
  { key: "corsiAgainst", label: "CA", title: "Corsi Against (Корси против): все бросковые попытки соперника (голы + в створ + мимо + заблокированные нашей командой). Сумма по всем матчам", num: true },
  { key: "corsiDiff", label: "Корси±", title: "Разница Корси: CF − CA", num: true },
  { key: "corsiPct", label: "CF%", title: "Процент Корси: CF ÷ (CF + CA) × 100%", num: true },
];

function numVal(r: StandingsRowCorsi, key: SortKey): number {
  const v = r[key];
  return typeof v === "number" ? v : -Infinity;
}

export function StandingsTable({ rows }: { rows: StandingsRowCorsi[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      if (sort.key === "team") return a.team.localeCompare(b.team, "ru") * sort.dir;
      return (
        (numVal(a, sort.key) - numVal(b, sort.key)) * sort.dir ||
        a.team.localeCompare(b.team, "ru")
      );
    });
  }, [rows, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s?.key === key ? (s.dir === -1 ? { key, dir: 1 } : null) : { key, dir: -1 }));

  const arrow = (key: SortKey) => (sort?.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : "");

  return (
    <div className="card overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th colSpan={15} className="border-b border-line bg-ink px-2 py-1 text-left text-[11px] font-bold tracking-wider text-white uppercase">Турнирное положение</th>
            <th colSpan={3} className="border-b border-line bg-accent px-2 py-1 text-left text-[11px] font-bold tracking-wider text-white uppercase">Спецбригады</th>
            <th colSpan={7} className="border-b border-line bg-ice px-2 py-1 text-left text-[11px] font-bold tracking-wider text-white uppercase">Силовая игра и броски</th>
            <th colSpan={4} className="border-b border-line bg-ok px-2 py-1 text-left text-[11px] font-bold tracking-wider text-white uppercase">Корси</th>
          </tr>
          <tr>
            <th className="th text-left">№</th>
            {COLS.map((c) => (
              <th
                key={c.key}
                title={c.title}
                onClick={() => toggleSort(c.key)}
                className={`th cursor-pointer transition select-none hover:text-ink ${c.num ? "text-right" : "text-left"} ${sort?.key === c.key ? "text-accent" : ""}`}
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
              <td className="td-num">{r.w}</td>
              <td className="td-num">{r.wot}</td>
              <td className="td-num">{r.wso}</td>
              <td className="td-num">{r.l}</td>
              <td className="td-num">{r.lot}</td>
              <td className="td-num">{r.lso}</td>
              <td className="td-num bg-ice-soft/60 font-bold text-ink">{r.pts}</td>
              <td className="td-num">{fmtPct(r.ptsPct)}</td>
              <td className="td-num">{r.gf}</td>
              <td className="td-num">{r.ga}</td>
              <td className="td-num">{r.blankGames || "—"}</td>
              <td className="td-num">{r.cleanSheets || "—"}</td>
              <td className="td-num">{r.pimAll}</td>
              <td className="td-num">{fmtPct(r.ppPct)}</td>
              <td className="td-num">{fmtPct(r.pkPct)}</td>
              <td className="td-num">{r.oppPimAll}</td>
              <td className="td-num">{r.hits}</td>
              <td className="td-num" title="Силовые соперников против этой команды">{r.hitsAgainst}</td>
              <td className="td-num">{r.blocks}</td>
              <td className="td-num" title="Блоки соперников против этой команды">{r.blocksAgainst}</td>
              <td className="td-num">{r.shots}</td>
              <td className="td-num">{fmtPct(r.shotPct)}</td>
              <td className="td-num">{r.enGoals}</td>
              <td className="td-num">{r.corsiFor}</td>
              <td className="td-num">{r.corsiAgainst}</td>
              <td className={`td-num font-semibold ${r.corsiDiff > 0 ? "text-ok" : r.corsiDiff < 0 ? "text-bad" : ""}`}>
                {r.corsiDiff > 0 ? `+${r.corsiDiff}` : r.corsiDiff}
              </td>
              <td className="td-num font-bold">{fmtPct(r.corsiPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
