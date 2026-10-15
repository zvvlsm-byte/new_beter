import fs from "fs/promises";
import path from "path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { seasonGoalies, seasonImports, seasonSkaters } from "@/db/schema";
import type { ParsedTeamPage } from "./hockeyby";
import { buildLiveSeasonPayload } from "./liveSeason";
import type { SeasonImportMeta, SeasonRow, SeasonsPayload, Stage } from "./seasonStats";

/** Сохранить (или перезаписать) загрузку одной команды/дивизиона. */
export async function saveSeasonImport(
  page: ParsedTeamPage,
  opts: { stage: Stage; season?: string | null },
): Promise<number> {
  const season = (opts.season || page.season).trim();
  const id = await db.transaction(async (tx) => {
    await tx
      .delete(seasonImports)
      .where(and(eq(seasonImports.divisionId, page.divisionId), eq(seasonImports.commandId, page.commandId)));
    const [ins] = await tx
      .insert(seasonImports)
      .values({
        url: page.url,
        divisionId: page.divisionId,
        commandId: page.commandId,
        season,
        league: page.league,
        divisionName: page.divisionName,
        stage: opts.stage,
        team: page.team,
        skaterColumns: page.skaterColumns,
        goalieColumns: page.goalieColumns,
      })
      .returning({ id: seasonImports.id });
    if (page.skaters.length) {
      await tx.insert(seasonSkaters).values(
        page.skaters.map((p) => ({
          importId: ins.id, name: p.name, nameKey: p.nameKey, extId: p.extId, jersey: p.jersey,
          position: p.position, birthDate: p.birthDate, stats: p.stats, extra: p.extra,
        })),
      );
    }
    if (page.goalies.length) {
      await tx.insert(seasonGoalies).values(
        page.goalies.map((p) => ({
          importId: ins.id, name: p.name, nameKey: p.nameKey, extId: p.extId, jersey: p.jersey,
          birthDate: p.birthDate, stats: p.stats, extra: p.extra,
        })),
      );
    }
    return ins.id;
  });
  await writeSeasonsFile();
  return id;
}

export async function loadSeasonsPayload(filter?: { nameKey?: string; includeLive?: boolean }): Promise<SeasonsPayload> {
  const includeLive = filter?.includeLive !== false;
  const [imps, sk, gl] = await Promise.all([
    db.select().from(seasonImports),
    filter?.nameKey
      ? db.select().from(seasonSkaters).where(eq(seasonSkaters.nameKey, filter.nameKey))
      : db.select().from(seasonSkaters),
    filter?.nameKey
      ? db.select().from(seasonGoalies).where(eq(seasonGoalies.nameKey, filter.nameKey))
      : db.select().from(seasonGoalies),
  ]);
  const skCount = new Map<number, number>();
  const glCount = new Map<number, number>();
  if (!filter?.nameKey) {
    for (const r of sk) skCount.set(r.importId, (skCount.get(r.importId) ?? 0) + 1);
    for (const r of gl) glCount.set(r.importId, (glCount.get(r.importId) ?? 0) + 1);
  }
  const imports: SeasonImportMeta[] = imps.map((i) => ({
    id: i.id,
    url: i.url,
    divisionId: i.divisionId,
    commandId: i.commandId,
    season: i.season,
    league: i.league,
    divisionName: i.divisionName,
    stage: (i.stage as Stage) ?? "regular",
    team: i.team,
    skaterColumns: i.skaterColumns ?? [],
    goalieColumns: i.goalieColumns ?? [],
    importedAt: i.importedAt.toISOString(),
    skaterCount: skCount.get(i.id) ?? 0,
    goalieCount: glCount.get(i.id) ?? 0,
  }));
  const toRow = (r: (typeof sk)[number] | (typeof gl)[number]): SeasonRow => ({
    importId: r.importId,
    name: r.name,
    nameKey: r.nameKey,
    extId: r.extId,
    jersey: r.jersey,
    position: "position" in r ? r.position : null,
    birthDate: r.birthDate,
    stats: r.stats ?? {},
  });
  const base: SeasonsPayload = { imports, skaters: sk.map(toRow), goalies: gl.map(toRow) };
  if (!includeLive) return base;
  try {
    let live = await buildLiveSeasonPayload();
    if (filter?.nameKey) {
      const key = filter.nameKey;
      live = {
        ...live,
        skaters: live.skaters.filter((r) => r.nameKey === key),
        goalies: live.goalies.filter((r) => r.nameKey === key),
      };
      const used = new Set([...live.skaters, ...live.goalies].map((r) => r.importId));
      live = { ...live, imports: live.imports.filter((i) => used.has(i.id)) };
    }
    return {
      imports: [...base.imports, ...live.imports],
      skaters: [...base.skaters, ...live.skaters],
      goalies: [...base.goalies, ...live.goalies],
    };
  } catch (e) {
    console.error("[seasons] не удалось добавить текущий сезон:", e);
    return base;
  }
}

