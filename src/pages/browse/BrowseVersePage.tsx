import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { fetchSurahs } from "@/lib/data";
import { surahTname } from "@/lib/quranMeta";
import { compareKeys, type BrowseIndex, type BrowseVerse, type VersePhrase } from "@/lib/browse";
import { useBrowseIndex } from "@/hooks/useBrowseIndex";
import {
  Breadcrumbs,
  BrowseLink,
  Loading,
  MATCH_COLOR,
  OccurrenceRow,
  VerseText,
  phraseBorderColor,
  phraseColor,
  phraseHref,
  phraseMarks,
  readerHref,
  surahHref,
  useRestoreScroll,
  verseHref,
} from "@/components/browse/BrowseParts";
import type { SurahMeta } from "@/types";

const PREVIEW = 3;

function PhraseBlock({
  vp,
  n,
  verse,
  index,
  surahs,
}: {
  vp: VersePhrase;
  n: number;
  verse: BrowseVerse;
  index: BrowseIndex;
  surahs: SurahMeta[];
}) {
  const [showAll, setShowAll] = useState(false);
  const phrase = index.phrases.get(vp.id)!;
  const others = phrase.occurrences.filter((o) => o.key !== verse.key);
  const shown = showAll ? others : others.slice(0, PREVIEW);

  return (
    <div className="rounded-2xl border border-edge bg-card shadow-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2 mb-3.5">
        <span
          className="w-3 h-3 rounded-full shrink-0"
          style={{ background: phraseBorderColor(n) }}
          aria-hidden
        />
        <span className="text-xs font-medium text-muted">
          {phrase.occurrences.length} verses · {phrase.surahCount} {phrase.surahCount === 1 ? "surah" : "surahs"}
        </span>
        <BrowseLink
          href={phraseHref(phrase.id)}
          className="text-xs font-semibold text-primary hover:underline"
        >
          All occurrences ›
        </BrowseLink>
        <span dir="rtl" lang="ar" className="ml-auto font-quran text-xl text-ink">
          <span className="rounded-md px-1.5 py-0.5" style={{ background: phraseColor(n) }}>
            {phrase.text}
          </span>
        </span>
      </div>
      <div className="space-y-2">
        {shown.map((o) => {
          const other = index.verses.get(o.key)!;
          return (
            <OccurrenceRow
              key={o.key}
              verse={other}
              label={`${o.key} · ${surahTname(surahs, other.surah)}`}
              marks={[{ ranges: o.ranges, color: phraseColor(n) }]}
            />
          );
        })}
      </div>
      {others.length > PREVIEW && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-sm font-medium text-primary hover:underline"
        >
          {showAll ? "Show fewer" : `Show all ${others.length} other verses`}
        </button>
      )}
    </div>
  );
}

export default function BrowseVersePage({ surah, ayah }: { surah: number; ayah: number }) {
  const key = `${surah}:${ayah}`;
  const { data: surahs } = useQuery({ queryKey: ["surahs"], queryFn: fetchSurahs });
  const { data: index } = useBrowseIndex();
  useRestoreScroll(!!surahs && !!index);

  if (!surahs || !index) return <Loading />;
  const verse = index.verses.get(key);
  if (!verse) return <div className="py-24 text-center text-muted">No such verse.</div>;

  const tname = surahTname(surahs, surah);
  // Step through the verses that have something to show, across surahs.
  const next = index.matched.find((v) => compareKeys(v, verse) > 0);
  const prev = [...index.matched].reverse().find((v) => compareKeys(v, verse) < 0);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-24">
      <Breadcrumbs
        items={[
          { label: "Browse", href: "/browse" },
          { label: `${surah} · ${tname}`, href: surahHref(surah) },
          { label: `Verse ${ayah}` },
        ]}
      />

      <div className="rounded-2xl border border-edge bg-card shadow-card p-5 sm:p-6 mb-8">
        <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
          <span className="font-semibold text-ink">
            {tname} <span className="text-primary">{key}</span>
          </span>
          <Link
            href={readerHref(key)}
            className="ml-auto px-3.5 py-1.5 rounded-full border border-primary/30 bg-primary-soft text-primary font-semibold text-xs hover:bg-primary hover:text-on-primary transition-colors"
          >
            Open in reader
          </Link>
        </div>
        <VerseText
          words={verse.hafs}
          marks={phraseMarks(verse)}
          className="font-quran text-2xl sm:text-[1.75rem] leading-[2.25] text-ink"
        />
        <div className="flex items-center justify-between mt-5 pt-3.5 border-t border-edge/70 text-sm">
          {prev ? (
            <BrowseLink href={verseHref(prev.key)} className="text-muted hover:text-primary font-medium transition-colors">
              ‹ Previous ({prev.key})
            </BrowseLink>
          ) : (
            <span />
          )}
          {next && (
            <BrowseLink href={verseHref(next.key)} className="text-muted hover:text-primary font-medium transition-colors">
              Next ({next.key}) ›
            </BrowseLink>
          )}
        </div>
      </div>

      {verse.phrases.length === 0 && verse.similar.length === 0 && (
        <div className="bg-card border border-edge rounded-2xl shadow-card text-center py-10 px-4 text-muted text-sm">
          No similar phrases or verses are recorded for this verse.{" "}
          <Link href={readerHref(key)} className="text-primary font-semibold hover:underline">
            Read it in the mushaf
          </Link>
        </div>
      )}

      {verse.phrases.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-ink mb-1">Similar phrases</h2>
          <p className="text-xs text-muted mb-3.5">
            Phrases of this verse that recur elsewhere, with the other verses they appear in.
          </p>
          <div className="space-y-3.5">
            {verse.phrases.map((vp, n) => (
              <PhraseBlock key={vp.id} vp={vp} n={n} verse={verse} index={index} surahs={surahs} />
            ))}
          </div>
        </section>
      )}

      {verse.similar.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-ink mb-1">Similar verses</h2>
          <p className="text-xs text-muted mb-3.5">Verses worded much like this one, closest first.</p>
          <div className="bg-card border border-edge rounded-2xl shadow-card p-3 sm:p-4 space-y-2.5">
            {verse.similar.map((s) => {
              const other = index.verses.get(s.key)!;
              return (
                <OccurrenceRow
                  key={s.key}
                  verse={other}
                  label={`${s.key} · ${surahTname(surahs, other.surah)}`}
                  marks={[{ ranges: s.ranges, color: MATCH_COLOR }]}
                  badge={
                    <span className="px-2 py-0.5 rounded-full bg-card2 text-ink-soft font-medium">
                      {s.score}% match · {s.words} {s.words === 1 ? "word" : "words"}
                    </span>
                  }
                />
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
