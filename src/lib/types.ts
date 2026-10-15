export type Side = "home" | "away";

export type ParsedSkater = {
  jersey: number | null;
  position: string;
  name: string;
  rawName: string;
  goals: number;
  assists: number;
  plusMinus: number;
  shots: number; // Б
  shotsOnGoal: number; // Бс
  hits: number; // Сп
  blocks: number; // БлБ
  pim: number;
  toi: string; // "21:31"
  faceoffs: number;
  faceoffWins: number;
  periodToi: number[]; // секунды по периодам (1п, 2п, 3п, [ОТ])
};

export type ParsedGoalie = {
  jersey: number | null;
  name: string;
  rawName: string;
  toi: string;
  saves: number;
  goalsAgainst: number;
  result: "" | "W" | "L";
  // вклад вратаря из строки состава: силовые, блоки, броски, передачи и т.д.
  goals: number;
  assists: number;
  shots: number;
  shotsOnGoal: number;
  hits: number;
  blocks: number;
  pim: number;
  periodToi: number[];
};

export type ParsedGoal = {
  side: Side;
  period: number;
  time: string;
  strength: "eq" | "pp" | "sh";
  emptyNet: boolean;
  scorer: string;
  assist1: string;
  assist2: string;
  rawStrength: string;
};

export type ParsedPenalty = {
  side: Side;
  period: number;
  time: string;
  minutes: number;
  player: string; // пустая строка => командный штраф
  infraction: string;
  coincidental: boolean; // обоюдное удаление (пара в одно время) — не даёт большинства
  penaltyShot: boolean; // ШБ: штрафной бросок (0 минут)
};

export type ParsedMatch = {
  date: string; // yyyy-mm-dd
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  winType: "reg" | "ot" | "so";
  /** Стадия: из протокола (плей-офф / плей-ин) или regular. */
  stage: "regular" | "playin" | "playoff";
  periods: { h: number; a: number; hSog?: number; aSog?: number }[];
  sourceUrl: string;
  attendance: number | null;
  skaters: { home: ParsedSkater[]; away: ParsedSkater[] };
  goalies: { home: ParsedGoalie[]; away: ParsedGoalie[] };
  goals: ParsedGoal[];
  penalties: ParsedPenalty[];
  warnings: string[];
};

export function emptyParsed(): ParsedMatch {
  return {
    date: new Date().toISOString().slice(0, 10),
    homeTeam: "",
    awayTeam: "",
    homeScore: 0,
    awayScore: 0,
    winType: "reg",
    stage: "regular",
    periods: [{ h: 0, a: 0 }],
    sourceUrl: "",
    attendance: null,
    skaters: { home: [], away: [] },
    goalies: { home: [], away: [] },
    goals: [],
    penalties: [],
    warnings: [],
  };
}
