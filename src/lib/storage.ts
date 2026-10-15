"use client";

export const SNAPSHOT_KEY = "ledovyi-protokol:snapshot";

/** Записать снимок в localStorage браузера. */
export function saveSnapshotLocal(snap: unknown): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
  } catch (e) {
    console.warn("localStorage недоступен или переполнен", e);
  }
}

/** Прочитать снимок из localStorage. */
export function loadSnapshotLocal(): string | null {
  try {
    return localStorage.getItem(SNAPSHOT_KEY);
  } catch {
    return null;
  }
}

/** Актуализировать localStorage свежими данными с сервера. */
export async function syncSnapshotToLocal(): Promise<void> {
  try {
    const res = await fetch("/api/export", { cache: "no-store" });
    if (!res.ok) return;
    const snap = await res.json();
    saveSnapshotLocal(snap);
  } catch {
    // сеть недоступна — оставляем то, что есть
  }
}

/** Скачать все данные файлом (из localStorage, при отсутствии — с сервера). */
export async function downloadJson(): Promise<void> {
  let raw = loadSnapshotLocal();
  if (!raw) {
    await syncSnapshotToLocal();
    raw = loadSnapshotLocal();
  }
  if (!raw) return;
  const blob = new Blob([raw], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `hockey-data-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
