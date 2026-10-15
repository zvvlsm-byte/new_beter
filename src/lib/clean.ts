/** Очистка имени игрока: убираем (Л), (ЛИ), (А), (К), (Д), номера и прочие символы.
 *  Остаются только имя и фамилия. */
export function cleanName(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw);
  // убрать всё в скобках: (Л), (ЛИ), (А), (К), (Д) и т.п.
  s = s.replace(/\([^)]*\)/g, " ");
  // убрать ведущий номер игрока: "22 Ярута Кирилл" -> "Ярута Кирилл"
  s = s.replace(/^\s*\d{1,3}\s+/, "");
  // запятые, точки, лишние символы
  s = s.replace(/[,.;:*]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** "21:31" -> 1291 сек. Поддерживает "1:02:03" и просто числа (минуты). */
export function parseMMSS(v: string | null | undefined): number {
  if (!v) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  const parts = s.split(":").map((p) => parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 60; // одиночное число = минуты
}

/** сек -> "21:31" */
export function formatMMSS(sec: number | null | undefined): string {
  const s = Math.max(0, Math.round(sec ?? 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** сек -> "18:24" (для средних значений, один знак не нужен) */
export function formatAvgTOI(sec: number): string {
  return formatMMSS(sec);
}

/** Период по суммарному игровому времени: 00:00–20:00 → 1, 20:00–40:00 → 2,
 *  40:00–60:00 → 3, после 60:00 → 4 (овертайм). 0 — время неизвестно. */
export function periodFromTime(mmss: string | null | undefined): number {
  if (!mmss || !String(mmss).trim()) return 0;
  const sec = parseMMSS(mmss);
  if (sec <= 20 * 60 + 1) return 1;
  if (sec <= 40 * 60 + 1) return 2;
  if (sec <= 60 * 60 + 1) return 3;
  return 4;
}

export function toInt(v: unknown): number {
  const n = parseInt(String(v ?? "").trim(), 10);
  return Number.isNaN(n) ? 0 : n;
}

export function num(v: unknown): number {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
}

export function fmtPct(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function fmtNum(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits).replace(/\.0$/, "");
}

export function fmtDateRu(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export const MONTHS_RU = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/** "Среда, 09 сентября 2026 г." -> "2026-09-09" */
export function parseRuDate(s: string): string | null {
  const m = s.match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
  if (!m) return null;
  const mi = MONTHS_RU.indexOf(m[2].toLowerCase());
  if (mi < 0) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
