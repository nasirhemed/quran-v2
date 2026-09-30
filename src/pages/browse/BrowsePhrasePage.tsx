import { useQuery } from "@tanstack/react-query";
import { fetchSurahs } from "@/lib/data";
import { surahTname } from "@/lib/quranMeta";
import { useBrowseIndex } from "@/hooks/useBrowseIndex";
import {
  Breadcrumbs,
  Loading,
  OccurrenceRow,
  phraseColor,
  useRestoreScroll,
} from "@/components/browse/BrowseParts";

export default function BrowsePhrasePage({ id }: { id: string }) {
  const { data: surahs } = useQuery({ queryKey: ["surahs"], queryFn: fetchSurahs });
  const { data: index } = useBrowseIndex();
  useRestoreScroll(!!surahs && !!index);

  if (!surahs || !index) return <Loading />;
  const phrase = index.phrases.get(id);
  if (!phrase) return <div className="py-24 text-center text-muted">No such phrase.</div>;

  const bySurah = new Map<number, typeof phrase.occurrences>();
  for (const o of phrase.occurrences) {
    const surah = index.verses.get(o.key)!.surah;
    if (!bySurah.has(surah)) bySurah.set(surah, []);
    bySurah.get(surah)!.push(o);
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Breadcrumbs items={[{ label: "Browse", href: "/browse" }, { label: "Phrase" }]} />

      <div className="text-center mb-8">
        <div dir="rtl" lang="ar" className="font-arabic text-3xl leading-loose text-ink">
          <span className="rounded-sm px-1" style={{ background: phraseColor(0) }}>
            {phrase.text}
          </span>
        </div>
        <div className="text-sm text-muted mt-1">
          {phrase.occurrences.length} verses in {phrase.surahCount}{" "}
          {phrase.surahCount === 1 ? "surah" : "surahs"}
        </div>
      </div>

      <div className="space-y-6">
        {[...bySurah].map(([surah, occurrences]) => (
          <section key={surah}>
            <h2 className="text-sm font-semibold text-ink-soft mb-2">
              {surah} · {surahTname(surahs, surah)}
              <span className="ml-2 text-xs font-normal text-faint">{occurrences.length}</span>
            </h2>
            <div className="space-y-2">
              {occurrences.map((o) => (
                <OccurrenceRow
                  key={o.key}
                  verse={index.verses.get(o.key)!}
                  label={o.key}
                  marks={[{ ranges: o.ranges, color: phraseColor(0) }]}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
