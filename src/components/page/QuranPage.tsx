import { useMemo, useCallback, type CSSProperties } from "react";
import type { QuranPage as QuranPageType, PageHighlightMap, WordHighlight, WordSelection, SurahMeta } from "@/types";
import { HIGHLIGHT_COLORS, HIGHLIGHT_BORDER_COLORS } from "@/lib/highlights";
import { pageLayout, type LineItem } from "@/lib/mushaf/layout";
import { LINE_WIDTH_EM, pageFontFamily } from "@/lib/mushaf/pack";
import { BISMILLAH_PAGE, useMushafFonts } from "@/hooks/useMushafFonts";
import SurahHeader from "./SurahHeader";
import Bismillah from "./Bismillah";
import VerseMarker from "./VerseMarker";

interface QuranPageProps {
  page: QuranPageType;
  highlights: PageHighlightMap;
  /** names for surah headers (a header can belong to the next page's surah) */
  surahs: SurahMeta[];
  /** page 1's glyphs for 1:1, drawn on bismillah lines */
  bismillah: string[];
  activeAyah?: { surah: number; ayah: number } | null;
  onHighlightClick?: (highlight: WordHighlight) => void;
  editMode?: boolean;
  wordSelection?: WordSelection | null;
  onWordSelect?: (ayahKey: string, wordIndex1Based: number) => void;
}

type WordItem = Extract<LineItem, { kind: "word" }>;

/**
 * A rub' al-hizb mark (۞) and its word come as one glyph run with a space the page fonts have no glyph for; a
 * fixed spacer (the width the build measures with) keeps it the same on every platform, whatever fallback font.
 */
const glyphRun = (glyph: string) =>
  glyph.includes(" ")
    ? glyph.split(" ").flatMap((part, i) => (i ? [<span key={i} className="inline-block w-[0.25em]" />, part] : [part]))
    : glyph;

/**
 * One mushaf page as printed: 15 lines (8 on pages 1-2), each word drawn from its glyph in the page's QCF V2 font,
 * so words, line breaks and ornaments match the Madinah print. Every line is one font size wide (the size comes
 * from the column width), so lines never wrap; highlights only colour a word's box, never resize it.
 *
 * Without the fonts (offline and never opened, or not hosted), the same lines are drawn from the Unicode text.
 */
