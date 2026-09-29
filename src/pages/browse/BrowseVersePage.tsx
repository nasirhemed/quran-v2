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
    <div className="rounded-xl border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ background: phraseColor(n) }} />
        <span className="text-xs text-faint">
          {phrase.occurrences.length} verses · {phrase.surahCount} {phrase.surahCount === 1 ? "surah" : "surahs"}
        </span>
        <BrowseLink href={phraseHref(phrase.id)} className="text-xs text-muted hover:text-primary">
          All occurrences ›
        </BrowseLink>
        <span dir="rtl" lang="ar" className="ml-auto font-arabic text-xl text-ink">
          <span className="rounded-sm px-1" style={{ background: phraseColor(n) }}>
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
          className="mt-2 text-sm text-muted hover:text-primary"
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
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Breadcrumbs
        items={[
          { label: "Browse", href: "/browse" },
          { label: `${surah} · ${tname}`, href: surahHref(surah) },
          { label: `Verse ${ayah}` },
        ]}
      />

      <div className="rounded-xl border border-edge bg-surface p-5 mb-8">
        <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
          <span className="font-semibold text-ink">
            {tname} {key}
          </span>
          <Link
            href={readerHref(key)}
            className="ml-auto px-3 py-1 rounded-full border border-edge text-muted hover:text-primary hover:border-primary transition-colors"
          >
            Open in reader
          </Link>
        </div>
        <VerseText
          words={verse.words}
          marks={phraseMarks(verse)}
          className="font-arabic text-2xl leading-[2.2] text-ink"
        />
        <div className="flex items-center justify-between mt-4 text-sm">
          {prev ? (
            <BrowseLink href={verseHref(prev.key)} className="text-muted hover:text-primary">
              ‹ Previous ({prev.key})
            </BrowseLink>
          ) : (
            <span />
          )}
          {next && (
            <BrowseLink href={verseHref(next.key)} className="text-muted hover:text-primary">
              Next ({next.key}) ›
            </BrowseLink>
          )}
        </div>
      </div>

      {verse.phrases.length === 0 && verse.similar.length === 0 && (
        <div className="text-center py-10 text-muted text-sm">
          No similar phrases or verses are recorded for this verse.
        </div>
      )}

      {verse.phrases.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-ink mb-1">Similar phrases</h2>
          <p className="text-xs text-faint mb-3">
            Phrases of this verse that recur elsewhere, with the other verses they appear in.
          </p>
          <div className="space-y-3">
            {verse.phrases.map((vp, n) => (
              <PhraseBlock key={vp.id} vp={vp} n={n} verse={verse} index={index} surahs={surahs} />
            ))}
          </div>
        </section>
      )}

      {verse.similar.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-ink mb-1">Similar verses</h2>
          <p className="text-xs text-faint mb-3">Verses worded much like this one, closest first.</p>
          <div className="space-y-2">
            {verse.similar.map((s) => {
              const other = index.verses.get(s.key)!;
              return (
                <OccurrenceRow
                  key={s.key}
                  verse={other}
                  label={`${s.key} · ${surahTname(surahs, other.surah)}`}
                  marks={[{ ranges: s.ranges, color: MATCH_COLOR }]}
                  badge={
                    <span className="text-faint">
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
