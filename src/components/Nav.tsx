"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { downloadJson } from "@/lib/storage";

const LINKS: { href: string; label: string; accent?: boolean }[] = [
  { href: "/", label: "Матчи" },
  { href: "/import", label: "Импорт протокола", accent: true },
  { href: "/standings", label: "Турнирная таблица" },
  { href: "/periods", label: "Периоды" },
  { href: "/day", label: "Статистика дня" },
  { href: "/players", label: "Игроки" },
  { href: "/goalies", label: "Вратари" },
  { href: "/penalties", label: "Штрафы" },
  { href: "/attendance", label: "Зрители" },
  { href: "/seasons", label: "Статистика за сезоны" },
  { href: "/preview", label: "Анализ матча" },
];

export function Nav() {
  const path = usePathname();
  const [saving, setSaving] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-black/40 bg-[#141a19] text-white">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded bg-accent">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <ellipse cx="12" cy="12" rx="9" ry="4.5" />
              <path d="M3 12v3c0 2.5 4 4.5 9 4.5s9-2 9-4.5v-3" />
            </svg>
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-extrabold tracking-wide">ЛЕДОВЫЙ ПРОТОКОЛ</span>
            <span className="block text-[11px] text-white/50">статистика сезона — локально и бесплатно</span>
          </span>
        </Link>
        <nav className="flex flex-wrap items-center gap-1">
          {LINKS.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={
                  l.accent
                    ? "rounded-md bg-accent px-3 py-1.5 text-sm font-bold text-white transition hover:bg-accent-dark"
                    : `rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                        active ? "bg-white/15 text-white" : "text-white/65 hover:bg-white/10 hover:text-white"
                      }`
                }
              >
                {l.label}
              </Link>
            );
          })}
          <button
            className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-white/25 px-3 py-1.5 text-sm font-bold text-white/90 transition hover:bg-white/10"
            title="Выгрузить все накопленные данные файлом в папку «Загрузки»"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await downloadJson();
              } finally {
                setSaving(false);
              }
            }}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
              <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            {saving ? "Сохраняем…" : "Скачать JSON"}
          </button>
        </nav>
      </div>
    </header>
  );
}
