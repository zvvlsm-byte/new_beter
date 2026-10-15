import { NextResponse } from "next/server";
import { buildSnapshot, writeSnapshotFile } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

/** Отдаёт весь накопленный снимок данных и заодно обновляет локальный файл. */
export async function GET() {
  const snap = await buildSnapshot();
  await writeSnapshotFile();
  return NextResponse.json(snap);
}
