import { NextResponse } from "next/server";
import type { Snapshot } from "@/lib/snapshot";
import { importSnapshot, writeSnapshotFile } from "@/lib/snapshot";

/** Восстановление данных из скачанного ранее JSON-файла (полная замена). */
export async function POST(req: Request) {
  let snap: Snapshot;
  try {
    snap = (await req.json()) as Snapshot;
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать JSON" }, { status: 400 });
  }
  try {
    const count = await importSnapshot(snap);
    await writeSnapshotFile();
    return NextResponse.json({ ok: true, matches: count });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка импорта" },
      { status: 400 },
    );
  }
}
