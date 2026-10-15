import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { HistDetails } from "@/lib/histDetails";

export const sideEnum = pgEnum("side", ["home", "away"]);
export const winTypeEnum = pgEnum("win_type", ["reg", "ot", "so"]);

export const matches = pgTable("matches", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  homeScore: integer("home_score").notNull().default(0),
  awayScore: integer("away_score").notNull().default(0),
  winType: winTypeEnum("win_type").notNull().default("reg"),
  periods: jsonb("periods")
    .$type<{ h: number; a: number; hSog?: number; aSog?: number }[]>()
    .notNull()
    .default([]),
  sourceUrl: text("source_url"),
  notes: text("notes"),
  attendance: integer("attendance"),
  /** regular | playoff | playin — стадия берётся из протокола или режима на странице «Матчи». */
  stage: text("stage").notNull().default("regular"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const skaterGames = pgTable("skater_games", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id")
    .notNull()
    .references(() => matches.id, { onDelete: "cascade" }),
  side: sideEnum("side").notNull(),
  name: text("name").notNull(),
  rawName: text("raw_name"),
  jersey: integer("jersey"),
  position: text("position"),
  goals: integer("goals").notNull().default(0),
  assists: integer("assists").notNull().default(0),
  plusMinus: integer("plus_minus").notNull().default(0),
  shots: integer("shots").notNull().default(0), // Б — броски
  shotsOnGoal: integer("shots_on_goal").notNull().default(0), // Бс — броски в створ
  hits: integer("hits").notNull().default(0), // Сп — силовые приёмы
  blocks: integer("blocks").notNull().default(0), // БлБ — заблокированные
  pim: integer("pim").notNull().default(0),
  toiSeconds: integer("toi_seconds").notNull().default(0),
  faceoffs: integer("faceoffs").notNull().default(0),
  faceoffWins: integer("faceoff_wins").notNull().default(0),
  // время на льду по периодам в секундах (для расчёта силовых/блоков по периодам)
  periodToi: jsonb("period_toi").$type<number[]>(),
});

export const goalieGames = pgTable("goalie_games", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id")
    .notNull()
    .references(() => matches.id, { onDelete: "cascade" }),
  side: sideEnum("side").notNull(),
  name: text("name").notNull(),
  rawName: text("raw_name"),
  jersey: integer("jersey"),
  toiSeconds: integer("toi_seconds").notNull().default(0),
  saves: integer("saves").notNull().default(0),
  goalsAgainst: integer("goals_against").notNull().default(0),
  result: text("result"), // 'W' | 'L' | null
  // вклад вратаря из строки состава (силовой приём вратаря и т.п.)
  goals: integer("goals").notNull().default(0),
  assists: integer("assists").notNull().default(0),
  shots: integer("shots").notNull().default(0),
  shotsOnGoal: integer("shots_on_goal").notNull().default(0),
  hits: integer("hits").notNull().default(0),
  blocks: integer("blocks").notNull().default(0),
  pim: integer("pim").notNull().default(0),
  periodToi: jsonb("period_toi").$type<number[]>(),
});

export const goals = pgTable("goals", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id")
    .notNull()
    .references(() => matches.id, { onDelete: "cascade" }),
  side: sideEnum("side").notNull(),
  period: integer("period").notNull().default(1),
  time: text("time"), // время от начала матча, напр. 49:36
  strength: text("strength").notNull().default("eq"), // eq | pp | sh
  emptyNet: boolean("empty_net").notNull().default(false),
  scorer: text("scorer").notNull(),
  assist1: text("assist1"),
  assist2: text("assist2"),
  rawStrength: text("raw_strength"),
});

export const penalties = pgTable("penalties", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id")
    .notNull()
    .references(() => matches.id, { onDelete: "cascade" }),
  side: sideEnum("side").notNull(),
  period: integer("period").notNull().default(1),
  time: text("time"),
  minutes: integer("minutes").notNull().default(2),
  player: text("player"), // null => командный штраф
  infraction: text("infraction"),
  coincidental: boolean("coincidental").notNull().default(false), // обоюдное удаление: не даёт большинства
  penaltyShot: boolean("penalty_shot").notNull().default(false), // ШБ: штрафной бросок (0 минут)
});

