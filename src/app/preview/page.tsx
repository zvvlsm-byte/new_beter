import { PreviewView } from "./PreviewView";
import { ArchiveImport } from "./ArchiveImport";

export const dynamic = "force-dynamic";

export default function PreviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Анализ матча</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Вставьте ссылку на предстоящий матч с hockey.by (например, https://hockey.by/gamecenter/441910/) — будут
          показаны серии игроков из заявки, их статистика против соперника за все сезоны, личные встречи, форма команд
          и интересные факты. Статистика прошлых сезонов берётся из архива старых протоколов (загрузка — ниже).
        </p>
      </div>
      <PreviewView />
      <ArchiveImport />
    </div>
  );
}
