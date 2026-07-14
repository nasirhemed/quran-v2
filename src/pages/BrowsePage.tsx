import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  fetchJuzMetadata,
  fetchMutashabihatList,
  fetchSimilarAyahDetails,
  fetchSimilarAyahList,
  fetchSurahs,
} from "@/lib/data";
import HighlightedAyah from "@/components/HighlightedAyah";
import { getJuzForVerse, parseVerseKey, surahTname } from "@/lib/quranMeta";
import type { JuzMeta, PhraseListItem, SimilarAyahListItem, SurahMeta } from "@/types";

type Tab = "phrases" | "similar";

interface SurahGroup<T> {
  surahNum: number;
  items: T[];
}

interface JuzGroup<T> {
  juz: number;
  surahGroups: SurahGroup<T>[];
}

/**
 * Groups items under Juz > Surah by their occurrences. An item shows up under
 * every surah it occurs in (deduplicated within each surah group).
 */
function groupByJuzSurah<T>(
  items: T[],
  juzs: JuzMeta[],
  getOccurrences: (item: T) => string[]
): JuzGroup<T>[] {
  const juzMap = new Map<number, Map<number, Set<number>>>();

  items.forEach((item, idx) => {
    for (const key of getOccurrences(item)) {
      const juz = getJuzForVerse(juzs, key);
      const { surah } = parseVerseKey(key);
      if (!juzMap.has(juz)) juzMap.set(juz, new Map());
      const surahMap = juzMap.get(juz)!;
      if (!surahMap.has(surah)) surahMap.set(surah, new Set());
      surahMap.get(surah)!.add(idx);
    }
  });

  return Array.from(juzMap.keys())
    .sort((a, b) => a - b)
    .map((juz) => {
      const surahMap = juzMap.get(juz)!;
      return {
        juz,
        surahGroups: Array.from(surahMap.keys())
          .sort((a, b) => a - b)
          .map((surahNum) => ({
            surahNum,
            items: Array.from(surahMap.get(surahNum)!)
              .sort((a, b) => a - b)
              .map((i) => items[i]),
          })),
      };
    });
}

function OccurrenceChips({
  occurrences,
  surahs,
}: {
  occurrences: string[];
  surahs: SurahMeta[];
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? occurrences : occurrences.slice(0, 8);
  const hidden = occurrences.length - shown.length;

  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((key) => {
        const { surah, ayah } = parseVerseKey(key);
        return (
          <Link
            key={key}
            href={`/read?surah=${surah}&ayah=${ayah}`}
            className="px-2 py-0.5 rounded-full text-xs font-medium bg-card2 border border-edge text-muted hover:text-primary hover:border-primary transition-colors"
            title={`Open ${key} in the reader`}
          >
            {key} · {surahTname(surahs, surah)}
          </Link>
        );
      })}
      {hidden > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="px-2 py-0.5 rounded-full text-xs text-faint hover:text-muted transition-colors"
        >
          +{hidden} more
        </button>
      )}
    </div>
  );
}

