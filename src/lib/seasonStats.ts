/**
 * Архив «Статистика за сезоны» (данные hockey.by).
 * Чистые функции без доступа к БД — используются и на сервере, и в браузере.
 *
 * Важно: в разных сезонах на hockey.by вёлся разный набор столбцов.
 * Если показатель не вёлся — значение хранится как null и выводится «—».
 * При суммировании null НЕ учитывается (не превращается в 0), а производные
 * показатели (%, средние) считаются только по тем строкам, где данные есть.
 */

export type Stage = "regular" | "playin" | "playoff";

export const STAGES: { key: Stage; label: string; short: string }[] = [
  { key: "regular", label: "Регулярный чемпионат", short: "РЧ" },
  { key: "playin", label: "Плей-ин", short: "Плей-ин" },
  { key: "playoff", label: "Плей-офф", short: "ПО" },
];

export const stageLabel = (s: string) => STAGES.find((x) => x.key === s)?.label ?? s;
export const stageShort = (s: string) => STAGES.find((x) => x.key === s)?.short ?? s;

/** Угадать стадию по названию дивизиона. Пользователь всегда может исправить. */
export function guessStage(divisionName: string | null | undefined): Stage {
  const n = (divisionName ?? "").toLowerCase();
  if (/плей[\s-]?ин|play[\s-]?in|переходн/.test(n)) return "playin";
  if (/плей[\s-]?офф|play[\s-]?off|финал(?!ьный)/.test(n)) return "playoff";
  return "regular";
}

/** Стадия по тексту протокола; если не распознано — fallback. */
export function stageFromText(text: string, fallback: Stage = "regular"): Stage {
  const guessed = guessStage(text);
  return guessed === "regular" ? fallback : guessed;
}

/** "2018-2019" → "2018/19" */
export function seasonLabel(s: string): string {
  const m = /^(\d{4})\D+(\d{4})$/.exec(s.trim());
  return m ? `${m[1]}/${m[2].slice(2)}` : s;
}

export const seasonStartYear = (s: string) => parseInt(s.slice(0, 4), 10) || 0;

