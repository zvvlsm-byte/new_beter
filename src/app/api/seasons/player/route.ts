import { NextResponse } from "next/server";
import { loadSeasonsPayload } from "@/lib/seasonsDb";
import { nameKey } from "@/lib/seasonStats";

export const dynamic = "force-dynamic";

/** Архивная статистика одного игрока/вратаря (по имени «Фамилия Имя»). */
export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name") ?? "";
  if (!name.trim()) return NextResponse.json({ error: "Пустое имя" }, { status: 400 });
  const payload = await loadSeasonsPayload({ nameKey: nameKey(name) });
  const used = new Set([...payload.skaters, ...payload.goalies].map((r) => r.importId));
  return NextResponse.json({ ...payload, imports: payload.imports.filter((i) => used.has(i.id)) });
}
