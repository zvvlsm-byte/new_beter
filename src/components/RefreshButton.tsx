"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Пересчитывает сохранённые матчи из их протоколов по ссылкам (ШБ, обоюдные, зрители, периоды). */
export function RefreshButton({ matchCount }: { matchCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (matchCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        className="btn"
        disabled={busy}
        title="Заново разобрать из протоколов по сохранённым ссылкам: составы (включая сдвиг колонок у матчей с ОТ), вратарей, удаления, зрителей и периоды. Список голов и добавленные вручную командные штрафы сохраняются"
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const res = await fetch("/api/refresh", { method: "POST" });
            const d = await res.json();
            setMsg(
              d.error
                ? `Ошибка: ${d.error}`
                : `Обновлено матчей: ${d.updated}${d.failed ? `, не удалось: ${d.failed}` : ""}`,
            );
            router.refresh();
          } catch {
            setMsg("Не удалось обновить протоколы");
          } finally {
            setBusy(false);
          }
        }}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 11a8 8 0 1 0-2.34 6.34" />
          <path d="M20 4v7h-7" />
        </svg>
        {busy ? "Обновляем…" : "Обновить из протоколов"}
      </button>
      {msg && <span className="text-xs text-ink-soft">{msg}</span>}
    </div>
  );
}