function PhraseCard({ item, surahs }: { item: PhraseListItem; surahs: SurahMeta[] }) {
  return (
    <div className="bg-surface border border-edge rounded-lg p-4">
      <p dir="rtl" lang="ar" className="font-arabic text-xl leading-loose text-ink mb-3">
        {item.phraseText}
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
            item.surahCount > 1
              ? "bg-primary-soft text-primary"
              : "bg-card2 text-muted"
          }`}
        >
          {item.surahCount} {item.surahCount === 1 ? "surah" : "surahs"}
        </span>
        <span className="text-xs text-faint">
          {item.totalOccurrences} occurrences
        </span>
      </div>
      <OccurrenceChips occurrences={item.occurrences} surahs={surahs} />
    </div>
  );
}

function SimilarCard({
  item,
  surahs,
}: {
  item: SimilarAyahListItem;
  surahs: SurahMeta[];
}) {
  const [expanded, setExpanded] = useState(false);
  const { surah } = parseVerseKey(item.primaryVerseKey);

  // One shared file for all cards; fetched on first expand, cached forever.
  const { data: details } = useQuery({
    queryKey: ["similar-ayah-details"],
    queryFn: fetchSimilarAyahDetails,
    enabled: expanded,
  });
  const entry = expanded ? details?.[item.id] : undefined;

  return (
    <div className="bg-surface border border-edge rounded-lg p-4">
      <p dir="rtl" lang="ar" className="font-arabic text-xl leading-loose text-ink mb-3">
        {item.sourceAyahText}
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-primary-soft text-primary">
          {item.totalSimilarCount} similar
        </span>
        <span className="text-xs text-faint">
          {item.primaryVerseKey} · {surahTname(surahs, surah)}
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto text-xs font-medium text-muted hover:text-primary transition-colors"
        >
          {expanded ? "Hide similar verses ▴" : "Show similar verses ▾"}
        </button>
      </div>

      {expanded && !entry && (
        <div className="text-xs text-faint py-2">Loading…</div>
      )}

      {entry && (
        <div className="space-y-3 border-t border-edge pt-3 mb-3">
          {entry.similarAyahs.map((m) => {
            const { surah: mSurah, ayah: mAyah } = parseVerseKey(m.ayahKey);
            return (
              <div key={m.ayahKey}>
                <div className="flex items-center gap-2 text-xs mb-1">
                  <Link
                    href={`/read?surah=${mSurah}&ayah=${mAyah}`}
                    className="font-semibold text-primary hover:underline"
                  >
                    {m.ayahKey} · {surahTname(surahs, mSurah)}
                  </Link>
                  <span className="text-faint">
                    {m.score}% match · {m.matchedWordsCount} words
                  </span>
                </div>
                <HighlightedAyah
                  text={m.ayahText}
                  ranges={[m.matchWordsRange]}
                  className="font-arabic text-lg leading-loose text-ink-soft"
                />
              </div>
            );
          })}
        </div>
      )}

      <OccurrenceChips occurrences={item.occurrences} surahs={surahs} />
    </div>
  );
}

export default function BrowsePage() {
  const [tab, setTab] = useState<Tab>("phrases");
  const [search, setSearch] = useState("");
  const [hideSameSurah, setHideSameSurah] = useState(true);

  const { data: phrases } = useQuery({
    queryKey: ["mutashabihat-list"],
    queryFn: fetchMutashabihatList,
  });
  const { data: similar } = useQuery({
    queryKey: ["similar-ayah-list"],
    queryFn: fetchSimilarAyahList,
  });
  const { data: surahs } = useQuery({ queryKey: ["surahs"], queryFn: fetchSurahs });
  const { data: juzs } = useQuery({
    queryKey: ["juz-metadata"],
    queryFn: fetchJuzMetadata,
  });

  const filteredPhrases = useMemo(() => {
    if (!phrases) return { items: [] as PhraseListItem[], hidden: 0 };
    // The QUL data has near-duplicate entries (orthographic variants,
    // overlapping phrases) covering the same verse set — show each set once,
    // represented by its longest phrase text.
    const bySig = new Map<string, PhraseListItem>();
    for (const p of phrases) {
      const sig = [...p.occurrences].sort().join("|");
      const existing = bySig.get(sig);
      if (!existing || p.phraseText.length > existing.phraseText.length) {
        bySig.set(sig, p);
      }
    }
    let items = [...bySig.values()];
    let hidden = 0;
    if (hideSameSurah) {
      const before = items.length;
      items = items.filter((p) => p.surahCount > 1);
      hidden = before - items.length;
    }
    if (search.trim()) {
      const q = search.trim();
      items = items.filter(
        (p) => p.phraseText.includes(q) || p.occurrences.some((o) => o.startsWith(q))
      );
    }
    return { items, hidden };
  }, [phrases, hideSameSurah, search]);

  const filteredSimilar = useMemo(() => {
    if (!similar) return [] as SimilarAyahListItem[];
    if (!search.trim()) return similar;
    const q = search.trim();
    return similar.filter(
      (s) => s.sourceAyahText.includes(q) || s.occurrences.some((o) => o.startsWith(q))
    );
  }, [similar, search]);

  const grouped = useMemo(() => {
    if (!juzs) return [];
    if (tab === "phrases") {
      return groupByJuzSurah(filteredPhrases.items, juzs, (p) => p.occurrences);
    }
    return groupByJuzSurah(filteredSimilar, juzs, (s) => [s.primaryVerseKey]);
  }, [tab, filteredPhrases.items, filteredSimilar, juzs]);

  const loading = !phrases || !similar || !surahs || !juzs;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-sans font-bold text-slate-100 mb-2 text-center">
          Browse
        </h1>
        <p className="text-slate-400 font-sans text-sm text-center">
          Similar phrases (Mutashabihat) and similar verses, grouped by Juz and
          Surah.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex justify-center mb-4">
        <div className="inline-flex bg-card2 border border-edge rounded-lg p-1 gap-1">
          <button
            onClick={() => setTab("phrases")}
            className={`px-4 py-1.5 rounded-md text-sm transition-colors ${
              tab === "phrases"
                ? "bg-surface text-ink font-semibold shadow-sm"
                : "text-muted hover:text-ink"
            }`}
          >
            Mutashabihat{" "}
            <span className="text-xs text-primary font-semibold">
              {phrases?.length ?? "…"}
            </span>
          </button>
          <button
            onClick={() => setTab("similar")}
            className={`px-4 py-1.5 rounded-md text-sm transition-colors ${
              tab === "similar"
                ? "bg-surface text-ink font-semibold shadow-sm"
                : "text-muted hover:text-ink"
            }`}
          >
            Similar Ayah{" "}
            <span className="text-xs text-primary font-semibold">
              {similar?.length ?? "…"}
            </span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6 justify-center">
        <input
          type="text"
          placeholder={tab === "phrases" ? "Search phrases or 2:51…" : "Search verses or 2:51…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 bg-surface border border-edge rounded-lg px-3 py-2 text-sm text-ink placeholder-faint focus:outline-none focus:border-primary"
        />
        {tab === "phrases" && (
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideSameSurah}
              onChange={(e) => setHideSameSurah(e.target.checked)}
              className="accent-[var(--primary)]"
            />
            <span className={hideSameSurah ? "text-primary font-medium" : "text-muted"}>
              Hide same-surah repeats
            </span>
          </label>
        )}
      </div>

      {tab === "phrases" && hideSameSurah && filteredPhrases.hidden > 0 && (
        <p className="text-center text-xs text-faint mb-6">
          {filteredPhrases.hidden} phrases whose occurrences all sit in one
          surah are hidden.{" "}
          <button
            onClick={() => setHideSameSurah(false)}
            className="underline hover:text-muted"
          >
            Show them anyway
          </button>
        </p>
      )}

      {loading ? (
        <div className="text-center py-20 text-muted">Loading…</div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-20 text-muted">
          Nothing matches this filter.
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map((jg) => (
            <details
              key={`${tab}-${jg.juz}`}
              className="border border-edge rounded-xl overflow-hidden bg-surface"
            >
              <summary className="cursor-pointer list-none px-4 py-3 bg-card2 flex items-center gap-3 text-sm font-semibold text-ink">
                <span>Juz {jg.juz}</span>
                <span className="text-xs font-normal text-faint">
                  {jg.surahGroups.reduce((n, sg) => n + sg.items.length, 0)} items
                </span>
                <span className="ml-auto text-faint text-xs">▾</span>
              </summary>
              <div className="divide-y divide-[var(--border)]">
                {jg.surahGroups.map((sg) => (
                  <div key={sg.surahNum} className="px-4 py-3">
                    <div className="text-sm font-semibold text-ink-soft mb-3">
                      {sg.surahNum} · {surahTname(surahs!, sg.surahNum)}
                      <span className="ml-2 text-xs font-normal text-faint">
                        {sg.items.length}{" "}
                        {sg.items.length === 1 ? "item" : "items"}
                      </span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {tab === "phrases"
                        ? (sg.items as PhraseListItem[]).map((item) => (
                            <PhraseCard key={item.id} item={item} surahs={surahs!} />
                          ))
                        : (sg.items as SimilarAyahListItem[]).map((item) => (
                            <SimilarCard key={item.id} item={item} surahs={surahs!} />
                          ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
