"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MatchEditor } from "@/components/MatchEditor";
import type { MatchPayload } from "@/lib/api";
import { payloadFromParsed } from "@/lib/api";
import { fmtDateRu } from "@/lib/clean";
import type { ParsedMatch } from "@/lib/types";

type DuplicateInfo = {
  id: number;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
};

type Tab = "url" | "pdf" | "text" | "manual";

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "url", label: "Ссылка на протокол", hint: "Скопируйте адрес протокола с hockey.by (вид ?print=pdfstat) — сервер сам скачает и разберёт данные." },
  { id: "pdf", label: "Файл PDF", hint: "Загрузите сохранённый PDF протокола — текст распознается прямо в браузере." },
  { id: "text", label: "Вставить текст", hint: "Скопируйте текст протокола (например, из печатной версии) и вставьте сюда." },
  { id: "manual", label: "Вручную", hint: "Пустой бланк матча — заполните всё сами." },
];

export default function ImportPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [payload, setPayload] = useState<MatchPayload | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);

  async function restoreFromFile(file: File) {
    setError(null);
    setRestoreMsg(null);
    try {
      const snap = JSON.parse(await file.text()) as { matches?: unknown[] };
      const matchCount = Array.isArray(snap.matches) ? snap.matches.length : 0;
      if (!confirm(`Восстановить ${matchCount} матч. из файла? Текущие данные будут полностью заменены.`)) return;
      const resp = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snap),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Не удалось восстановить данные");
      setRestoreMsg(`Восстановлено матчей: ${data.matches}. Все разделы пересчитаны.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? `Восстановление не удалось: ${e.message}` : "Ошибка чтения файла");
    }
  }

  function startManual() {
    setWarnings([]);
    setDuplicate(null);
    setPayload({
      date: new Date().toISOString().slice(0, 10),
      homeTeam: "", awayTeam: "", homeScore: 0, awayScore: 0,
      winType: "reg", stage: "regular", periods: [{ h: 0, a: 0 }], sourceUrl: "", notes: "", attendance: null,
      skaters: [], goalies: [], goals: [], penalties: [],
    });
  }

  async function runParse(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setWarnings([]);
    setDuplicate(null);
    try {
      const resp = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Не удалось разобрать протокол");
      const parsed = data.parsed as ParsedMatch;
      setWarnings(parsed.warnings);
      setDuplicate((data.duplicateOf as DuplicateInfo | null) ?? null);
      setPayload(payloadFromParsed(parsed));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function extractPdf(file: File) {
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      const pdfjs = await import("pdfjs-dist");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pdfjs as any).GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const items: { s: string; x: number; y: number }[] = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        for (const it of content.items as { str?: string; transform?: number[] }[]) {
          const s = it.str?.trim();
          if (!s || !it.transform) continue;
          items.push({ s, x: it.transform[4], y: vp.height - it.transform[5] + p * 5000 });
        }
      }
      await runParse({ items });
    } catch (e) {
      setError(e instanceof Error ? `Не удалось прочитать PDF: ${e.message}` : "Ошибка чтения PDF");
      setBusy(false);
    }
  }

  if (payload) {
    return (
      <div className="space-y-4">
        <PageHead
          title="Проверьте и дополните протокол"
          sub="Парсер заполнил поля автоматически — всё можно поправить: добавить командные штрафы, удалить лишнее, затем сохранить."
        />
        {duplicate && (
          <div className="card border-warn/50 bg-warn/10 px-4 py-3">
            <p className="text-sm font-bold text-warn">⚠ Такой протокол уже есть в базе</p>
            <p className="mt-1 text-sm text-ink">
              Матч №{duplicate.id}: {duplicate.homeTeam} {duplicate.homeScore}:{duplicate.awayScore} {duplicate.awayTeam} от {fmtDateRu(duplicate.date)}.
              Если сохранить этот протокол ещё раз, в базе появится дубликат и статистика задвоится.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Link href={`/matches/${duplicate.id}`} className="btn">Открыть существующий матч</Link>
              <Link href="/" className="btn">К списку матчей</Link>
              <span className="text-xs text-ink-soft">Если это не дубликат — просто продолжайте редактирование ниже.</span>
            </div>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="card border-warn/40 bg-warn/10 px-4 py-3">
            <p className="mb-1 text-sm font-bold text-warn">На что обратить внимание:</p>
            <ul className="list-disc pl-5 text-sm text-ink">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
        <MatchEditor initial={payload} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHead
        title="Импорт протокола"
        sub="Загрузите протокол матча — данные превратятся в редактируемую таблицу, а после сохранения попадут в турнирную таблицу и статистику."
      />

      <div className="card overflow-hidden">
        <div className="flex flex-wrap border-b border-line">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setError(null); }}
              className={`flex-1 px-4 py-3 text-sm font-bold whitespace-nowrap transition ${
                tab === t.id ? "bg-ink text-white" : "bg-white text-ink-soft hover:bg-paper"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm text-ink-soft">{TABS.find((t) => t.id === tab)?.hint}</p>

          {tab === "url" && (
            <div className="space-y-3">
              <input
                className="inp font-mono text-sm"
                placeholder="https://hockey.by/new-admin/games/22875/?print=pdfstat"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button className="btn-primary" disabled={busy || !url.trim()} onClick={() => runParse({ url: url.trim() })}>
                {busy ? "Загружаем и разбираем…" : "Разобрать протокол"}
              </button>
            </div>
          )}

          {tab === "pdf" && (
            <div className="space-y-3">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line bg-paper/60 px-6 py-10 text-center transition hover:border-ice">
                <svg viewBox="0 0 24 24" className="h-8 w-8 text-ink-soft" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M12 16V4m0 0-4 4m4-4 4 4" />
                  <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                </svg>
                <span className="text-sm font-semibold">{busy ? "Читаем PDF…" : "Выберите PDF-файл протокола"}</span>
                <span className="text-xs text-ink-soft">Файл обрабатывается локально в браузере и никуда не отправляется целиком — только распознанные значения</span>
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void extractPdf(f);
                  }}
                />
              </label>
            </div>
          )}

          {tab === "text" && (
            <div className="space-y-3">
              <textarea
                className="inp min-h-[220px] font-mono text-xs"
                placeholder="Вставьте сюда текст протокола…"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button className="btn-primary" disabled={busy || !text.trim()} onClick={() => runParse({ lines: text.split("\n") })}>
                {busy ? "Разбираем…" : "Разобрать текст"}
              </button>
            </div>
          )}

          {tab === "manual" && (
            <button className="btn-primary" onClick={startManual}>Открыть пустой бланк матча</button>
          )}

          {error && <div className="rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm font-semibold text-bad">{error}</div>}
        </div>
      </div>

      <div className="card space-y-3 p-5">
        <p className="font-bold text-ink">Резервная копия: восстановление из файла</p>
        <p className="text-sm text-ink-soft">
          Кнопка «Скачать JSON» в шапке выгружает все данные файлом. Здесь можно загрузить такой файл обратно —
          например, после переустановки или на другом компьютере.
        </p>
        <label className="btn cursor-pointer">
          Выбрать файл с данными…
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void restoreFromFile(f);
              e.target.value = "";
            }}
          />
        </label>
        {restoreMsg && <div className="rounded-md border border-ok/40 bg-ok/10 px-4 py-3 text-sm font-semibold text-ok">{restoreMsg}</div>}
      </div>

      <div className="card p-5 text-sm leading-relaxed text-ink-soft">
        <p className="mb-2 font-bold text-ink">Как это работает</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Загрузите протокол любым способом — парсер вытащит составы, голы, удаления, вратарей и счёт по периодам.</li>
          <li>
            Проверьте данные: фамилии очищаются от (Л), (ЛИ), (А), (К); командные штрафы добавьте вручную.
            Обоюдные удаления (пара штрафов в одно время) помечаются автоматически — они не дают большинства; поправьте флажок, если парсер ошибся.
          </li>
          <li>Сохраните матч — он сразу участвует в турнирной таблице, статистике игроков, вратарей и штрафов.</li>
        </ol>
      </div>
    </div>
  );
}

function PageHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-soft">{sub}</p>
    </div>
  );
}
