import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { fetchSurahs } from "@/lib/data";
import { foldArabic, matchRanges, searchBrowse, type BrowseIndex } from "@/lib/browse";
import { surahTname } from "@/lib/quranMeta";
import { useBrowseIndex } from "@/hooks/useBrowseIndex";
import {
  BrowseLink,
  Loading,
  MATCH_COLOR,
  VerseCard,
  phraseHref,
  surahHref,
  useRestoreScroll,
} from "@/components/browse/BrowseParts";
import type { SurahMeta } from "@/types";
import SurahName from "@/components/SurahName";

const PAGE = 30;

function SurahGrid({ surahs, index }: { surahs: SurahMeta[]; index?: BrowseIndex }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {surahs.map((s) => {
        const count = index?.bySurah.get(s.index)?.length;
        const body = (
          <>
            <span className="w-9 h-9 shrink-0 rounded-lg bg-card2 text-muted text-sm font-semibold flex items-center justify-center">
              {s.index}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink truncate">{s.tname}</span>
              <span className="block text-xs text-faint">
                {index ? (count ? `${count} of ${s.ayas} verses` : "none recorded") : "…"}
              </span>
            </span>
            <SurahName surah={s.index} name={s.name} className="text-lg text-ink-soft" />
          </>
        );
        const cls = "flex items-center gap-3 rounded-lg border border-edge bg-surface px-3 py-2";
        return index && !count ? (
          <div key={s.index} className={`${cls} opacity-50`}>
            {body}
          </div>
        ) : (
          <BrowseLink
            key={s.index}
            href={surahHref(s.index)}
            className={`${cls} hover:border-primary transition-colors`}
          >
            {body}
          </BrowseLink>
        );
      })}
    </div>
  );
}

function SearchResults({ query, surahs, index }: { query: string; surahs: SurahMeta[]; index: BrowseIndex }) {
  const [shownPhrases, setShownPhrases] = useState(10);
  const [shownVerses, setShownVerses] = useState(PAGE);
  const result = useMemo(() => searchBrowse(index, surahs, query), [index, surahs, query]);
  const folded = foldArabic(query);
  const empty = !result.verse && !result.surahs.length && !result.phrases.length && !result.verses.length;

  if (empty) {
    return (
      <div className="text-center py-16 text-muted text-sm">Nothing found.</div>
    );
  }

  return (
    <div className="space-y-8">
      {result.surahs.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-ink-soft mb-3">Surahs</h2>
          <SurahGrid surahs={result.surahs} index={index} />
        </section>
      )}

      {result.verse && (
        <section>
          <h2 className="text-sm font-semibold text-ink-soft mb-3">Verse</h2>
          <VerseCard
            verse={result.verse}
            label={`${result.verse.key} · ${surahTname(surahs, result.verse.surah)}`}
          />
        </section>
      )}

      {result.phrases.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-ink-soft mb-3">
            Phrases <span className="font-normal text-faint">{result.phrases.length}</span>
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {result.phrases.slice(0, shownPhrases).map((p) => (
              <BrowseLink
                key={p.id}
                href={phraseHref(p.id)}
                className="flex items-center gap-3 rounded-lg border border-edge bg-surface px-3 py-2 hover:border-primary transition-colors"
              >
                <span className="text-xs text-faint shrink-0">
                  {p.occurrences.length} verses · {p.surahCount} {p.surahCount === 1 ? "surah" : "surahs"}
                </span>
                <span dir="rtl" lang="ar" className="ml-auto font-quran text-lg text-ink text-right">
                  {p.text}
                </span>
              </BrowseLink>
            ))}
          </div>
          {result.phrases.length > shownPhrases && (
            <button
              onClick={() => setShownPhrases((n) => n + 30)}
              className="mt-3 text-sm text-muted hover:text-primary"
            >
              Show more phrases ({result.phrases.length - shownPhrases} left)
            </button>
          )}
        </section>
      )}

      {result.verses.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-ink-soft mb-3">
            Verses <span className="font-normal text-faint">{result.verses.length}</span>
          </h2>
          <div className="space-y-2">
            {result.verses.slice(0, shownVerses).map((v) => (
              <VerseCard
                key={v.key}
                verse={v}
                label={`${v.key} · ${surahTname(surahs, v.surah)}`}
                marks={[{ ranges: matchRanges(v.words, folded), color: MATCH_COLOR }]}
              />
            ))}
          </div>
          {result.verses.length > shownVerses && (
            <button
              onClick={() => setShownVerses((n) => n + PAGE)}
              className="mt-3 text-sm text-muted hover:text-primary"
            >
              Show more verses ({result.verses.length - shownVerses} left)
            </button>
          )}
        </section>
      )}
    </div>
  );
}

export default function BrowsePage() {
  const [, navigate] = useLocation();
  // The search lives in the URL, so coming back from a verse shows the same results.
  const query = new URLSearchParams(useSearch()).get("q") ?? "";
  const deferredQuery = useDeferredValue(query);
  const { data: surahs } = useQuery({ queryKey: ["surahs"], queryFn: fetchSurahs });
  const { data: index } = useBrowseIndex();
  useRestoreScroll(!!surahs && (!deferredQuery.trim() || !!index));

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-sans font-bold text-ink mb-2">Browse</h1>
        <p className="text-muted font-sans text-sm">
          Similar phrases (Mutashabihat) and similar verses. Pick a surah, or search.
        </p>
      </div>

      <input
        type="search"
        dir="auto"
        value={query}
        onChange={(e) => {
          const q = e.target.value;
          navigate(q ? `/browse?q=${encodeURIComponent(q)}` : "/browse", { replace: true });
        }}
        placeholder="Search in Arabic (وما ارسلنا), a verse (2:51) or a surah"
        className="w-full mb-8 bg-surface border border-edge rounded-lg px-4 py-3 text-base text-ink placeholder-faint focus:outline-none focus:border-primary"
      />

      {!surahs ? (
        <Loading />
      ) : deferredQuery.trim() ? (
        index ? (
          <SearchResults key={deferredQuery} query={deferredQuery} surahs={surahs} index={index} />
        ) : (
          <Loading />
        )
      ) : (
        <SurahGrid surahs={surahs} index={index} />
      )}
    </div>
  );
}
