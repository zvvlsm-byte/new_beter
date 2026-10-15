"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Stage } from "@/lib/seasonStats";

export function SeasonControls({
  matchCount,
  playoffCount,
  activeStage,
}: {
  matchCount: number;
  playoffCount: number;
  activeStage: Stage;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"archive" | "mode" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const inPlayoff = activeStage === "playoff" || activeStage === "playin";

  async function toPlayoff() {
    if (
      !confirm(
        "Переключить на плей-офф?\n\nРегулярный чемпионат не очищается. Новые протоколы будут сохраняться как плей-офф (если в протоколе не указано иное). В «Игроках» и «Вратарях» появится фильтр РЧ / плей-офф, в турнирной таблице — отдельный блок плей-офф.",
      )
    ) {
      return;
    }
    setBusy("mode");
    setMsg(null);
    try {
      const r = await fetch("/api/season-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "playoff" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Не удалось переключить");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function toRegular() {
    if (!confirm("Вернуться к регулярному чемпионату? Новые протоколы снова будут сохраняться как РЧ. Уже загруженные матчи плей-офф не удаляются.")) return;
    setBusy("mode");
    setMsg(null);
    try {
      const r = await fetch("/api/season-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "regular" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Не удалось переключить");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function toArchive() {
    if (!matchCount) {
      alert("В текущем сезоне нет матчей.");
      return;
    }
    const po = playoffCount ? `\nиз них плей-офф: ${playoffCount}` : "";
    if (
      !confirm(
        `Перенести ${matchCount} матч. текущего сезона в архив?${po}\n\nМатчи сохранятся в «Статистике за сезоны» (отдельный сезон + сумма «за все время») и в архиве протоколов.\nТурнирная таблица, игроки, вратари и статистика дня очистятся под новый сезон.\nЭто нельзя отменить из интерфейса.`,
      )
    ) {
      return;
    }
    if (!confirm("Точно в архив? Текущие протоколы исчезнут со страниц «Матчи», «Игроки», «Вратари» и «Турнирная таблица».")) return;
    setBusy("archive");
    setMsg(null);
    try {
      const r = await fetch("/api/archive-season", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Не удалось архивировать");
      setMsg(`В архив: ${d.matches} матч., ${d.seasonImports} команд в статистике сезонов.`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {inPlayoff ? (
        <button className="btn" disabled={busy !== null} onClick={toRegular} title="Новые протоколы снова как регулярный чемпионат">
          {busy === "mode" ? "…" : "Вернуть РЧ"}
        </button>
      ) : (
        <button className="btn" disabled={busy !== null} onClick={toPlayoff} title="Новые протоколы — плей-офф; РЧ не очищается">
          {busy === "mode" ? "…" : "Переключить на плей-офф"}
        </button>
      )}
      <button
        className="btn-danger border border-bad/30 bg-bad/10 px-3"
        disabled={busy !== null || !matchCount}
        onClick={toArchive}
        title="Все текущие матчи — в архив сезонов, таблицы очищаются"
      >
        {busy === "archive" ? "Переносим…" : "В архив"}
      </button>
      {inPlayoff && (
        <span className="badge bg-accent/15 text-accent">режим: плей-офф</span>
      )}
      {msg && <span className="text-xs text-ink-soft">{msg}</span>}
    </div>
  );
}