// ---------------------------------------------------------------------------
// Файл-дубликат data/seasons.json
// ---------------------------------------------------------------------------

const FILE = () => path.join(process.cwd(), "data", "seasons.json");

type SeasonsFile = {
  version: 1;
  app: "ledovyi-protokol-seasons";
  exportedAt: string;
  imports: {
    meta: typeof seasonImports.$inferSelect;
    skaters: (typeof seasonSkaters.$inferSelect)[];
    goalies: (typeof seasonGoalies.$inferSelect)[];
  }[];
};

export async function buildSeasonsFile(): Promise<SeasonsFile> {
  const [imps, sk, gl] = await Promise.all([
    db.select().from(seasonImports),
    db.select().from(seasonSkaters),
    db.select().from(seasonGoalies),
  ]);
  return {
    version: 1,
    app: "ledovyi-protokol-seasons",
    exportedAt: new Date().toISOString(),
    imports: imps.map((m) => ({
      meta: m,
      skaters: sk.filter((r) => r.importId === m.id),
      goalies: gl.filter((r) => r.importId === m.id),
    })),
  };
}

export async function writeSeasonsFile(): Promise<void> {
  try {
    const data = await buildSeasonsFile();
    await fs.mkdir(path.dirname(FILE()), { recursive: true });
    await fs.writeFile(FILE(), JSON.stringify(data), "utf8");
  } catch (e) {
    console.error("[seasons] не удалось записать файл:", e);
  }
}

/** Восстановить архив из data/seasons.json, если таблицы пусты. */
export async function restoreSeasonsFromFileIfEmpty(): Promise<number> {
  const existing = await db.select({ id: seasonImports.id }).from(seasonImports).limit(1);
  if (existing.length) return 0;
  let raw: string;
  try {
    raw = await fs.readFile(FILE(), "utf8");
  } catch {
    return 0;
  }
  const data = JSON.parse(raw) as SeasonsFile;
  if (!data || !Array.isArray(data.imports)) return 0;
  let n = 0;
  await db.transaction(async (tx) => {
    for (const e of data.imports) {
      const { id: _id, importedAt, ...meta } = e.meta;
      void _id;
      const [ins] = await tx
        .insert(seasonImports)
        .values({ ...meta, importedAt: importedAt ? new Date(importedAt) : new Date() })
        .returning({ id: seasonImports.id });
      const sk = e.skaters.map(({ id: _i, importId: _m, ...r }) => ({ ...r, importId: ins.id }));
      const gl = e.goalies.map(({ id: _i, importId: _m, ...r }) => ({ ...r, importId: ins.id }));
      if (sk.length) await tx.insert(seasonSkaters).values(sk);
      if (gl.length) await tx.insert(seasonGoalies).values(gl);
      n += 1;
    }
  });
  return n;
}
