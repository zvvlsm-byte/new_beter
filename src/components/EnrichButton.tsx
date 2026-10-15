"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** «Волшебная кнопка»: догружает недостающее количество зрителей по ссылкам протоколов. */
export function EnrichButton({ missingCount }: { missingCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (missingCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        className="btn"
        disabled={busy}
        title="Пройти по сохранённым ссылкам протоколов и дописать количество зрителей там, где его нет"
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const res = await fetch("/api/enrich", { method: "POST" });
            const d = await res.json();
            if (d.error) {
              setMsg(`Ошибка: ${d.error}`);
            } else {
              setMsg(`Догружено зрителей: ${d.updated}${d.failed ? `, не удалось: ${d.failed}` : ""}`);
            }
            router.refresh();
          } catch {
            setMsg("Не удалось догрузить зрителей");
          } finally {
            setBusy(false);
          }
        }}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8L12 3z" />
          <path d="M19 14l.9 2.3L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.7L19 14z" />
        </svg>
        {busy ? "Догружаем…" : "Догрузить зрителей"}
      </button>
      {msg && <span className="text-xs text-ink-soft">{msg}</span>}
    </div>
  );
}
