import { useState, useCallback, type ReactNode } from "react";
import type { SurahMeta, JuzMeta } from "@/types";

interface NavigationBarProps {
  currentPage: number;
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

export default function NavigationBar({
  currentPage,
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
  const [pageInput, setPageInput] = useState("");

  const handlePageSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const num = Number(pageInput);
      if (num >= 1 && num <= 604) {
        onNavigateToPage(num);
        setPageInput("");
      }
    },
    [pageInput, onNavigateToPage]
  );

  return (
    <nav data-sticky-top className="sticky top-14 z-20 bg-surface-light/95 backdrop-blur border-b border-slate-700">
      {/* Desktop navigation */}
      <div className="hidden md:flex max-w-7xl mx-auto px-4 py-3 items-center justify-between gap-4">
        {/* Left side - Surah and Juz selectors */}
        <div className="flex items-center gap-2">
          <select
            className="bg-surface border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 font-sans focus:outline-none focus:border-amber-500"
            value=""
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
            className="bg-surface border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 font-sans focus:outline-none focus:border-amber-500"
            value=""
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
        <div className="flex items-center gap-3">
          <button
            onClick={onPrevPage}
            disabled={currentPage <= 1}
            className="w-8 h-8 flex items-center justify-center bg-surface border border-slate-600 rounded hover:bg-surface-lighter disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg
              className="w-4 h-4 text-slate-200"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          <span className="text-sm text-slate-300 font-sans min-w-[100px] text-center">
            Page <span className="font-medium">{currentPage}</span> / 604
          </span>

          <button
            onClick={onNextPage}
            disabled={currentPage >= 604}
            className="w-8 h-8 flex items-center justify-center bg-surface border border-slate-600 rounded hover:bg-surface-lighter disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg
              className="w-4 h-4 text-slate-200"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>

        {/* Right side - Jump to + edit controls */}
        <div className="flex items-center gap-3">
          {voiceControl}
          <form onSubmit={handlePageSubmit} className="flex items-center gap-2">
            <span className="text-sm text-slate-400 font-sans">Jump to</span>
            <input
              type="number"
              min={1}
              max={604}
              placeholder={String(currentPage)}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              className="w-16 bg-surface border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 text-center font-sans focus:outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-slate-200 rounded text-sm font-sans transition-colors"
            >
              Go
            </button>
          </form>

          {editMode && onExportImport && (
            <button
              onClick={onExportImport}
              className="px-2 py-1.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors font-sans"
            >
              Export/Import
            </button>
          )}
          {onToggleEditMode && (
            <button
              onClick={onToggleEditMode}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors font-sans ${
                editMode
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/50 hover:bg-amber-500/30"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              }`}
            >
              {editMode ? "Exit Edit" : "Edit"}
            </button>
          )}
        </div>
      </div>

      {/* Mobile navigation */}
      <div className="md:hidden px-4 py-3 space-y-3">
        {/* Top row - Surah and Juz selectors (and Follow); folded away while following */}
        <div className={`flex items-center gap-2 ${compact ? "hidden" : ""}`}>
          <select
            className="flex-1 bg-surface border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 font-sans focus:outline-none focus:border-amber-500"
            value=""
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
            className="flex-1 bg-surface border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 font-sans focus:outline-none focus:border-amber-500"
            value=""
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

          {voiceControl}
        </div>

        {/* Bottom row - Page navigation and jump */}
        <div className="flex items-center justify-between gap-3">
          {/* Page navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={onPrevPage}
              disabled={currentPage <= 1}
              className="w-9 h-9 flex items-center justify-center bg-surface border border-slate-600 rounded hover:bg-surface-lighter disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <svg
                className="w-4 h-4 text-slate-200"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>

            <span className="text-sm text-slate-300 font-sans whitespace-nowrap">
              <span className="font-medium">{currentPage}</span> / 604
            </span>

            <button
              onClick={onNextPage}
              disabled={currentPage >= 604}
              className="w-9 h-9 flex items-center justify-center bg-surface border border-slate-600 rounded hover:bg-surface-lighter disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <svg
                className="w-4 h-4 text-slate-200"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          </div>

          {/* Jump to */}
          <form onSubmit={handlePageSubmit} className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={604}
              placeholder={String(currentPage)}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              className="w-14 bg-surface border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 text-center font-sans focus:outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 text-slate-200 rounded text-sm font-sans transition-colors"
            >
              Go
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}
