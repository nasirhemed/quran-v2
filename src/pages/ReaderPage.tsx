import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@/hooks/useNavigation";
import { useQuranPage } from "@/hooks/useQuranPage";
import { useSidePanel } from "@/hooks/useSidePanel";
import { useLocalPhrases } from "@/hooks/useLocalPhrases";
import { useHiddenWords } from "@/hooks/useHiddenWords";
import { useTheme } from "@/hooks/useTheme";
import { fetchSurahs } from "@/lib/data";
import { saveLastRead } from "@/lib/lastRead";
import { useMushafPages } from "@/hooks/useMushafLayout";
import { bismillahGlyphs } from "@/lib/mushaf/layout";
import NavigationBar from "@/components/layout/NavigationBar";
import QuranPage from "@/components/page/QuranPage";
import SidePanel from "@/components/sidepanel/SidePanel";
import SelectionActionBar from "@/components/edit/SelectionActionBar";
import AddOccurrenceDialog from "@/components/edit/AddOccurrenceDialog";
import ExportImportPanel from "@/components/edit/ExportImportPanel";
import { useFollowMode } from "@/components/recitation/FollowControl";
import { HideWordsBar, HideWordsButton } from "@/components/recitation/HideWords";
import type { WordHighlight, LocalPhrase } from "@/types";

const HIGHLIGHTS_KEY = "reader-highlights";
function loadShowHighlights(): boolean {
  try {
    return localStorage.getItem(HIGHLIGHTS_KEY) !== "off";
  } catch {
    return true;
  }
}

export default function ReaderPage() {
  const { theme, toggle: toggleTheme } = useTheme();
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
  } = useNavigation(pages);

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
  const follow = useFollowMode({
    pages,
    surahs: surahsMeta,
    currentPage,
    onNavigateToPage: navigateToPage,
    onHeard: hiding ? hide.reveal : undefined,
  });
  const onRevealWord = useCallback((key: string) => hide.reveal([key]), [hide.reveal]);

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [dialogPhrase, setDialogPhrase] = useState<LocalPhrase | null>(null);
  const [showExportImport, setShowExportImport] = useState(false);

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

  const hasHighlights = useMemo(
    () => Object.values(pageHighlights).some((m) => m.size > 0),
    [pageHighlights]
  );

  if (isLoading) {
    return (
      <div className="max-w-[44rem] mx-auto px-4 py-10">
        <div className="h-[68vh] rounded-2xl bg-card border border-edge animate-pulse" />
      </div>
    );
  }

  const currentSurah = page?.surahGroups[0]?.surahIndex;
  const surahNames = page?.surahGroups.map((g) => g.tname).join(" · ");

  return (
    <div className="min-h-screen">
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

      <main className={`max-w-[45rem] mx-auto px-2 sm:px-6 pt-4 sm:pt-6 pb-16 ${localPhrases.selection ? "pb-28" : ""}`}>
        {hiding && (
          <div className="mb-3">
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
            <article className="bg-card border border-edge rounded-2xl shadow-card px-3 sm:px-8 py-4 sm:py-6">
              {/* Page header: Surah name(s), Juz, Page number, and quick Day/Night button on phones */}
              <div className="flex items-center justify-between gap-2 pb-3 mb-4 border-b border-edge/80 text-xs font-sans text-muted">
                <span className="font-semibold text-ink-soft truncate">{surahNames}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-muted tabular-nums">
                    Juz {page.juz} · Page {page.pageNumber}
                  </span>
                  <button
                    type="button"
                    onClick={toggleTheme}
                    aria-label={theme === "dark" ? "Switch to day theme" : "Switch to night theme"}
                    title={theme === "dark" ? "Switch to day theme" : "Switch to night theme"}
                    className="sm:hidden w-7 h-7 rounded-lg border border-edge bg-ground text-ink flex items-center justify-center hover:border-edge-strong transition-colors"
                  >
                    {theme === "dark" ? (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364 6.364l-1.414-1.414M7.05 7.05L5.636 5.636m12.728 0l-1.414 1.414M7.05 16.95l-1.414 1.414M12 8a4 4 0 100 8 4 4 0 000-8z" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <QuranPage
                page={page}
                pack={mushaf.data!.layout.pack}
                lineWidthEm={mushaf.data!.lineWidthEm}
                highlights={pageHighlights}
                surahs={surahs}
                bismillah={bismillah}
                activeAyah={activeAyah}
                onHighlightClick={handleHighlightClick}
                editMode={localPhrases.editMode}
                wordSelection={localPhrases.selection}
                onWordSelect={localPhrases.handleWordClick}
                hideWords={hiding ? { revealed: hide.revealed, onReveal: onRevealWord } : null}
                showHighlights={showHighlights}
              />

              {hasHighlights && showHighlights && !hiding && !localPhrases.editMode && (
                <div className="mt-5 pt-3 border-t border-edge/70 text-center text-xs text-muted font-sans">
                  Tap any highlighted phrase to compare similar verses
                </div>
              )}
            </article>

            {/* Bottom page-turn controls */}
            <div className="flex items-center justify-between gap-3 mt-4 px-1">
              <button
                type="button"
                onClick={prevPage}
                disabled={currentPage <= 1}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-edge bg-card text-sm font-medium text-ink shadow-card hover:border-primary/45 hover:text-primary disabled:opacity-35 disabled:cursor-not-allowed transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span>Previous</span>
              </button>

              <span className="text-xs font-medium text-muted font-sans tabular-nums">
                Page {currentPage} of 604
              </span>

              <button
                type="button"
                onClick={nextPage}
                disabled={currentPage >= 604}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-edge bg-card text-sm font-medium text-ink shadow-card hover:border-primary/45 hover:text-primary disabled:opacity-35 disabled:cursor-not-allowed transition-all"
              >
                <span>Next</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </>
        ) : (
          <div className="text-center py-20 text-muted">Page not found</div>
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