/** Ручные корректировки таблицы «Большинство и меньшинство (Протокол)»,
 *  чтобы подогнать цифры под официальную таблицу лиги. */
export const specialTeamOverrides = pgTable("special_team_overrides", {
  id: serial("id").primaryKey(),
  team: text("team").notNull().unique(),
  ppAttempts: integer("pp_attempts"), // Бол
  ppGoals: integer("pp_goals"), // ШБ
  ppGoalsAgainst: integer("pp_goals_against"), // ПШБ
  ppTimeMinutes: real("pp_time_minutes"), // ВПБ
  pkAttempts: integer("pk_attempts"), // Мен
  pkGoalsAgainst: integer("pk_goals_against"), // ПШМ
  pkGoals: integer("pk_goals"), // ШМ
  pkTimeMinutes: real("pk_time_minutes"), // ВПМ
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Вместимость домашних арен: одна строка = одна команда-хозяйка (её арена).
 *  Заполняется вручную на странице «Зрители» и используется ТОЛЬКО для новой
 *  инфографики по аншлагам и заполняемости — существующие расчёты не затрагивает. */
export const arenaCapacities = pgTable("arena_capacities", {
  id: serial("id").primaryKey(),
  team: text("team").notNull().unique(),
  arenaName: text("arena_name"),
  capacity: integer("capacity"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ArenaCapacity = typeof arenaCapacities.$inferSelect;

/** Архив «Статистика за сезоны»: одна загрузка = одна команда в одном дивизионе
 *  (сезон + стадия: регулярный чемпионат / плей-ин / плей-офф) с hockey.by. */
export const seasonImports = pgTable(
  "season_imports",
  {
    id: serial("id").primaryKey(),
    url: text("url").notNull(),
    divisionId: integer("division_id").notNull(),
    commandId: integer("command_id").notNull(),
    season: text("season").notNull(), // "2018-2019"
    league: text("league"),
    divisionName: text("division_name"),
    stage: text("stage").notNull().default("regular"), // regular | playin | playoff
    team: text("team").notNull(),
    skaterColumns: jsonb("skater_columns").$type<string[]>().notNull().default([]),
    goalieColumns: jsonb("goalie_columns").$type<string[]>().notNull().default([]),
    importedAt: timestamp("imported_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("season_imports_div_cmd").on(t.divisionId, t.commandId)],
);

export const seasonSkaters = pgTable("season_skaters", {
  id: serial("id").primaryKey(),
  importId: integer("import_id")
    .notNull()
    .references(() => seasonImports.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull(),
  extId: text("ext_id"),
  jersey: integer("jersey"),
  position: text("position"),
  birthDate: text("birth_date"),
  stats: jsonb("stats").$type<Record<string, number | null>>().notNull().default({}),
  extra: jsonb("extra").$type<Record<string, string>>().notNull().default({}),
});

export const seasonGoalies = pgTable("season_goalies", {
  id: serial("id").primaryKey(),
  importId: integer("import_id")
    .notNull()
    .references(() => seasonImports.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull(),
  extId: text("ext_id"),
  jersey: integer("jersey"),
  birthDate: text("birth_date"),
  stats: jsonb("stats").$type<Record<string, number | null>>().notNull().default({}),
  extra: jsonb("extra").$type<Record<string, string>>().notNull().default({}),
});

export type SeasonImport = typeof seasonImports.$inferSelect;
export type SeasonSkater = typeof seasonSkaters.$inferSelect;
export type SeasonGoalie = typeof seasonGoalies.$inferSelect;

export type SpecialTeamOverride = typeof specialTeamOverrides.$inferSelect;

export type Match = typeof matches.$inferSelect;
export type SkaterGame = typeof skaterGames.$inferSelect;
export type GoalieGame = typeof goalieGames.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type Penalty = typeof penalties.$inferSelect;
export type Side = "home" | "away";

// ---------------------------------------------------------------------------
// «Обновить статистику игроков»: найденные расхождения с протоколами хранятся,
// пока пользователь не закроет плашку (решения да/нет по каждому изменению).
// ---------------------------------------------------------------------------
export type StatFieldChange = { key: string; label: string; from: string | number | null; to: string | number | null };
export type StatChange = {
  id: string;
  kind: "update" | "add" | "remove";
  matchId: number;
  date: string;
  matchLabel: string;
  side: "home" | "away";
  team: string;
  name: string;
  jersey: number | null;
  skaterId: number | null;
  fields: StatFieldChange[];
  newRow: Record<string, unknown> | null;
  status: "pending" | "applied" | "rejected";
};

export const statRefreshRuns = pgTable("stat_refresh_runs", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  checked: integer("checked").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  failedInfo: jsonb("failed_info").$type<string[]>().notNull().default([]),
  changes: jsonb("changes").$type<StatChange[]>().notNull().default([]),
  dismissed: boolean("dismissed").notNull().default(false),
});
export type StatRefreshRun = typeof statRefreshRuns.$inferSelect;

// ---------------------------------------------------------------------------
// Архив старых протоколов (hockey.by/new-admin/games/<id>/?print=protocol),
// сезоны 2018/19 … 2026/27: поматчевая статистика игроков и вратарей —
// для статистики «против конкретной команды» и анализа предстоящих матчей.
// ---------------------------------------------------------------------------
export const histGames = pgTable("hist_games", {
  id: serial("id").primaryKey(),
  extId: integer("ext_id").notNull().unique(),
  sourceUrl: text("source_url").notNull(),
  date: date("date").notNull(),
  season: text("season").notNull(), // "2018-2019"
  competition: text("competition"),
  gameNo: text("game_no"),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  homeScore: integer("home_score").notNull().default(0),
  awayScore: integer("away_score").notNull().default(0),
  attendance: integer("attendance"),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
  /** Подробности протокола для карточки матча (периоды, броски, голы, удаления, вратари).
   *  Заполняется при загрузке или лениво при первом открытии карточки. */
  details: jsonb("details").$type<HistDetails>(),
});

export const histPlayerGames = pgTable("hist_player_games", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id")
    .notNull()
    .references(() => histGames.id, { onDelete: "cascade" }),
  side: sideEnum("side").notNull(),
  team: text("team").notNull(),
  opponent: text("opponent").notNull(),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull(),
  jersey: integer("jersey"),
  position: text("position"),
  played: boolean("played").notNull().default(true),
  goals: integer("goals").notNull().default(0),
  assists: integer("assists").notNull().default(0),
  ppGoals: integer("pp_goals").notNull().default(0),
  shGoals: integer("sh_goals").notNull().default(0),
  pim: integer("pim").notNull().default(0),
});

export const histGoalieGames = pgTable("hist_goalie_games", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id")
    .notNull()
    .references(() => histGames.id, { onDelete: "cascade" }),
  side: sideEnum("side").notNull(),
  team: text("team").notNull(),
  opponent: text("opponent").notNull(),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull(),
  jersey: integer("jersey"),
  toiSeconds: integer("toi_seconds").notNull().default(0),
  goalsAgainst: integer("goals_against").notNull().default(0),
  saves: integer("saves"),
  won: boolean("won").notNull().default(false),
});

export type HistGame = typeof histGames.$inferSelect;
export type HistPlayerGame = typeof histPlayerGames.$inferSelect;
export type HistGoalieGame = typeof histGoalieGames.$inferSelect;

/** Ключ-значение: режим сезона (РЧ / плей-офф) и прочие настройки приложения. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
export type AppSetting = typeof appSettings.$inferSelect;
