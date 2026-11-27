import { useMemo, useCallback, type ClipboardEvent, type CSSProperties } from "react";
import type { QuranPage as QuranPageType, PageHighlightMap, WordHighlight, WordSelection, SurahMeta } from "@/types";
import { HIGHLIGHT_COLORS, HIGHLIGHT_BORDER_COLORS } from "@/lib/highlights";
import { ayahNumberText, pageLayout, type LineItem } from "@/lib/mushaf/layout";
import { pageFontFamily, surahNamesFamily, type MushafPack } from "@/lib/mushaf/pack";
import { BISMILLAH_PAGE, useMushafFonts } from "@/hooks/useMushafFonts";
import { REVEALED_CLASS } from "@/hooks/useHiddenWords";
import SurahHeader from "./SurahHeader";
import Bismillah from "./Bismillah";
import VerseMarker from "./VerseMarker";

interface QuranPageProps {
  page: QuranPageType;
  /** the print's font pack, and its widest line in em of the pack's fonts (lib/mushaf/layouts.ts) */
  pack: MushafPack;
  lineWidthEm: number;
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
  /** recite from memory: words are masked until revealed (tapping a masked word reveals it) */
  hideWords?: { revealed: ReadonlySet<string>; onReveal: (key: string) => void } | null;
  /** toggle Mutashabihat phrase colors off for pure high-contrast reading */
  showHighlights?: boolean;
  /** where the page sits in its column: centred (one page), or against the spread's middle gutter (two pages) */
  align?: "center" | "left" | "right";
  /** how many pages either side to load fonts for ahead of time (2 in a spread: the next spread is two pages) */
  preloadAround?: number;
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
 * Glyph codes paste as gibberish outside their font: a copy of the page gives the selected words' Unicode text
 * instead (each word, ornament and bismillah carries it in data-copy), in reading order.
 */
function copyText(e: ClipboardEvent<HTMLElement>) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  const parts: string[] = [];
  e.currentTarget.querySelectorAll<HTMLElement>("[data-copy]").forEach((el) => {
    if (selection.containsNode(el, true)) parts.push(el.dataset.copy!);
  });
  if (!parts.length) return;
  e.clipboardData.setData("text/plain", parts.join(" "));
  e.preventDefault();
}

/**
 * One mushaf page as printed: 15 lines (8 on pages 1-2), each word drawn from its glyph in the page's QCF font
 * (V2 for the 1421H print, V1 for 1405H), so words, line breaks and ornaments match that Madinah print. Every line is one font size wide (the size comes
 * from the column width), so lines never wrap; highlights only colour a word's box, never resize it.
 *
 * Without the fonts (offline and never opened, or not hosted), the same lines are drawn from the Unicode text.
 */
