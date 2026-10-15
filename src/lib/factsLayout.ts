/**
 * Раскладка «Интересных фактов» (только отображение, расчёты не меняются):
 *  • слева — домашняя команда, справа — гостевая, ниже — «Общее по матчу»;
 *  • внутри колонки по убыванию: положительные вверху (по весу ↓),
 *    затем нейтральные, отрицательные внизу (самые «минусовые» — в самом низу);
 *  • имена игроков в тексте — «Имя Фамилия» вместо «Фамилия Имя».
 */

export type FactTone = "good" | "bad" | "neutral";
export type LayoutFact = {
  tone: FactTone;
  tag: string;
  text: string;
  score: number;
  side?: "home" | "away" | null;
  who?: string[];
};

/** «Антоновский Иван» → «Иван Антоновский»; «Иванов Иван Иванович» → «Иван Иванович Иванов». */
export function firstLast(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  return [...parts.slice(1), parts[0]].join(" ");
}

/** Заменить в тексте «Фамилия Имя» на «Имя Фамилия» для перечисленных игроков. */
export function swapNames(text: string, names: string[] | undefined): string {
  if (!names?.length) return text;
  let out = text;
  for (const n of [...new Set(names)].sort((a, b) => b.length - a.length)) {
    if (!n || !n.includes(" ")) continue;
    out = out.split(n).join(firstLast(n));
  }
  return out;
}

/** Числовой ключ: положительные сверху по весу, нейтральные в середине, отрицательные внизу. */
export function factRank(f: Pick<LayoutFact, "tone" | "score">): number {
  if (f.tone === "good") return 2_000_000 + f.score;
  if (f.tone === "neutral") return 1_000_000 + f.score;
  return -f.score; // чем «хуже» факт (больше вес), тем ниже
}

export function orderFacts<T extends Pick<LayoutFact, "tone" | "score">>(list: T[]): T[] {
  return [...list].sort((a, b) => factRank(b) - factRank(a));
}

export function splitFacts<T extends LayoutFact>(list: T[]): { home: T[]; away: T[]; general: T[] } {
  return {
    home: orderFacts(list.filter((f) => f.side === "home")),
    away: orderFacts(list.filter((f) => f.side === "away")),
    general: orderFacts(list.filter((f) => f.side !== "home" && f.side !== "away")),
  };
}
