"use client";

import { useEffect } from "react";
import { syncSnapshotToLocal } from "@/lib/storage";

/** При каждой загрузке страницы дублирует актуальные данные в localStorage. */
export function StorageSync() {
  useEffect(() => {
    void syncSnapshotToLocal();
  }, []);
  return null;
}
