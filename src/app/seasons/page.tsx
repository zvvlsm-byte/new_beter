import { loadSeasonsPayload } from "@/lib/seasonsDb";
import { SeasonsView } from "./SeasonsView";

export const dynamic = "force-dynamic";

export default async function SeasonsPage() {
  const payload = await loadSeasonsPayload();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Статистика за сезоны</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Архив сезонов с hockey.by (с 2018/19) плюс текущий сезон из загруженных протоколов — он идёт отдельной
          строкой и входит в сумму «за все время». Вставьте ссылку на страницу команды — парсер сам вытащит
          сезон, команду и все столбцы, которые велись в тот сезон. Загруженное сохраняется и остаётся.
          Регулярный чемпионат, плей-ин и плей-офф хранятся отдельно и суммируются. Данные отсюда идут только в
          карточки игроков/вратарей и в этот раздел — турнирную таблицу не затрагивают.
        </p>
      </div>
      <SeasonsView initial={payload} />
    </div>
  );
}
