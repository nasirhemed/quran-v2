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

const EXAMPLE_QUERIES = [
  { label: "2:255", value: "2:255" },
  { label: "وما ارسلنا", value: "وما ارسلنا" },
  { label: "Al-Kahf", value: "Al-Kahf" },
];

function SurahGrid({ surahs, index }: { surahs: SurahMeta[]; index?: BrowseIndex }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {surahs.map((s) => {
        const count = index?.bySurah.get(s.index)?.length;
        const body = (
          <>
            <span className="w-10 h-10 shrink-0 rounded-xl bg-card2 text-ink-soft text-sm font-semibold tabular-nums flex items-center justify-center group-hover:bg-primary-soft group-hover:text-primary transition-colors">
              {s.index}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-ink truncate group-hover:text-primary transition-colors">
                {s.tname}
              </span>
              <span className="block text-xs text-muted">
                {index ? (count ? `${count} of ${s.ayas} verses matched` : "No matches recorded") : "…"}
              </span>
            </span>
            <SurahName surah={s.index} name={s.name} className="text-xl text-ink-soft" />
          </>
        );
        const cls = "flex items-center gap-3 rounded-2xl border border-edge bg-card px-4 py-3 shadow-card";
        return index && !count ? (
          <div key={s.index} className={`${cls} opacity-50`}>
            {body}
          </div>
        ) : (
          <BrowseLink
            key={s.index}
            href={surahHref(s.index)}
            className={`${cls} hover:shadow-card-hover hover:border-primary/45 hover:-translate-y-0.5 transition-all group`}
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
      <div className="text-center py-16 text-muted text-sm">
        Nothing found for &ldquo;{query}&rdquo;. Try an Arabic phrase without harakat, a verse like 2:51, or a surah name.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {result.surahs.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Surahs</h2>
          <SurahGrid surahs={result.surahs} index={index} />
        </section>
      )}

      {result.verse && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Verse</h2>
          <VerseCard
            verse={result.verse}
            label={`${result.verse.key} · ${surahTname(surahs, result.verse.surah)}`}
          />
        </section>
      )}

      {result.phrases.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
            Phrases <span className="font-normal text-faint ml-1">{result.phrases.length}</span>
          </h2>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {result.phrases.slice(0, shownPhrases).map((p) => (
              <BrowseLink
                key={p.id}
                href={phraseHref(p.id)}
                className="flex items-center gap-3 rounded-2xl border border-edge bg-card shadow-card px-4 py-3 hover:shadow-card-hover hover:border-primary/45 transition-all"
              >
                <span className="text-xs text-muted shrink-0">
                  {p.occurrences.length} verses · {p.surahCount} {p.surahCount === 1 ? "surah" : "surahs"}
                </span>
                <span dir="rtl" lang="ar" className="ml-auto font-quran text-xl text-ink text-right">
                  {p.text}
                </span>
              </BrowseLink>
            ))}
          </div>
          {result.phrases.length > shownPhrases && (
            <button
              onClick={() => setShownPhrases((n) => n + 30)}
              className="mt-3 text-sm font-medium text-primary hover:underline"
            >
              Show more phrases ({result.phrases.length - shownPhrases} left)
            </button>
          )}
        </section>
      )}

      {result.verses.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
            Verses <span className="font-normal text-faint ml-1">{result.verses.length}</span>
          </h2>
          <div className="space-y-3">
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
              className="mt-3 text-sm font-medium text-primary hover:underline"
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

  const setQuery = (q: string) => {
    navigate(q ? `/browse?q=${encodeURIComponent(q)}` : "/browse", { replace: true });
  };

  return (
    <div className="max-w-5xl mx-auto px-4 pt-8 pb-24">
      <div className="mb-7 text-center">
        <h1 className="text-3xl sm:text-4xl font-sans font-bold tracking-tight text-ink mb-2">Browse</h1>
        <p className="text-muted font-sans text-sm sm:text-[15px] max-w-lg mx-auto">
          Explore similar phrases (Mutashabihat) and look-alike verses by surah, or search anywhere in the Qur'an.
        </p>
      </div>

      <div className="max-w-2xl mx-auto mb-8">
        <div className="relative">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-faint pointer-events-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            dir="auto"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Arabic (وما ارسلنا), a verse (2:51), or a surah…"
            className="w-full bg-card border border-edge rounded-2xl shadow-card pl-10 pr-10 py-3 text-sm sm:text-base text-ink placeholder-faint focus:outline-none focus:border-primary transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full text-muted hover:text-ink hover:bg-card2 flex items-center justify-center transition-colors"
            >
              ×
            </button>
          )}
        </div>

        {!query && (
          <div className="flex flex-wrap items-center justify-center gap-1.5 mt-3 text-xs text-muted">
            <span>Try:</span>
            {EXAMPLE_QUERIES.map((ex) => (
              <button
                key={ex.value}
                type="button"
                onClick={() => setQuery(ex.value)}
                className="px-2.5 py-1 rounded-full bg-card border border-edge hover:border-primary/50 hover:text-primary transition-colors"
              >
                {ex.label}
              </button>
            ))}
          </div>
        )}
      </div>

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
