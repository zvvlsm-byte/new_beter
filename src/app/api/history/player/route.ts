import { NextResponse } from "next/server";
import { loadGoalieLogs, loadSkaterLogs } from "@/lib/historyDb";
import { nameKey } from "@/lib/seasonStats";

export const dynamic = "force-dynamic";

/** Поматчевые логи игрока/вратаря: архив старых протоколов + матчи текущей базы. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const name = sp.get("name") ?? "";
  const kind = sp.get("kind") === "goalie" ? "goalie" : "skater";
  const key = nameKey(name);
  if (!key) return NextResponse.json({ logs: [] });
  const map = kind === "goalie" ? await loadGoalieLogs([key]) : await loadSkaterLogs([key]);
  return NextResponse.json({ kind, logs: map.get(key) ?? [] });
}
