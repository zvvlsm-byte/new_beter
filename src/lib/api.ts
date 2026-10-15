import type { Side } from "@/db/schema";

export type SkaterPayload = {
  side: Side;
  jersey: number | null;
  position: string;
  name: string;
  goals: number;
  assists: number;
  plusMinus: number;
  shots: number;
  shotsOnGoal: number;
  hits: number;
  blocks: number;
  pim: number;
  toi: string; // "21:31"
  faceoffs: number;
  faceoffWins: number;
  periodToi?: number[]; // секунды по периодам (из протокола)
};

export type GoaliePayload = {
  side: Side;
  jersey: number | null;
  name: string;
  toi: string;
  saves: number;
  goalsAgainst: number;
  result: "" | "W" | "L";
  // вклад вратаря из строки состава
  goals: number;
  assists: number;
  shots: number;
  shotsOnGoal: number;
  hits: number;
  blocks: number;
  pim: number;
  periodToi: number[];
};

export type GoalPayload = {
  side: Side;
  period: number;
  time: string;
  strength: "eq" | "pp" | "sh";
  emptyNet: boolean;
  scorer: string;
  assist1: string;
  assist2: string;
};

export type PenaltyPayload = {
  side: Side;
  period: number;
  time: string;
  minutes: number;
  player: string; // "" => командный штраф
  infraction: string;
  coincidental: boolean; // обоюдное удаление — не даёт большинства сопернику
  penaltyShot: boolean; // ШБ: штрафной бросок (0 минут)
};

export type MatchPayload = {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  winType: "reg" | "ot" | "so";
  stage: "regular" | "playin" | "playoff";
  periods: { h: number; a: number; hSog?: number; aSog?: number }[];
  sourceUrl: string;
  notes: string;
  attendance: number | null;
  skaters: SkaterPayload[];
  goalies: GoaliePayload[];
  goals: GoalPayload[];
  penalties: PenaltyPayload[];
};

export function payloadFromParsed(p: {
  date: string; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number;
  winType: "reg" | "ot" | "so"; stage?: "regular" | "playin" | "playoff";
  periods: { h: number; a: number; hSog?: number; aSog?: number }[]; sourceUrl: string;
  attendance: number | null;
  skaters: { home: import("./types").ParsedSkater[]; away: import("./types").ParsedSkater[] };
  goalies: { home: import("./types").ParsedGoalie[]; away: import("./types").ParsedGoalie[] };
  goals: import("./types").ParsedGoal[];
  penalties: import("./types").ParsedPenalty[];
}): MatchPayload {
  const sides: Side[] = ["home", "away"];
  return {
    date: p.date,
    homeTeam: p.homeTeam,
    awayTeam: p.awayTeam,
    homeScore: p.homeScore,
    awayScore: p.awayScore,
    winType: p.winType,
    stage: p.stage === "playoff" || p.stage === "playin" ? p.stage : "regular",
    periods: p.periods,
    sourceUrl: p.sourceUrl,
    notes: "",
    attendance: p.attendance ?? null,
    skaters: sides.flatMap((side) =>
      p.skaters[side].map((s) => ({
        side, jersey: s.jersey, position: s.position, name: s.name,
        goals: s.goals, assists: s.assists, plusMinus: s.plusMinus,
        shots: s.shots, shotsOnGoal: s.shotsOnGoal, hits: s.hits, blocks: s.blocks,
        pim: s.pim, toi: s.toi, faceoffs: s.faceoffs, faceoffWins: s.faceoffWins,
        periodToi: s.periodToi ?? [],
      })),
    ),
    goalies: sides.flatMap((side) =>
      p.goalies[side].map((g) => ({
        side, jersey: g.jersey, name: g.name, toi: g.toi,
        saves: g.saves, goalsAgainst: g.goalsAgainst, result: g.result,
        goals: g.goals, assists: g.assists, shots: g.shots, shotsOnGoal: g.shotsOnGoal,
        hits: g.hits, blocks: g.blocks, pim: g.pim, periodToi: g.periodToi ?? [],
      })),
    ),
    goals: p.goals.map((g) => ({
      side: g.side, period: g.period, time: g.time, strength: g.strength,
      emptyNet: g.emptyNet, scorer: g.scorer, assist1: g.assist1, assist2: g.assist2,
    })),
    penalties: p.penalties.map((x) => ({
      side: x.side, period: x.period, time: x.time, minutes: x.minutes,
      player: x.player, infraction: x.infraction, coincidental: !!x.coincidental,
      penaltyShot: !!x.penaltyShot,
    })),
  };
}

export function validatePayload(p: MatchPayload): string | null {
  if (!p.date || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return "Укажите дату матча";
  if (!p.homeTeam.trim() || !p.awayTeam.trim()) return "Укажите названия обеих команд";
  if (p.homeScore < 0 || p.awayScore < 0) return "Счёт не может быть отрицательным";
  if (!["reg", "ot", "so"].includes(p.winType)) return "Некорректный тип победы";
  if (p.stage && !["regular", "playin", "playoff"].includes(p.stage)) return "Некорректная стадия матча";
  return null;
}