/** Ключ игрока для сопоставления с нашими протоколами. */
export function nameKey(name: string): string {
  return name.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Столбцы
// ---------------------------------------------------------------------------

export type ColKind = "int" | "time" | "dec" | "pct";

export type StatCol = { key: string; label: string; title: string; kind: ColKind };

/** Полевые игроки: все показатели, которые встречаются в разные сезоны. */
export const SKATER_COLS: StatCol[] = [
  { key: "gp", label: "И", title: "Игры", kind: "int" },
  { key: "goals", label: "Г", title: "Голы", kind: "int" },
  { key: "assists", label: "А", title: "Передачи", kind: "int" },
  { key: "points", label: "О", title: "Очки", kind: "int" },
  { key: "plusMinus", label: "+/−", title: "Плюс-минус", kind: "int" },
  { key: "pim", label: "Штр", title: "Штрафные минуты", kind: "int" },
  { key: "avgToi", label: "ВНЛ(ср)", title: "Среднее время на льду", kind: "time" },
  { key: "toi", label: "ВНЛ", title: "Общее время на льду", kind: "time" },
  { key: "ppGoals", label: "ГБ", title: "Голы в большинстве", kind: "int" },
  { key: "ppAssists", label: "ПБ", title: "Передачи в большинстве", kind: "int" },
  { key: "shGoals", label: "ГМ", title: "Голы в меньшинстве", kind: "int" },
  { key: "shAssists", label: "ПМ", title: "Передачи в меньшинстве", kind: "int" },
  { key: "shots", label: "Бр", title: "Броски (все)", kind: "int" },
  { key: "sog", label: "БрС", title: "Броски в створ", kind: "int" },
  { key: "shotPct", label: "%Бр", title: "Реализация: голы / броски в створ", kind: "pct" },
  { key: "corsi", label: "CORSI", title: "Corsi", kind: "int" },
  { key: "foWon", label: "ВБР+", title: "Выигранные вбрасывания", kind: "int" },
  { key: "foLost", label: "ВБР−", title: "Проигранные вбрасывания", kind: "int" },
  { key: "foTotal", label: "ВБР", title: "Всего вбрасываний", kind: "int" },
  { key: "foPct", label: "ВБ%", title: "Процент выигранных вбрасываний", kind: "pct" },
  { key: "hits", label: "СП", title: "Силовые приёмы", kind: "int" },
  { key: "blocks", label: "БлБ", title: "Блокированные броски", kind: "int" },
  { key: "shifts", label: "Смен", title: "Количество смен", kind: "int" },
  { key: "ppToi", label: "ВРБ", title: "Время в большинстве", kind: "time" },
  { key: "ppPlus", label: "БОЛ+", title: "БОЛ+ (как на hockey.by)", kind: "int" },
  { key: "pkToi", label: "ВРМ", title: "Время в меньшинстве", kind: "time" },
  { key: "pkPlus", label: "МЕН+", title: "МЕН+ (как на hockey.by)", kind: "int" },
  { key: "gwg", label: "ПГ", title: "Победные голы", kind: "int" },
];

export const GOALIE_COLS: StatCol[] = [
  { key: "rostered", label: "З", title: "В заявке", kind: "int" },
  { key: "gp", label: "И", title: "Игры", kind: "int" },
  { key: "toi", label: "МИН", title: "Игровое время", kind: "time" },
  { key: "wins", label: "В", title: "Победы", kind: "int" },
  { key: "otLosses", label: "ПО", title: "Поражения в овертайме", kind: "int" },
  { key: "soLosses", label: "ПБул", title: "Поражения по буллитам", kind: "int" },
  { key: "losses", label: "П", title: "Поражения", kind: "int" },
  { key: "pb", label: "ПБ", title: "ПБ (как на hockey.by)", kind: "int" },
  { key: "shotsAgainst", label: "БВ", title: "Броски по воротам", kind: "int" },
  { key: "goalsAgainst", label: "ПШ", title: "Пропущенные шайбы", kind: "int" },
  { key: "saves", label: "ОБ", title: "Отражённые броски", kind: "int" },
  { key: "savePct", label: "%ОБ", title: "Процент отражённых бросков", kind: "pct" },
  { key: "gaa", label: "КН", title: "Коэффициент надёжности (пропущенные за 60 минут)", kind: "dec" },
  { key: "shutouts", label: "И0", title: "Сухие матчи", kind: "int" },
  { key: "soSaves", label: "БУЛ+", title: "Отражённые буллиты", kind: "int" },
  { key: "soGoals", label: "БУЛ−", title: "Пропущенные буллиты", kind: "int" },
  { key: "goals", label: "Г", title: "Голы", kind: "int" },
  { key: "assists", label: "А", title: "Передачи", kind: "int" },
  { key: "pim", label: "Штр", title: "Штрафные минуты", kind: "int" },
];

/** Нормализация заголовка таблицы hockey.by */
export function normHeader(h: string): string {
  return h.toLowerCase().replace(/ё/g, "е").replace(/[\s.]/g, "").replace(/[–—−]/g, "-");
}

/** Заголовок → ключ показателя полевого игрока */
export const SKATER_HEADER_MAP: Record<string, string> = {
  "и": "gp", "г": "goals", "а": "assists", "п": "assists", "о": "points",
  "+/-": "plusMinus", "+-": "plusMinus",
  "штр": "pim", "шм": "pim",
  "внл(ср)": "avgToi", "внлср": "avgToi", "срвнл": "avgToi",
  "внл": "toi",
  "гб": "ppGoals", "пб": "ppAssists", "гм": "shGoals", "пм": "shAssists",
  "броски": "sog", "бр+": "sog", "брс": "sog", "бр": "shots", "бросківсего": "shots",
  "%бр": "shotPct",
  "corsi": "corsi", "корси": "corsi",
  "вбр+": "foWon", "вбр-": "foLost", "вбр": "foTotal", "вб%": "foPct", "вбр%": "foPct",
  "сп": "hits", "сил": "hits", "блб": "blocks", "бл": "blocks",
  "с": "shifts", "смен": "shifts",
  "врб": "ppToi", "бол+": "ppPlus", "врм": "pkToi", "мен+": "pkPlus",
  "пг": "gwg", "гп": "gwg", "рг": "gwg",
};

export const GOALIE_HEADER_MAP: Record<string, string> = {
  "з": "rostered", "и": "gp", "мин": "toi", "внл": "toi",
  "в": "wins", "по": "otLosses", "пбул": "soLosses", "п": "losses", "пб": "pb",
  "пш": "goalsAgainst", "коэфф": "gaa", "кн": "gaa",
  "бв": "shotsAgainst", "бр": "shotsAgainst",
  "об": "saves", "%об": "savePct",
  "и0": "shutouts", "сух": "shutouts", "см": "shutouts",
  "бул+": "soSaves", "бул-": "soGoals",
  "г": "goals", "а": "assists", "штр": "pim",
};

export const TIME_KEYS = new Set(["avgToi", "toi", "ppToi", "pkToi"]);

/** "+41" → 41, "1,57" → 1.57, "17:46" → 1066 (для времени), "—" → null */
export function parseCell(raw: string, isTime: boolean): number | null {
  const s = raw.replace(/\s+/g, "").replace(/[–—−]/g, "-");
  if (!s || s === "-" || s === "--") return null;
  if (isTime) {
    if (/^\d+:\d{1,2}(:\d{1,2})?$/.test(s)) {
      const p = s.split(":").map(Number);
      const sec = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
      return sec > 0 ? sec : null; // 00:00 — время не велось
    }
    const n = Number(s.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 60); // число = минуты
  }
  const n = Number(s.replace(",", ".").replace(/^\+/, "").replace(/%$/, ""));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Агрегация
// ---------------------------------------------------------------------------

export type Stats = Record<string, number | null>;

const DERIVED_SKATER = new Set(["shotPct", "foPct", "avgToi"]);
const DERIVED_GOALIE = new Set(["savePct", "gaa"]);

function sumKey(list: Stats[], key: string): number | null {
  let has = false;
  let s = 0;
  for (const r of list) {
    const v = r[key];
    if (typeof v === "number") {
      has = true;
      s += v;
    }
  }
  return has ? s : null;
}

/** Нормализовать одну строку полевого (заполнить производные, где возможно). */
export function normalizeSkater(st: Stats): Stats {
  const r: Stats = { ...st };
  if (r.points == null && r.goals != null && r.assists != null) r.points = r.goals + r.assists;
  // «ВБР» одним числом (2021/22) — всего вбрасываний, выигранные = ВБР × ВБ%
  if (r.foWon == null && r.foTotal != null && r.foPct != null) {
    r.foWon = Math.round((r.foTotal * r.foPct) / 100);
    r.foLost = Math.max(0, r.foTotal - r.foWon);
  }
  if (r.foTotal == null && r.foWon != null && r.foLost != null) r.foTotal = r.foWon + r.foLost;
  if (r.toi == null && r.avgToi != null && r.gp) r.toi = Math.round(r.avgToi * r.gp);
  return r;
}

export function normalizeGoalie(st: Stats): Stats {
  const r: Stats = { ...st };
  if (r.saves == null && r.shotsAgainst != null && r.goalsAgainst != null) r.saves = r.shotsAgainst - r.goalsAgainst;
  if (r.shotsAgainst == null && r.saves != null && r.goalsAgainst != null) r.shotsAgainst = r.saves + r.goalsAgainst;
  return r;
}

/** Суммирование строк полевых (разные сезоны / стадии / команды). */
export function aggregateSkaters(rows: Stats[]): Stats {
  const list = rows.map(normalizeSkater);
  const out: Stats = {};
  for (const c of SKATER_COLS) if (!DERIVED_SKATER.has(c.key)) out[c.key] = sumKey(list, c.key);
  // среднее время — только по строкам, где время велось
  const withToi = list.filter((r) => r.toi != null && r.gp);
  const gpToi = withToi.reduce((a, r) => a + (r.gp ?? 0), 0);
  out.toi = withToi.length ? withToi.reduce((a, r) => a + (r.toi ?? 0), 0) : null;
  out.avgToi = gpToi ? Math.round((out.toi ?? 0) / gpToi) : null;
  // реализация — голы только из строк, где велись броски в створ
  const withSog = list.filter((r) => r.sog != null);
  const sog = withSog.reduce((a, r) => a + (r.sog ?? 0), 0);
  out.shotPct = sog ? (withSog.reduce((a, r) => a + (r.goals ?? 0), 0) / sog) * 100 : null;
  const withFo = list.filter((r) => r.foWon != null && r.foLost != null);
  const fo = withFo.reduce((a, r) => a + (r.foWon ?? 0) + (r.foLost ?? 0), 0);
  out.foPct = fo ? (withFo.reduce((a, r) => a + (r.foWon ?? 0), 0) / fo) * 100 : null;
  return out;
}

export function aggregateGoalies(rows: Stats[]): Stats {
  const list = rows.map(normalizeGoalie);
  const out: Stats = {};
  for (const c of GOALIE_COLS) if (!DERIVED_GOALIE.has(c.key)) out[c.key] = sumKey(list, c.key);
  const withSv = list.filter((r) => r.saves != null && r.goalsAgainst != null);
  const sa = withSv.reduce((a, r) => a + (r.saves ?? 0) + (r.goalsAgainst ?? 0), 0);
  out.savePct = sa ? (withSv.reduce((a, r) => a + (r.saves ?? 0), 0) / sa) * 100 : null;
  const withToi = list.filter((r) => r.toi != null && r.goalsAgainst != null);
  const toi = withToi.reduce((a, r) => a + (r.toi ?? 0), 0);
  out.gaa = toi ? (withToi.reduce((a, r) => a + (r.goalsAgainst ?? 0), 0) * 3600) / toi : null;
  return out;
}

export function fmtStat(v: number | null | undefined, kind: ColKind, key?: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (kind === "time") {
    const s = Math.round(v);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  if (kind === "pct") return v.toFixed(1);
  if (kind === "dec") return v.toFixed(2);
  if (key === "plusMinus" && v > 0) return `+${v}`;
  return String(Math.round(v * 100) / 100);
}

// ---------------------------------------------------------------------------
// Типы ответа API
// ---------------------------------------------------------------------------

export type SeasonImportMeta = {
  id: number;
  url: string;
  divisionId: number;
  commandId: number;
  season: string;
  league: string | null;
  divisionName: string | null;
  stage: Stage;
  team: string;
  skaterColumns: string[];
  goalieColumns: string[];
  importedAt: string;
  skaterCount: number;
  goalieCount: number;
  /** Строка из текущих протоколов, ещё не ушедшая в архив кнопкой «В архив». */
  live?: boolean;
};

export type SeasonRow = {
  importId: number;
  name: string;
  nameKey: string;
  extId: string | null;
  jersey: number | null;
  position?: string | null;
  birthDate: string | null;
  stats: Stats;
};

export type SeasonsPayload = {
  imports: SeasonImportMeta[];
  skaters: SeasonRow[];
  goalies: SeasonRow[];
};
