"use client";

import { useMemo, useState } from "react";

export type SortState = { key: string; dir: 1 | -1 } | null;

/**
 * Сортировка таблицы кликом по заголовку:
 * 1-й клик — по убыванию, 2-й — по возрастанию, 3-й — исходный порядок.
 */
export function useSort<T>(rows: T[], getters: Record<string, (r: T) => number | string | null | undefined>) {
  const [sort, setSort] = useState<SortState>(null);

  const sorted = useMemo(() => {
    if (!sort || !getters[sort.key]) return rows;
    const get = getters[sort.key];
    return [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (typeof av === "string" || typeof bv === "string") {
        return String(av ?? "").localeCompare(String(bv ?? ""), "ru") * sort.dir;
      }
      const an = typeof av === "number" && Number.isFinite(av) ? av : -Infinity;
      const bn = typeof bv === "number" && Number.isFinite(bv) ? bv : -Infinity;
      return (an - bn) * sort.dir;
    });
    // getters — стабильный объект-литерал на стороне вызова, зависим от sort/rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  const toggle = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: -1 } : s.dir === -1 ? { key, dir: 1 } : null));

  const arrow = (key: string) => (sort?.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : "");

  return { sorted, sort, toggle, arrow };
}
