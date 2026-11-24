import { useCallback, useDeferredValue, useEffect, useMemo, useState, type CSSProperties, type MutableRefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@/hooks/useNavigation";
import { useQuranPage } from "@/hooks/useQuranPage";
import { useSidePanel } from "@/hooks/useSidePanel";
import { useLocalPhrases } from "@/hooks/useLocalPhrases";
import { useHiddenWords } from "@/hooks/useHiddenWords";
import { fetchSurahs } from "@/lib/data";
import { saveLastRead } from "@/lib/lastRead";
import { useMushafPages } from "@/hooks/useMushafLayout";
import { usePageSpread } from "@/hooks/usePageSpread";
import { useSpreadFit } from "@/hooks/useSpreadFit";
import { useSwipePager } from "@/hooks/useSwipePager";
import { nextSpreadPage, prevSpreadPage, spreadOf, type Spread } from "@/lib/mushaf/spread";
import { SWIPE_GAP_PX } from "@/lib/mushaf/swipe";
import { bismillahGlyphs } from "@/lib/mushaf/layout";
import NavigationBar from "@/components/layout/NavigationBar";
import QuranPage from "@/components/page/QuranPage";
import SidePanel from "@/components/sidepanel/SidePanel";
import SelectionActionBar from "@/components/edit/SelectionActionBar";
import AddOccurrenceDialog from "@/components/edit/AddOccurrenceDialog";
import ExportImportPanel from "@/components/edit/ExportImportPanel";
import { useFollowMode } from "@/components/recitation/FollowControl";
import { HideWordsBar, HideWordsButton } from "@/components/recitation/HideWords";
import type { WordHighlight, LocalPhrase, PageHighlightMap, QuranPage as QuranPageData } from "@/types";
import { fetchAyahHighlights } from "@/lib/data";
import { computePageHighlights, mergeHighlights } from "@/lib/highlights";

const HIGHLIGHTS_KEY = "reader-highlights";
function loadShowHighlights(): boolean {
  try {
    return localStorage.getItem(HIGHLIGHTS_KEY) !== "off";
  } catch {
    return true;
  }
}

type Shown = { page: QuranPageData; highlights: PageHighlightMap } | null;

export default function ReaderPage() {
  const [showHighlights, setShowHighlights] = useState(loadShowHighlights);
  const toggleHighlights = useCallback(() => {
    setShowHighlights((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(HIGHLIGHTS_KEY, next ? "on" : "off");
      } catch {
        // private mode
      }
      return next;
    });
  }, []);

  const mushaf = useMushafPages();
  const pages = mushaf.data?.pages;
  // Two facing pages when the screen is wide enough (tablet sideways, unfolded foldable, desktop).
  const twoPages = usePageSpread();
  const {
    currentPage,
    activeAyah,
    surahs,
    juzs,
    navigateToPage,
    navigateToSurah,
    navigateToJuz,
    navigateToAyah,
    nextPage,
    prevPage,
  } = useNavigation(pages, twoPages);
  const pageCount = pages?.length || 604;
  const spread = twoPages ? spreadOf(currentPage, pageCount) : null;
  const isSpread = !!spread;
  const spreadFit = useSpreadFit(isSpread);
  // A spread on a short screen goes full screen like the phone reader: the app's tab bar steps aside (index.css)
  // and its tabs move into the ⋯ menu.
  useEffect(() => {
    document.documentElement.toggleAttribute("data-reader-spread", isSpread);
    return () => document.documentElement.removeAttribute("data-reader-spread");
  }, [isSpread]);
  const atFirst = (spread ? spread.right : currentPage) <= 1;
  const atLast = (spread ? spread.left ?? spread.right : currentPage) >= pageCount;
  const pageLabel = spread ? (spread.left ? `${spread.right}–${spread.left}` : `${spread.right}`) : `${currentPage}`;

  const { data: surahsMeta } = useQuery({
    queryKey: ["surahs"],
    queryFn: fetchSurahs,
  });

  const localPhrases = useLocalPhrases(pages);
  const bismillah = useMemo(() => (pages ? bismillahGlyphs(pages) : []), [pages]);

  const { page, pageHighlights, isLoading } = useQuranPage(
    pages,
    currentPage,
    localPhrases.localHighlights
  );

  // The views (a page, or a spread by its right-hand page) on the swipe track: this one in the middle, the next on
  // its left and the previous on its right, as in a printed mushaf. They stay mounted, so a swipe starts without
  // rendering anything and a turn moves the neighbour's own DOM into the middle. The new neighbours after a turn are
  // worked out from a deferred page, so mounting them never holds up the turn itself.
  const deferredPage = useDeferredValue(currentPage);
  const anchorOf = (n: number) => (spread ? spreadOf(n, pageCount).right : n);
  const stepFrom = (n: number, dir: 1 | -1): number | null => {
    if (spread) return dir > 0 ? nextSpreadPage(n, pageCount) : prevSpreadPage(n, pageCount);
    const to = n + dir;
    return to >= 1 && to <= pageCount ? to : null;
  };
  const currentAnchor = anchorOf(currentPage);
  const deferredAnchor = anchorOf(deferredPage);
  const anchors = [
    ...new Set(
      [currentAnchor, deferredAnchor, stepFrom(deferredAnchor, 1), stepFrom(deferredAnchor, -1)].filter(
        (n): n is number => n !== null
      )
    ),
  ].sort((a, b) => a - b);
  const { data: ayahHighlights } = useQuery({ queryKey: ["ayah-highlights"], queryFn: fetchAyahHighlights });
  const mergedHighlights = useMemo(
    () => (ayahHighlights ? mergeHighlights(ayahHighlights, localPhrases.localHighlights) : undefined),
    [ayahHighlights, localPhrases.localHighlights]
  );
  const viewCache = useMemo(() => new Map<number, Shown>(), [pages, mergedHighlights]);
  const pageData = (n: number | null): Shown => {
    if (!n || !pages) return null;
    let hit = viewCache.get(n);
    if (hit === undefined) {
      const p = pages.find((x) => x.pageNumber === n);
      hit = p ? { page: p, highlights: mergedHighlights ? computePageHighlights(p, mergedHighlights) : {} } : null;
      viewCache.set(n, hit);
    }
    return hit;
  };

  // Remember the reader's place for HomePage's "Continue reading" card.
  useEffect(() => {
    if (!page) return;
    const first = page.surahGroups[0];
    if (!first) return;
    saveLastRead({
      page: page.pageNumber,
      surah: first.surahIndex,
      tname: first.tname,
      juz: page.juz,
    });
  }, [page]);

  const sidePanel = useSidePanel(localPhrases.phrases);
  const hide = useHiddenWords();
  const hiding = hide.hidden && !localPhrases.editMode;
  const compactPageControl = page ? (
    <div className="inline-flex items-center gap-0.5 text-faint font-sans select-none">
      <button
        type="button"
        onClick={prevPage}
        disabled={atFirst}
        aria-label="Previous page"
        title="Previous page (Right arrow)"
        className="w-6 h-6 flex items-center justify-center rounded-md hover:text-ink hover:bg-card2/70 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span className="text-[11px] font-medium text-muted tabular-nums min-w-[1.75rem] text-center">
        {pageLabel}
      </span>
      <button
        type="button"
        onClick={nextPage}
        disabled={atLast}
        aria-label="Next page"
        title="Next page (Left arrow)"
        className="w-6 h-6 flex items-center justify-center rounded-md hover:text-ink hover:bg-card2/70 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  ) : null;
  const follow = useFollowMode({
    pages,
    surahs: surahsMeta,
    currentPage,
    onNavigateToPage: navigateToPage,
    onHeard: hiding ? hide.reveal : undefined,
    pageControl: compactPageControl,
  });
  const onRevealWord = useCallback((key: string) => hide.reveal([key]), [hide.reveal]);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [dialogPhrase, setDialogPhrase] = useState<LocalPhrase | null>(null);
  const [showExportImport, setShowExportImport] = useState(false);

  // Pull the page right for the next page (spread), left for the previous, as the arrow keys; not under a dialog.
  const pager = useSwipePager({
    page: currentPage,
    canNext: !atLast,
    canPrev: !atFirst,
    onNext: nextPage,
    onPrev: prevPage,
    enabled: !showAddDialog && !showExportImport,
  });
  const bindViewport = useCallback(
    (node: HTMLDivElement | null) => {
      (spreadFit.ref as MutableRefObject<HTMLDivElement | null>).current = node;
      pager.bind(node);
    },
    [spreadFit.ref, pager.bind]
  );

  const handleHighlightClick = useCallback(
    (highlight: WordHighlight) => {
      if (highlight.id.startsWith("local-")) {
        const phraseId = highlight.id.replace("local-", "");
        sidePanel.openLocalPhrase(phraseId);
      } else if (highlight.type === "phrase") {
        sidePanel.openPhrase(highlight.id);
      } else {
        sidePanel.openSimilar(highlight.id);
      }
    },
    [sidePanel]
  );

  const handleSidePanelNavigate = useCallback(
    (surah: number, ayah: number) => {
      navigateToAyah(surah, ayah);
      sidePanel.close();
    },
    [navigateToAyah, sidePanel]
  );

  const handleAddPhrase = useCallback(() => {
    const phrase = localPhrases.createPhraseFromSelection();
    if (phrase) {
      setDialogPhrase(phrase);
      setShowAddDialog(true);
    }
  }, [localPhrases]);

  const handleAddOccurrenceFromDialog = useCallback(
    (phraseId: string, ayahKey: string, wordRange: [number, number]) => {
      localPhrases.addOccurrence(phraseId, ayahKey, wordRange);
      // Update the dialog phrase reference
      setDialogPhrase((prev) => {
        if (!prev || prev.id !== phraseId) return prev;
        return {
          ...prev,
          occurrences: [...prev.occurrences, { ayahKey, wordRange }],
        };
      });
    },
    [localPhrases]
  );

  const handleDialogDone = useCallback(() => {
    setShowAddDialog(false);
    setDialogPhrase(null);
  }, []);

  const handleAddOccurrenceFromSidePanel = useCallback(
    (phraseId: string) => {
      const phrase = localPhrases.phrases.find((p) => p.id === phraseId);
      if (phrase) {
        setDialogPhrase(phrase);
        setShowAddDialog(true);
        sidePanel.close();
      }
    },
    [localPhrases.phrases, sidePanel]
  );

  const handleDeleteLocalPhrase = useCallback(
    (phraseId: string) => {
      localPhrases.deletePhrase(phraseId);
      sidePanel.close();
    },
    [localPhrases, sidePanel]
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-card px-4 py-8">
        <div className="w-full max-w-[26rem] h-[72dvh] rounded-xl bg-card2/50 animate-pulse" />
      </div>
    );
  }

  const currentSurah = page?.surahGroups[0]?.surahIndex;

  const renderPage = (p: NonNullable<typeof page>, highlights: typeof pageHighlights, align: "center" | "left" | "right") => (
    <QuranPage
      key={p.pageNumber}
      page={p}
      pack={mushaf.data!.layout.pack}
      lineWidthEm={mushaf.data!.lineWidthEm}
      highlights={highlights}
      surahs={surahs}
      bismillah={bismillah}
      activeAyah={activeAyah}
      onHighlightClick={handleHighlightClick}
      editMode={localPhrases.editMode}
      wordSelection={localPhrases.selection}
      onWordSelect={localPhrases.handleWordClick}
      hideWords={hiding ? { revealed: hide.revealed, onReveal: onRevealWord } : null}
      showHighlights={showHighlights}
      align={align}
      preloadAround={spread ? 3 : 1}
    />
  );
  // Right-to-left like a printed mushaf: the lower (odd) page on the right.
  /** one page, or two facing pages each in half the width meeting at a faint gutter in the middle */
  const renderView = (sp: Spread | null, single: Shown, right: Shown, left: Shown) =>
    sp ? (
      <div className="mushaf-spread h-full w-full flex items-center justify-center gap-2 lg:gap-5" data-spread>
        <div className="flex-1 min-w-0 flex">{left?.page && renderPage(left.page, left.highlights, "right")}</div>
        <div aria-hidden className="w-px self-stretch my-4 bg-edge/70 shrink-0" />
        <div className="flex-1 min-w-0 flex">{right?.page && renderPage(right.page, right.highlights, "left")}</div>
      </div>
    ) : (
      <div className="flex-1 w-full flex items-center justify-center">
        {single && renderPage(single.page, single.highlights, "center")}
      </div>
    );

  // Dynamic chrome below/inside main (top bar height comes from .reader-main's responsive --shell-chrome in index.css:
  // 42px on mobile where AppShell tabs hide, 94px on sm+): 32px footer+gap (or 40px when Follow strip replaces it).
  const showingFollowStrip = !localPhrases.editMode && follow.stripVisible;
  const hasSelectionBar = localPhrases.editMode && !!localPhrases.selection;
  const extraChromePx =
    (showingFollowStrip ? 40 : 32) +
    (hiding ? 36 : 0) +
    (hasSelectionBar ? 64 : 0);

  return (
    <div className="flex-1 flex flex-col bg-card">
      <NavigationBar
        currentPage={currentPage}
        currentSurah={currentSurah}
        currentJuz={page?.juz}
        surahs={surahs}
        juzs={juzs}
        onNavigateToPage={navigateToPage}
        onNavigateToSurah={navigateToSurah}
        onNavigateToJuz={navigateToJuz}
        onPrevPage={prevPage}
        onNextPage={nextPage}
        editMode={localPhrases.editMode}
        onToggleEditMode={localPhrases.toggleEditMode}
        onExportImport={() => setShowExportImport(true)}
        showHighlights={showHighlights}
        onToggleHighlights={toggleHighlights}
        voiceControl={
          localPhrases.editMode ? null : (
            <>
              <HideWordsButton hidden={hide.hidden} onToggle={hide.toggle} />
              {follow.button}
            </>
          )
        }
        compact={follow.following}
      />

      <main
        className={`reader-main relative flex-1 flex flex-col items-center justify-between px-1.5 sm:px-6 pt-0.5 pb-0.5 ${
          showingFollowStrip
            ? "pb-[calc(2.5rem+env(safe-area-inset-bottom))]"
            : hasSelectionBar
              ? "pb-16"
              : ""
        }`}
        style={{ "--reader-extra-chrome": `${extraChromePx}px` } as CSSProperties}
      >
        {hiding && (
          <div className="w-full max-w-2xl mb-1 shrink-0">
            <HideWordsBar
              canFollow={follow.supported}
              following={follow.following}
              revealedCount={hide.revealedCount}
              onReset={hide.reset}
              onShowAll={hide.toggle}
            />
          </div>
        )}

        {page ? (
          <>
            {/* Subtle desktop margin page-turn buttons */}
            <button
              type="button"
              onClick={prevPage}
              disabled={atFirst}
              aria-label="Previous page"
              title="Previous page (Right arrow)"
              className="hidden lg:flex fixed left-5 top-1/2 -translate-y-1/2 z-10 w-9 h-9 items-center justify-center rounded-full text-faint hover:text-ink hover:bg-card2/70 disabled:opacity-0 disabled:pointer-events-none transition-all"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <button
              type="button"
              onClick={nextPage}
              disabled={atLast}
              aria-label="Next page"
              title="Next page (Left arrow)"
              className="hidden lg:flex fixed right-5 top-1/2 -translate-y-1/2 z-10 w-9 h-9 items-center justify-center rounded-full text-faint hover:text-ink hover:bg-card2/70 disabled:opacity-0 disabled:pointer-events-none transition-all"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {/* The page (or spread) and, while a swipe pulls them across, its neighbours on a sliding track */}
            <div
              ref={bindViewport}
              className="relative flex-1 self-stretch -mx-1.5 sm:-mx-6 flex flex-col overflow-hidden"
              style={
                spread && spreadFit.height
                  ? ({ "--spread-h": `${spreadFit.height}px`, flex: "none", height: spreadFit.height } as CSSProperties)
                  : undefined
              }
            >
              <div ref={pager.trackRef} className="relative flex-1 flex flex-col">
                {anchors.map((a, i) => {
                  // + = later pages, to the left
                  const slot = i - anchors.indexOf(currentAnchor);
                  const sp = spread ? spreadOf(a, pageCount) : null;
                  const shift = `calc(${Math.abs(slot) * 100}% + ${Math.abs(slot) * SWIPE_GAP_PX}px)`;
                  return (
                    <div
                      key={a}
                      aria-hidden={slot !== 0 || undefined}
                      {...(slot !== 0 ? { inert: "" } : {})}
                      className={`${slot === 0 ? "relative flex-1" : "absolute inset-y-0 w-full"} flex flex-col px-1.5 sm:px-6`}
                      style={slot > 0 ? { right: shift } : slot < 0 ? { left: shift } : undefined}
                    >
                      {renderView(sp, pageData(a), pageData(sp?.right ?? null), pageData(sp?.left ?? null))}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quiet centered page number footer (folded into the Follow strip while following) */}
            {!showingFollowStrip && (
              <footer className="shrink-0 h-7 flex items-center justify-center gap-3 text-faint font-sans select-none">
                <button
                  type="button"
                  onClick={prevPage}
                  disabled={atFirst}
                  aria-label="Previous page"
                  title="Previous page (Right arrow)"
                  className="w-7 h-7 flex items-center justify-center rounded-md hover:text-ink hover:bg-card2/70 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>

                <span className="text-xs font-medium text-muted tabular-nums min-w-[2.25rem] text-center">
                  {pageLabel}
                </span>

                <button
                  type="button"
                  onClick={nextPage}
                  disabled={atLast}
                  aria-label="Next page"
                  title="Next page (Left arrow)"
                  className="w-7 h-7 flex items-center justify-center rounded-md hover:text-ink hover:bg-card2/70 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </footer>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted text-sm">Page not found</div>
        )}
      </main>

      {!localPhrases.editMode && follow.strip}

      {localPhrases.editMode && localPhrases.selection && (
        <SelectionActionBar
          selection={localPhrases.selection}
          pages={pages}
          onAddPhrase={handleAddPhrase}
          onClear={localPhrases.clearSelection}
        />
      )}

      {showAddDialog && dialogPhrase && pages && surahsMeta && (
        <AddOccurrenceDialog
          phrase={dialogPhrase}
          surahs={surahsMeta}
          pages={pages}
          onAddOccurrence={handleAddOccurrenceFromDialog}
          onDone={handleDialogDone}
        />
      )}

      {showExportImport && (
        <ExportImportPanel
          onExport={localPhrases.exportPhrases}
          onImport={localPhrases.importPhrases}
          onClose={() => setShowExportImport(false)}
        />
      )}

      <SidePanel
        isOpen={sidePanel.isOpen}
        content={sidePanel.content}
        currentPhrase={sidePanel.currentPhrase}
        currentSimilar={sidePanel.currentSimilar}
        currentLocalPhrase={sidePanel.currentLocalPhrase}
        surahs={surahsMeta}
        onClose={sidePanel.close}
        onNavigate={handleSidePanelNavigate}
        onDeleteLocalPhrase={handleDeleteLocalPhrase}
        onRemoveOccurrence={localPhrases.removeOccurrence}
        onAddOccurrence={handleAddOccurrenceFromSidePanel}
      />
    </div>
  );
}