export default function QuranPage({
  page,
  highlights,
  surahs,
  bismillah,
  activeAyah,
  onHighlightClick,
  editMode,
  wordSelection,
  onWordSelect,
}: QuranPageProps) {
  const lines = useMemo(() => pageLayout(page), [page]);
  const fontState = useMushafFonts(page.pageNumber, {
    headers: lines.some((l) => l.kind === "surah"),
    bismillah: lines.some((l) => l.kind === "bismillah"),
  });
  const glyphs = fontState === "ready" || fontState === "loading";

  const handleWordClick = useCallback(
    (item: WordItem) => {
      if (editMode && onWordSelect) {
        onWordSelect(item.ayahKey, item.word.position);
        return;
      }
      if (!onHighlightClick) return;
      const hl = highlights[item.ayahKey]?.get(item.wordIndex0);
      if (hl) onHighlightClick(hl);
    },
    [editMode, onWordSelect, onHighlightClick, highlights]
  );

  const isWordSelected = (item: WordItem): boolean => {
    if (!wordSelection || wordSelection.ayahKey !== item.ayahKey) return false;
    const w = item.word.position;
    if (wordSelection.endWord === null) return w === wordSelection.startWord;
    return w >= wordSelection.startWord && w <= wordSelection.endWord;
  };

  const isActive = (item: LineItem) => activeAyah?.surah === item.surah && activeAyah?.ayah === item.ayah;

  const surahMeta = (n: number) => surahs.find((s) => s.index === n);

  const renderWord = (item: WordItem) => {
    const hl = highlights[item.ayahKey]?.get(item.wordIndex0);
    const selected = editMode && isWordSelected(item);
    const clickable = editMode || !!hl;
    // Colour only: a background with the underline painted into it, so the word keeps its exact width.
    const style: CSSProperties | undefined =
      hl && !selected
        ? {
            backgroundImage: `linear-gradient(to top, ${HIGHLIGHT_BORDER_COLORS[hl.colorIndex]} 2px, ${HIGHLIGHT_COLORS[hl.colorIndex]} 2px)`,
          }
        : undefined;
    return (
      <span
        key={`${item.ayahKey}:${item.word.position}`}
        data-w={`${item.ayahKey}:${item.word.position}`}
        className={`rounded ${clickable ? "cursor-pointer" : ""} ${
          selected ? "ring-2 ring-amber-400 bg-amber-500/20" : ""
        } ${isActive(item) ? "text-amber-200" : ""}`}
        style={style}
        onClick={clickable ? () => handleWordClick(item) : undefined}
      >
        {glyphs ? (
          <>
            {/* Glyph codes mean nothing outside the page's font: screen readers and copy get the text instead. */}
            <span aria-hidden="true" className="select-none">
              {glyphRun(item.word.glyph)}
            </span>
            <span className="sr-only">{item.word.text} </span>
          </>
        ) : (
          item.word.text
        )}
      </span>
    );
  };

  const renderEnd = (item: Extract<LineItem, { kind: "end" }>) =>
    glyphs ? (
      <span key={`end-${item.ayahKey}`} className={isActive(item) ? "text-amber-200" : ""}>
        <span aria-hidden="true" className="select-none">
          {item.glyph}
        </span>
        <span className="sr-only">({item.ayah}) </span>
      </span>
    ) : (
      <VerseMarker key={`end-${item.ayahKey}`} ayahNumber={item.ayah} />
    );

  return (
    <div className="mushaf max-w-[40rem] mx-auto px-3 sm:px-6 py-6 text-slate-100" dir="rtl">
      <div className="text-center mb-3">
        <span className="text-xs font-sans text-slate-500">Page {page.pageNumber}</span>
      </div>

      {glyphs ? (
        <div
          lang="ar"
          className={`mushaf-glyphs ${fontState === "loading" ? "invisible overflow-hidden" : ""}`}
          style={{ fontFamily: `"${pageFontFamily(page.pageNumber)}"`, "--line-em": LINE_WIDTH_EM } as CSSProperties}
        >
          {lines.map((line) => {
            if (line.kind === "surah") {
              const meta = surahMeta(line.surah);
              return <SurahHeader key={line.n} glyphs surahIndex={line.surah} surahName={meta?.name ?? ""} tname={meta?.tname ?? ""} />;
            }
            if (line.kind === "bismillah") {
              return <Bismillah key={line.n} glyphs={bismillah} fontFamily={pageFontFamily(BISMILLAH_PAGE)} />;
            }
            return (
              <div key={line.n} className={`mushaf-line ${line.centered ? "justify-center gap-[0.35em]" : "justify-between"}`}>
                {line.items.map((item) => (item.kind === "word" ? renderWord(item) : renderEnd(item)))}
              </div>
            );
          })}
        </div>
      ) : (
        <div lang="ar" className="font-arabic text-lg sm:text-2xl space-y-1">
          {lines.map((line) => {
            if (line.kind === "surah") {
              const meta = surahMeta(line.surah);
              return <SurahHeader key={line.n} surahIndex={line.surah} surahName={meta?.name ?? ""} tname={meta?.tname ?? ""} />;
            }
            if (line.kind === "bismillah") return <Bismillah key={line.n} />;
            return (
              <div
                key={line.n}
                className={`flex items-baseline flex-wrap leading-[2.1] ${
                  line.centered ? "justify-center gap-x-2" : "justify-between gap-x-1"
                }`}
              >
                {line.items.map((item) => (item.kind === "word" ? renderWord(item) : renderEnd(item)))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
