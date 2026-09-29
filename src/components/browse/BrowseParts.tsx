import { Fragment, useLayoutEffect, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import type { BrowseVerse, WordRange } from "@/lib/browse";

export const surahHref = (surah: number) => `/browse/surah/${surah}`;
export const verseHref = (key: string) => `/browse/surah/${key.replace(":", "/")}`;
export const phraseHref = (id: string) => `/browse/phrase/${id}`;
export const readerHref = (key: string) => {
  const [surah, ayah] = key.split(":");
  return `/read?surah=${surah}&ayah=${ayah}`;
};

/** The n-th phrase of a verse gets the n-th highlight colour, here and in its list. */
export const phraseColor = (n: number) => `var(--hl-${n % 8}-bg)`;
export const MATCH_COLOR = "var(--primary-soft)";

const here = () => location.pathname + location.search;

// Scroll positions to go back to, per Browse URL: the link that was followed
// and where it sat on screen. The browser's own restoration runs before the
// page has re-rendered, so it lands at the top.
const returnTo = new Map<string, { href: string; top: number; y: number }>();
let poppedTo: string | null = null;
window.addEventListener("popstate", () => {
  poppedTo = here();
});

/**
 * Call once the page's content has rendered. Coming back, it scrolls to where
 * the reader left; arriving anew, it starts at the top.
 */
export function useRestoreScroll(ready: boolean) {
  const [path] = useLocation();
  useLayoutEffect(() => {
    if (!ready) return;
    const url = here();
    const at = returnTo.get(url);
    if (poppedTo !== url) window.scrollTo(0, 0);
    else if (at) {
      const link = document.querySelector(`a[href="${CSS.escape(at.href)}"]`);
      if (link) window.scrollBy(0, link.getBoundingClientRect().top - at.top);
      else window.scrollTo(0, at.y);
    }
    poppedTo = null;
  }, [ready, path]);
}

/** A link to another Browse page; going back returns to it (see useRestoreScroll). */
export function BrowseLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        returnTo.set(here(), { href, top: e.currentTarget.getBoundingClientRect().top, y: window.scrollY });
      }}
    >
      {children}
    </Link>
  );
}

export interface WordMarks {
  ranges: WordRange[];
  color: string;
}

/** A verse with some word ranges coloured (the first mark wins); a run of words is one highlight. */
export function VerseText({
  words,
  marks = [],
  className = "font-arabic text-xl leading-loose text-ink",
}: {
  words: string[];
  marks?: WordMarks[];
  className?: string;
}) {
  const color: (string | undefined)[] = [];
  for (const m of marks) {
    for (const [from, to] of m.ranges) {
      for (let i = from - 1; i < to; i++) color[i] ??= m.color;
    }
  }
  const runs: { words: string[]; color?: string }[] = [];
  words.forEach((word, i) => {
    const last = runs[runs.length - 1];
    if (last && last.color === color[i]) last.words.push(word);
    else runs.push({ words: [word], color: color[i] });
  });
  return (
    <p dir="rtl" lang="ar" className={className}>
      {runs.map((run, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          {run.color ? (
            <span className="rounded-sm [box-decoration-break:clone]" style={{ background: run.color }}>
              {run.words.join(" ")}
            </span>
          ) : (
            run.words.join(" ")
          )}
        </Fragment>
      ))}
    </p>
  );
}

export const phraseMarks = (verse: BrowseVerse): WordMarks[] =>
  verse.phrases.map((p, n) => ({ ranges: p.ranges, color: phraseColor(n) }));

function Counts({ verse }: { verse: BrowseVerse }) {
  return (
    <span className="flex flex-wrap gap-1.5 justify-end">
      {verse.phrases.length > 0 && (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-card2 text-muted">
          {verse.phrases.length} {verse.phrases.length === 1 ? "phrase" : "phrases"}
        </span>
      )}
      {verse.similar.length > 0 && (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-primary-soft text-primary">
          {verse.similar.length} similar {verse.similar.length === 1 ? "verse" : "verses"}
        </span>
      )}
    </span>
  );
}

/** A verse in a list: tap to see its phrases and similar verses. */
export function VerseCard({
  verse,
  label,
  marks = phraseMarks(verse),
}: {
  verse: BrowseVerse;
  label: string;
  marks?: WordMarks[];
}) {
  return (
    <BrowseLink
      href={verseHref(verse.key)}
      className="block bg-surface border border-edge rounded-lg p-4 hover:border-primary transition-colors [content-visibility:auto] [contain-intrinsic-size:auto_160px]"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-ink-soft">{label}</span>
        <span className="ml-auto">
          <Counts verse={verse} />
        </span>
      </div>
      <VerseText words={verse.words} marks={marks} />
    </BrowseLink>
  );
}

/** Another verse, listed under a phrase or as a similar verse. */
export function OccurrenceRow({
  verse,
  label,
  marks,
  badge,
}: {
  verse: BrowseVerse;
  label: string;
  marks: WordMarks[];
  badge?: ReactNode;
}) {
  return (
    <BrowseLink
      href={verseHref(verse.key)}
      className="block rounded-lg border border-edge bg-card px-3 py-2 hover:border-primary transition-colors [content-visibility:auto] [contain-intrinsic-size:auto_110px]"
    >
      <div className="flex items-center gap-2 text-xs mb-1">
        <span className="font-semibold text-primary">{label}</span>
        {badge && <span className="ml-auto">{badge}</span>}
      </div>
      <VerseText words={verse.words} marks={marks} className="font-arabic text-lg leading-loose text-ink-soft" />
    </BrowseLink>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 text-sm text-muted mb-4">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-faint">›</span>}
          {item.href ? (
            <BrowseLink href={item.href} className="hover:text-primary transition-colors">
              {item.label}
            </BrowseLink>
          ) : (
            <span className="text-ink font-medium">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function Loading() {
  return <div className="text-center py-20 text-muted">Loading…</div>;
}
