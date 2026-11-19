import { useState, useCallback, useEffect, type ReactNode } from "react";
import { Link } from "wouter";
import type { SurahMeta, JuzMeta } from "@/types";

interface NavigationBarProps {
  currentPage: number;
  currentSurah?: number;
  currentJuz?: number;
  surahs: SurahMeta[];
  juzs: JuzMeta[];
  onNavigateToPage: (page: number) => void;
  onNavigateToSurah: (surah: number) => void;
  onNavigateToJuz: (juz: number) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  editMode?: boolean;
  onToggleEditMode?: () => void;
  onExportImport?: () => void;
  /** voice Follow button (shown in the bar, never over the text) */
  voiceControl?: ReactNode;
  /** while following: on phones, fold away the Surah/Juz row to give the page more room */
  compact?: boolean;
}

const selectCls =
  "bg-card border border-edge hover:border-edge-strong rounded-xl px-2.5 py-1.5 text-sm text-ink font-sans focus:outline-none focus:border-primary transition-colors";

export default function NavigationBar({
  currentPage,
  currentSurah,
  currentJuz,
  surahs,
  juzs,
  onNavigateToPage,
  onNavigateToSurah,
  onNavigateToJuz,
  onPrevPage,
  onNextPage,
  editMode,
  onToggleEditMode,
  onExportImport,
  voiceControl,
  compact,
}: NavigationBarProps) {
  const [pageInput, setPageInput] = useState(String(currentPage));

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  const commitPage = useCallback(
    (raw: string) => {
      const num = Number(raw);
      if (Number.isInteger(num) && num >= 1 && num <= 604 && num !== currentPage) {
        onNavigateToPage(num);
      } else {
        setPageInput(String(currentPage));
      }
    },
    [currentPage, onNavigateToPage]
  );

  const handlePageSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      commitPage(pageInput);
      (document.activeElement as HTMLElement | null)?.blur?.();
    },
    [pageInput, commitPage]
  );

  const pager = (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onPrevPage}
        disabled={currentPage <= 1}
        aria-label="Previous page"
        title="Previous page (Right arrow)"
        className="w-8 h-8 flex items-center justify-center bg-card border border-edge rounded-xl text-ink hover:bg-card2 hover:border-edge-strong disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <form onSubmit={handlePageSubmit} className="flex items-center gap-1 bg-card border border-edge rounded-xl px-2 h-8">
        <span className="text-xs text-muted font-sans hidden sm:inline">Page</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={604}
          aria-label="Page number"
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          onBlur={() => commitPage(pageInput)}
          onFocus={(e) => e.currentTarget.select()}
          className="w-10 bg-transparent text-sm font-semibold text-ink text-center font-sans tabular-nums focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-xs text-faint font-sans tabular-nums">/ 604</span>
      </form>

      <button
        type="button"
        onClick={onNextPage}
        disabled={currentPage >= 604}
        aria-label="Next page"
        title="Next page (Left arrow)"
        className="w-8 h-8 flex items-center justify-center bg-card border border-edge rounded-xl text-ink hover:bg-card2 hover:border-edge-strong disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );

  return (
    <nav data-sticky-top className="sticky top-14 z-20 bg-ground/92 backdrop-blur-md border-b border-edge">
      {/* Desktop navigation */}
      <div className="hidden md:flex max-w-6xl mx-auto px-4 py-2.5 items-center justify-between gap-3">
        {/* Left side - Back + Surah and Juz selectors */}
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href="/"
            title="All surahs"
            aria-label="Back to surah list"
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-xl border border-edge bg-card text-muted hover:text-ink hover:border-edge-strong transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>

          <select
            aria-label="Select surah"
            className={`${selectCls} max-w-[190px] truncate`}
            value={currentSurah ?? ""}
            onChange={(e) => onNavigateToSurah(Number(e.target.value))}
          >
            <option value="" disabled>
              Surah
            </option>
            {surahs.map((s) => (
              <option key={s.index} value={s.index}>
                {s.index}. {s.tname}
              </option>
            ))}
          </select>

          <select
            aria-label="Select juz"
            className={selectCls}
            value={currentJuz ?? ""}
            onChange={(e) => onNavigateToJuz(Number(e.target.value))}
          >
            <option value="" disabled>
              Juz
            </option>
            {juzs.map((j) => (
              <option key={j.index} value={j.index}>
                Juz {j.index}
              </option>
            ))}
          </select>
        </div>

        {/* Center - Page navigation */}
        {pager}

        {/* Right side - Voice/Hide + Edit controls */}
        <div className="flex items-center gap-2 shrink-0">
          {voiceControl}

          {editMode && onExportImport && (
            <button
              onClick={onExportImport}
              className="px-3 h-9 rounded-full text-xs font-medium bg-card border border-edge hover:border-edge-strong text-ink transition-colors font-sans"
            >
              Export/Import
            </button>
          )}
          {onToggleEditMode && (
            <button
              onClick={onToggleEditMode}
              title={editMode ? "Finish editing custom phrases" : "Highlight and save your own similar phrases"}
              className={`px-3 h-9 rounded-full text-xs font-semibold transition-colors font-sans border ${
                editMode
                  ? "bg-gold/15 text-gold-text border-gold/50 hover:bg-gold/25"
                  : "bg-card border-edge text-muted hover:text-ink hover:border-edge-strong"
              }`}
            >
              {editMode ? "Done editing" : "Edit"}
            </button>
          )}
        </div>
      </div>

      {/* Mobile navigation */}
      <div className="md:hidden px-3 py-2 space-y-2">
        {/* Top row - Surah and Juz selectors; folded away while following */}
        <div className={`flex items-center gap-1.5 ${compact ? "hidden" : ""}`}>
          <Link
            href="/"
            aria-label="Back to surah list"
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-xl border border-edge bg-card text-muted hover:text-ink transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>

          <select
            aria-label="Select surah"
            className={`flex-1 min-w-0 ${selectCls} py-1 text-[13px]`}
            value={currentSurah ?? ""}
            onChange={(e) => onNavigateToSurah(Number(e.target.value))}
          >
            <option value="" disabled>
              Surah
            </option>
            {surahs.map((s) => (
              <option key={s.index} value={s.index}>
                {s.index}. {s.tname}
              </option>
            ))}
          </select>

          <select
            aria-label="Select juz"
            className={`w-[5.25rem] shrink-0 ${selectCls} py-1 text-[13px]`}
            value={currentJuz ?? ""}
            onChange={(e) => onNavigateToJuz(Number(e.target.value))}
          >
            <option value="" disabled>
              Juz
            </option>
            {juzs.map((j) => (
              <option key={j.index} value={j.index}>
                Juz {j.index}
              </option>
            ))}
          </select>
        </div>

        {/* Bottom row - Pager and voice/hide tools */}
        <div className="flex items-center justify-between gap-2">
          {pager}
          <div className="flex items-center gap-1.5">{voiceControl}</div>
        </div>
      </div>
    </nav>
  );
}
