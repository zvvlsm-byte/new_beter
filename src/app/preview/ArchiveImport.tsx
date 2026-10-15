"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HistGame } from "@/db/schema";
import { fmtDateRu } from "@/lib/clean";
import { seasonLabel } from "@/lib/seasonStats";
import { HistMatchCard } from "@/components/HistMatchCard";

type Summary = {
  bySeason: { season: string; n: number; minExt: number; maxExt: number }[];
  latest: (Omit<HistGame, "importedAt"> & { importedAt: string })[];
};

type LogLine = { id: number; ok: boolean; text: string; dup?: boolean; existingId?: number };

/** Архив старых протоколов (hockey.by/new-admin/games/<id>/?print=protocol): одиночная и пакетная загрузка. */
export function ArchiveImport() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [url, setUrl] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; ok: number; fail: number; dup?: number } | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const stopRef = useRef(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState<{ text: string; existingId?: number } | null>(null);

  const load = useCallback(() => {
    fetch("/api/history/games")
      .then((r) => r.json())
      .then(setSummary)
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function importOne(body: { url?: string; id?: number; writeFile?: boolean; force?: boolean }): Promise<LogLine> {
    try {
      const res = await fetch("/api/history/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      const id = body.id ?? d.game?.extId ?? d.id ?? 0;
      if (d.ok) {
        const g = d.game;
        return { id, ok: true, text: `${fmtDateRu(g.date)} · ${g.homeTeam} ${g.homeScore}:${g.awayScore} ${g.awayTeam} · ${g.competition ?? ""}` };
      }
      if (d.duplicate) return { id, ok: false, dup: true, text: d.error || "уже есть в архиве", existingId: d.existing?.id };
      return { id, ok: false, text: d.error || "ошибка" };
    } catch {
      return { id: body.id ?? 0, ok: false, text: "сетевая ошибка" };
    }
  }

  async function single() {
    if (!url.trim()) return;
    setRunning(true);
    setNotice(null);
    let line = await importOne({ url });
    // защита от дубля: протокол уже в архиве — сообщаем и спрашиваем, перезагружать ли
    if (line.dup) {
      setNotice({ text: line.text, existingId: line.existingId });
      if (confirm(`${line.text}\n\nПовторно загружать не нужно. Перезаписать протокол заново?`)) {
        line = await importOne({ url, force: true });
        setNotice(null);
      }
    }
    setLog((l) => [line, ...l].slice(0, 300));
    setRunning(false);
    if (line.ok || line.dup) setUrl("");
    load();
  }

  async function range() {
    const a = parseInt(from, 10);
    const b = parseInt(to, 10);
    if (!a || !b) return;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (hi - lo > 5000) {
      alert("Не больше 5000 протоколов за один запуск");
      return;
    }
    stopRef.current = false;
    setRunning(true);
    const total = hi - lo + 1;
    let done = 0, ok = 0, fail = 0, dup = 0;
    setProgress({ done, total, ok, fail, dup });
    let next = lo;
    const worker = async () => {
      while (!stopRef.current && next <= hi) {
        const id = next++;
        const line = await importOne({ id, writeFile: false });
        done++;
        if (line.ok) ok++;
        else if (line.dup) dup++;
        else fail++;
        setProgress({ done, total, ok, fail, dup });
        setLog((l) => [line, ...l].slice(0, 300));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    await fetch("/api/history/import", { method: "PUT" }).catch(() => {});
    setRunning(false);
    load();
  }

  async function remove(id: number) {
    if (!confirm("Удалить протокол из архива?")) return;
    await fetch(`/api/history/games?id=${id}`, { method: "DELETE" });
    load();
  }

  const totalGames = summary?.bySeason.reduce((a, s) => a + s.n, 0) ?? 0;

  return (
    <section className="space-y-3">
      <div className="card p-4">
        <h2 className="text-sm font-extrabold tracking-wide uppercase">Архив старых протоколов</h2>
        <p className="mt-1 text-xs text-ink-soft">
          Протоколы прошлых матчей (сезоны 2018/19 – 2026/27) вида https://hockey.by/new-admin/games/11575/?print=protocol.
          Из каждого протокола сохраняются составы, голы и передачи, штрафы, вратари (время, пропущенные, сейвы). Эти данные
          используются в анализе матчей и в карточках игроков/вратарей («Против команд»). Номер в ссылке — id протокола:
          можно загрузить целый диапазон id (протоколы без составов и несуществующие страницы пропускаются).
        </p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div>
            <span className="mb-1 block text-xs font-bold text-ink-soft">Один протокол</span>
            <div className="flex gap-2">
              <input className="inp" placeholder="https://hockey.by/new-admin/games/11575/?print=protocol" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && single()} />
              <button className="btn-primary whitespace-nowrap" disabled={running || !url.trim()} onClick={single}>Загрузить</button>
            </div>
          </div>
          <div>
            <span className="mb-1 block text-xs font-bold text-ink-soft">Диапазон id протоколов</span>
            <div className="flex flex-wrap items-center gap-2">
              <input className="num w-28" placeholder="с 11575" value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ""))} />
              <span className="text-ink-soft">—</span>
              <input className="num w-28" placeholder="по 11700" value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ""))} />
              {!running ? (
                <button className="btn" disabled={!from || !to} onClick={range}>Загрузить диапазон</button>
              ) : (
                <button className="btn" onClick={() => { stopRef.current = true; }}>Остановить</button>
              )}
            </div>
          </div>
        </div>
        {notice && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-sm">
            <span className="font-semibold text-warn">⚠ {notice.text}</span>
            <span className="flex gap-2">
              {notice.existingId && (
                <button className="btn px-2.5 py-1 text-xs" onClick={() => setOpenId(notice.existingId!)}>Открыть матч</button>
              )}
              <button className="btn px-2.5 py-1 text-xs" onClick={() => setNotice(null)}>✕</button>
            </span>
          </div>
        )}
        {progress && (
          <div className="mt-3">
            <div className="h-2 overflow-hidden rounded bg-line">
              <div className="h-full bg-ice transition-all" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              {progress.done} из {progress.total} · загружено {progress.ok} · пропущено {progress.fail}
              {progress.dup ? ` · уже были в архиве ${progress.dup}` : ""}
              {running ? " · идёт загрузка…" : " · готово"}
            </p>
          </div>
        )}
        {log.length > 0 && (
          <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-line bg-white p-2 font-mono text-[11px]">
            {log.map((l, i) => (
              <div key={i} className={l.ok ? "text-ink" : l.dup ? "text-warn" : "text-ink-soft"}>
                {l.ok ? "✓" : l.dup ? "⚠" : "·"} #{l.id} {l.text}
                {l.dup && l.existingId && (
                  <button className="ml-1 text-ice hover:underline" onClick={() => setOpenId(l.existingId!)}>открыть</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card overflow-x-auto">
        <div className="border-b border-line px-4 py-2">
          <h3 className="text-xs font-extrabold tracking-wide uppercase">В архиве: {totalGames} матчей</h3>
        </div>
        {summary && summary.bySeason.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-4 py-3">
            {summary.bySeason.map((s) => (
              <div key={s.season} className="rounded-md border border-line bg-white px-3 py-1.5 text-xs">
                <b>{seasonLabel(s.season)}</b> · {s.n} матч. <span className="text-ink-soft">(id {s.minExt}–{s.maxExt})</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-4 py-4 text-sm text-ink-soft">Архив пуст — загрузите протоколы выше.</p>
        )}
        {summary && summary.latest.length > 0 && (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["id", "Дата", "Сезон", "Турнир", "Матч", ""].map((h) => <th key={h} className="th text-left">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {summary.latest.slice(0, showAll ? summary.latest.length : 30).map((g) => (
                <tr key={g.id} className="cursor-pointer transition hover:bg-ice-soft/40" onClick={() => setOpenId(g.id)} title="Открыть статистику матча">
                  <td className="td font-mono text-xs"><a className="text-ice hover:underline" href={g.sourceUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Официальный протокол">{g.extId}</a></td>
                  <td className="td font-mono text-xs">{fmtDateRu(g.date)}</td>
                  <td className="td text-xs">{seasonLabel(g.season)}</td>
                  <td className="td text-xs text-ink-soft">{g.competition}</td>
                  <td className="td text-sm">
                    <b>{g.homeTeam}</b>{" "}
                    <button
                      className="rounded bg-ice-soft px-1.5 font-mono font-bold text-ice transition hover:bg-ice hover:text-white"
                      onClick={(e) => { e.stopPropagation(); setOpenId(g.id); }}
                      title="Статистика матча: голы, броски, удаления, вратари, составы"
                    >
                      {g.homeScore}:{g.awayScore}
                    </button>{" "}
                    <b>{g.awayTeam}</b>
                  </td>
                  <td className="td text-right"><button className="btn-danger px-2 py-0.5 text-xs" onClick={(e) => { e.stopPropagation(); remove(g.id); }}>удалить</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {summary && summary.latest.length > 30 && (
          <div className="border-t border-line px-4 py-2">
            <button className="btn px-3 py-1 text-xs" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Свернуть" : `Показать все загруженные (${summary.latest.length})`}
            </button>
          </div>
        )}
        {summary && summary.latest.length > 0 && (
          <p className="border-t border-line px-4 py-2 text-[11px] text-ink-soft">
            Клик по счёту (или строке) — статистика матча прямо здесь: голы, броски, удаления, вратари, составы. Номер id — ссылка на официальный протокол.
          </p>
        )}
      </div>
      {openId !== null && <HistMatchCard id={openId} onClose={() => setOpenId(null)} />}
    </section>
  );
}