export default function QuranPage({
  page,
  pack,
  lineWidthEm,
  highlights,
  surahs,
  bismillah,
  activeAyah,
  onHighlightClick,
  editMode,
  wordSelection,
  onWordSelect,
  hideWords,
  showHighlights = true,
  align = "center",
  preloadAround = 1,
}: QuranPageProps) {
  const lines = useMemo(() => pageLayout(page), [page]);
  const fontState = useMushafFonts(pack, page.pageNumber, {
    headers: lines.some((l) => l.kind === "surah"),
    bismillah: lines.some((l) => l.kind === "bismillah"),
    around: preloadAround,
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
    const key = `${item.ayahKey}:${item.word.position}`;
    const revealed = !!hideWords?.revealed.has(key);
    const masked = !!hideWords && !revealed;
    const hl = showHighlights || editMode ? highlights[item.ayahKey]?.get(item.wordIndex0) : undefined;
    const selected = editMode && isWordSelected(item);
    const active = isActive(item);
    const clickable = editMode || !!hl || masked;
    // Colour only: a background with the underline painted into it, so the word keeps its exact width.
    const style: CSSProperties | undefined =
      hl && !selected
        ? {
            backgroundImage: `linear-gradient(to top, ${HIGHLIGHT_BORDER_COLORS[hl.colorIndex]} 2px, ${HIGHLIGHT_COLORS[hl.colorIndex]} 2px)`,
          }
        : undefined;
    return (
      <span
        key={key}
        data-w={key}
        data-copy={glyphs ? item.word.text : undefined}
        className={`rounded ${clickable ? "cursor-pointer" : ""} ${
          selected ? "ring-2 ring-amber-400 bg-amber-500/20" : ""
        } ${active && !selected ? "bg-gold/20 shadow-[inset_0_-2px_0_var(--gold)]" : ""} ${revealed ? REVEALED_CLASS : ""}`}
        style={style}
        onClick={clickable ? () => (masked ? hideWords?.onReveal(key) : handleWordClick(item)) : undefined}
      >
        {glyphs ? (
          <>
            {/* Glyph codes mean nothing outside the page's font: screen readers get the text instead. */}
            <span aria-hidden="true">{glyphRun(item.word.glyph)}</span>
            <span className="sr-only">{item.word.text} </span>
          </>
        ) : (
          item.word.hafs
        )}
      </span>
    );
  };

  const renderEnd = (item: Extract<LineItem, { kind: "end" }>) =>
    glyphs ? (
      <span
        key={`end-${item.ayahKey}`}
        className={isActive(item) ? "text-gold-text" : "text-gold"}
        data-a={item.ayahKey}
        data-copy={ayahNumberText(item.ayah)}
      >
        <span aria-hidden="true">{item.glyph}</span>
        <span className="sr-only">({item.ayah}) </span>
      </span>
    ) : (
      <span key={`end-${item.ayahKey}`} data-a={item.ayahKey}>
        <VerseMarker ayahNumber={item.ayah} />
      </span>
    );

  const effectiveLineEm = page.lineWidthEm ?? lineWidthEm;

  return (
    <div
      className={`mushaf ${hideWords ? "words-hidden" : ""} ${align === "center" ? "mx-auto" : align === "left" ? "mr-auto" : "ml-auto"} text-ink`}
      dir="rtl"
      style={{ "--line-em": effectiveLineEm } as CSSProperties}
    >
      {glyphs ? (
        <div
          lang="ar"
          className={`mushaf-glyphs ${fontState === "loading" ? "invisible overflow-hidden" : ""}`}
          onCopy={copyText}
          style={{ fontFamily: `"${pageFontFamily(page.pageNumber, pack)}"` }}
        >
          {lines.map((line) => {
            if (line.kind === "surah") {
              const meta = surahMeta(line.surah);
              return <SurahHeader key={line.n} glyphs fontFamily={surahNamesFamily(pack)} surahIndex={line.surah} surahName={meta?.name ?? ""} tname={meta?.tname ?? ""} />;
            }
            if (line.kind === "bismillah") {
              return <Bismillah key={line.n} glyphs={bismillah} fontFamily={pageFontFamily(BISMILLAH_PAGE, pack)} />;
            }
            return (
              <div key={line.n} className={`mushaf-line ${line.centered ? "justify-center gap-[0.35em]" : "justify-between"}`}>
                {line.items.map((item) => (item.kind === "word" ? renderWord(item) : renderEnd(item)))}
              </div>
            );
          })}
        </div>
      ) : (
        <div lang="ar" className="font-quran mushaf-unicode space-y-0.5">
          {lines.map((line) => {
            if (line.kind === "surah") {
              const meta = surahMeta(line.surah);
              return <SurahHeader key={line.n} surahIndex={line.surah} surahName={meta?.name ?? ""} tname={meta?.tname ?? ""} />;
            }
            if (line.kind === "bismillah") return <Bismillah key={line.n} />;
            return (
              <div
                key={line.n}
                className={`flex items-baseline flex-wrap leading-[1.85] ${
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
