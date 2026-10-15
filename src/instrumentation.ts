/**
 * Хук запуска сервера: автоматически создаёт таблицы, если их ещё нет.
 * Благодаря этому приложение работает даже без ручного `npx drizzle-kit push` —
 * достаточно поднять сервер, и схема применилась (все операторы идемпотентны).
 */

const DDL = `
DO $$ BEGIN
  CREATE TYPE side AS ENUM ('home', 'away');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE win_type AS ENUM ('reg', 'ot', 'so');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS matches (
  id serial PRIMARY KEY,
  date date NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  home_score integer NOT NULL DEFAULT 0,
  away_score integer NOT NULL DEFAULT 0,
  win_type win_type NOT NULL DEFAULT 'reg',
  periods jsonb NOT NULL DEFAULT '[]',
  source_url text,
  notes text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skater_games (
  id serial PRIMARY KEY,
  match_id integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  side side NOT NULL,
  name text NOT NULL,
  raw_name text,
  jersey integer,
  position text,
  goals integer NOT NULL DEFAULT 0,
  assists integer NOT NULL DEFAULT 0,
  plus_minus integer NOT NULL DEFAULT 0,
  shots integer NOT NULL DEFAULT 0,
  shots_on_goal integer NOT NULL DEFAULT 0,
  hits integer NOT NULL DEFAULT 0,
  blocks integer NOT NULL DEFAULT 0,
  pim integer NOT NULL DEFAULT 0,
  toi_seconds integer NOT NULL DEFAULT 0,
  faceoffs integer NOT NULL DEFAULT 0,
  faceoff_wins integer NOT NULL DEFAULT 0,
  period_toi jsonb
);

CREATE TABLE IF NOT EXISTS goalie_games (
  id serial PRIMARY KEY,
  match_id integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  side side NOT NULL,
  name text NOT NULL,
  raw_name text,
  jersey integer,
  toi_seconds integer NOT NULL DEFAULT 0,
  saves integer NOT NULL DEFAULT 0,
  goals_against integer NOT NULL DEFAULT 0,
  result text
);

CREATE TABLE IF NOT EXISTS goals (
  id serial PRIMARY KEY,
  match_id integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  side side NOT NULL,
  period integer NOT NULL DEFAULT 1,
  time text,
  strength text NOT NULL DEFAULT 'eq',
  empty_net boolean NOT NULL DEFAULT false,
  scorer text NOT NULL,
  assist1 text,
  assist2 text,
  raw_strength text
);

CREATE TABLE IF NOT EXISTS penalties (
  id serial PRIMARY KEY,
  match_id integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  side side NOT NULL,
  period integer NOT NULL DEFAULT 1,
  time text,
  minutes integer NOT NULL DEFAULT 2,
  player text,
  infraction text,
  coincidental boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS special_team_overrides (
  id serial PRIMARY KEY,
  team text NOT NULL UNIQUE,
  pp_attempts integer,
  pp_goals integer,
  pp_goals_against integer,
  pp_time_minutes real,
  pk_attempts integer,
  pk_goals_against integer,
  pk_goals integer,
  pk_time_minutes real,
  updated_at timestamp NOT NULL DEFAULT now()
);

-- колонки, добавленные после первой версии схемы
ALTER TABLE matches ADD COLUMN IF NOT EXISTS attendance integer;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'regular';

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
ALTER TABLE penalties ADD COLUMN IF NOT EXISTS penalty_shot boolean NOT NULL DEFAULT false;
ALTER TABLE goalie_games ADD COLUMN IF NOT EXISTS goals integer NOT NULL DEFAULT 0;
ALTER TABLE goalie_games ADD COLUMN IF NOT EXISTS assists integer NOT NULL DEFAULT 0;
ALTER TABLE goalie_games ADD COLUMN IF NOT EXISTS shots integer NOT NULL DEFAULT 0;
ALTER TABLE goalie_games ADD COLUMN IF NOT EXISTS shots_on_goal integer NOT NULL DEFAULT 0;
ALTER TABLE goalie_games ADD COLUMN IF NOT EXISTS hits integer NOT NULL DEFAULT 0;
ALTER TABLE goalie_games ADD COLUMN IF NOT EXISTS blocks integer NOT NULL DEFAULT 0;
ALTER TABLE goalie_games ADD COLUMN IF NOT EXISTS pim integer NOT NULL DEFAULT 0;
ALTER TABLE goalie_games ADD COLUMN IF NOT EXISTS period_toi jsonb;

-- вместимость домашних арен (страница «Зрители» → инфографика по аншлагам)
CREATE TABLE IF NOT EXISTS arena_capacities (
  id serial PRIMARY KEY,
  team text NOT NULL UNIQUE,
  arena_name text,
  capacity integer,
  updated_at timestamp NOT NULL DEFAULT now()
);

-- архив «Статистика за сезоны» (hockey.by)
CREATE TABLE IF NOT EXISTS season_imports (
  id serial PRIMARY KEY,
  url text NOT NULL,
  division_id integer NOT NULL,
  command_id integer NOT NULL,
  season text NOT NULL,
  league text,
  division_name text,
  stage text NOT NULL DEFAULT 'regular',
  team text NOT NULL,
  skater_columns jsonb NOT NULL DEFAULT '[]',
  goalie_columns jsonb NOT NULL DEFAULT '[]',
  imported_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS season_imports_div_cmd ON season_imports (division_id, command_id);

CREATE TABLE IF NOT EXISTS season_skaters (
  id serial PRIMARY KEY,
  import_id integer NOT NULL REFERENCES season_imports(id) ON DELETE CASCADE,
  name text NOT NULL,
  name_key text NOT NULL,
  ext_id text,
  jersey integer,
  position text,
  birth_date text,
  stats jsonb NOT NULL DEFAULT '{}',
  extra jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS season_goalies (
  id serial PRIMARY KEY,
  import_id integer NOT NULL REFERENCES season_imports(id) ON DELETE CASCADE,
  name text NOT NULL,
  name_key text NOT NULL,
  ext_id text,
  jersey integer,
  birth_date text,
  stats jsonb NOT NULL DEFAULT '{}',
  extra jsonb NOT NULL DEFAULT '{}'
);

-- «Обновить статистику игроков»: найденные изменения до закрытия плашки
CREATE TABLE IF NOT EXISTS stat_refresh_runs (
  id serial PRIMARY KEY,
  created_at timestamp NOT NULL DEFAULT now(),
  checked integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  failed_info jsonb NOT NULL DEFAULT '[]',
  changes jsonb NOT NULL DEFAULT '[]',
  dismissed boolean NOT NULL DEFAULT false
);

-- архив старых протоколов (статистика против соперников, анализ матчей)
CREATE TABLE IF NOT EXISTS hist_games (
  id serial PRIMARY KEY,
  ext_id integer NOT NULL UNIQUE,
  source_url text NOT NULL,
  date date NOT NULL,
  season text NOT NULL,
  competition text,
  game_no text,
  home_team text NOT NULL,
  away_team text NOT NULL,
  home_score integer NOT NULL DEFAULT 0,
  away_score integer NOT NULL DEFAULT 0,
  attendance integer,
  imported_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hist_player_games (
  id serial PRIMARY KEY,
  game_id integer NOT NULL REFERENCES hist_games(id) ON DELETE CASCADE,
  side side NOT NULL,
  team text NOT NULL,
  opponent text NOT NULL,
  name text NOT NULL,
  name_key text NOT NULL,
  jersey integer,
  position text,
  played boolean NOT NULL DEFAULT true,
  goals integer NOT NULL DEFAULT 0,
  assists integer NOT NULL DEFAULT 0,
  pp_goals integer NOT NULL DEFAULT 0,
  sh_goals integer NOT NULL DEFAULT 0,
  pim integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS hist_player_games_key ON hist_player_games (name_key);

CREATE TABLE IF NOT EXISTS hist_goalie_games (
  id serial PRIMARY KEY,
  game_id integer NOT NULL REFERENCES hist_games(id) ON DELETE CASCADE,
  side side NOT NULL,
  team text NOT NULL,
  opponent text NOT NULL,
  name text NOT NULL,
  name_key text NOT NULL,
  jersey integer,
  toi_seconds integer NOT NULL DEFAULT 0,
  goals_against integer NOT NULL DEFAULT 0,
  saves integer,
  won boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS hist_goalie_games_key ON hist_goalie_games (name_key);

-- подробности старого протокола для карточки матча в архиве
ALTER TABLE hist_games ADD COLUMN IF NOT EXISTS details jsonb;
`;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[instrumentation] DATABASE_URL не задан — пропускаю инициализацию схемы");
    return;
  }
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url });
    try {
      await pool.query(DDL);
      console.log("[instrumentation] схема БД проверена/создана");
    } finally {
      await pool.end();
    }
    // автовосстановление данных из файлов проекта, если БД пустая
    try {
      const { restoreMatchesFromFileIfEmpty } = await import("./lib/restore");
      const n = await restoreMatchesFromFileIfEmpty();
      if (n) console.log(`[instrumentation] восстановлено матчей из data/snapshot.json: ${n}`);
    } catch (e) {
      console.error("[instrumentation] не удалось восстановить матчи:", e instanceof Error ? e.message : e);
    }
    try {
      const { restoreSeasonsFromFileIfEmpty } = await import("./lib/seasonsDb");
      const n = await restoreSeasonsFromFileIfEmpty();
      if (n) console.log(`[instrumentation] восстановлено загрузок сезонов из data/seasons.json: ${n}`);
    } catch (e) {
      console.error("[instrumentation] не удалось восстановить архив сезонов:", e instanceof Error ? e.message : e);
    }
    try {
      const { restoreHistoryFromFileIfEmpty } = await import("./lib/historyDb");
      const n = await restoreHistoryFromFileIfEmpty();
      if (n) console.log(`[instrumentation] восстановлено старых протоколов из data/history.json: ${n}`);
    } catch (e) {
      console.error("[instrumentation] не удалось восстановить архив протоколов:", e instanceof Error ? e.message : e);
    }
  } catch (e) {
    console.error(
      "[instrumentation] не удалось инициализировать схему БД (проверьте, запущен ли PostgreSQL и DATABASE_URL):",
      e instanceof Error ? e.message : e,
    );
  }
}
