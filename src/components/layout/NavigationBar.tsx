import { useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from "react";
import { Link } from "wouter";
import { useTheme } from "@/hooks/useTheme";
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
  showHighlights?: boolean;
  onToggleHighlights?: () => void;
  /** voice Follow / Hide controls (shown in the bar, never over the text) */
  voiceControl?: ReactNode;
  /** while following: kept for API compatibility */
  compact?: boolean;
}

type JumpTab = "surah" | "juz";

export default function NavigationBar({
  currentPage,
  currentSurah,
  currentJuz,
  surahs,
  juzs,
  onNavigateToPage,
  onNavigateToSurah,
  onNavigateToJuz,
  editMode,
  onToggleEditMode,
  onExportImport,
  showHighlights = true,
  onToggleHighlights,
  voiceControl,
}: NavigationBarProps) {
  const { theme, toggle: toggleTheme } = useTheme();
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpTab, setJumpTab] = useState<JumpTab>("surah");
  const [search, setSearch] = useState("");
  const [pageInput, setPageInput] = useState(String(currentPage));
  const [moreOpen, setMoreOpen] = useState(false);

  const jumpRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  // Close popovers on outside click or Escape
  useEffect(() => {
    if (!jumpOpen && !moreOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (jumpOpen && jumpRef.current && !jumpRef.current.contains(target)) {
        setJumpOpen(false);
      }
      if (moreOpen && moreRef.current && !moreRef.current.contains(target)) {
        setMoreOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setJumpOpen(false);
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [jumpOpen, moreOpen]);

  const activeSurah = useMemo(
    () => surahs.find((s) => s.index === currentSurah),
    [surahs, currentSurah]
  );

  const filteredSurahs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return surahs;
    return surahs.filter(
      (s) =>
        s.tname.toLowerCase().includes(q) ||
        s.ename.toLowerCase().includes(q) ||
        s.name.includes(search.trim()) ||
        String(s.index) === q
    );
  }, [surahs, search]);

  const commitPage = useCallback(
    (raw: string) => {
      const num = Number(raw);
      if (Number.isInteger(num) && num >= 1 && num <= 604) {
        if (num !== currentPage) onNavigateToPage(num);
        setJumpOpen(false);
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

  const progressPct = Math.min(100, Math.max(0.5, (currentPage / 604) * 100));

  return (
    <nav data-sticky-top className="sticky top-0 sm:top-12 z-30 bg-card/95 backdrop-blur-md">
      <div className="max-w-6xl mx-auto h-10 sm:h-11 px-2 sm:px-5 flex items-center justify-between gap-1.5 sm:gap-2">
        {/* Left: Compact mobile back-to-home button + Surah / Juz / Page quick-jump trigger */}
        <div className="relative flex-1 min-w-0 flex items-center gap-0.5" ref={jumpRef}>
          <Link
            href="/"
            aria-label="Back to home"
            title="Home"
            className="sm:hidden w-7 h-7 -ml-0.5 rounded-lg text-muted hover:text-ink hover:bg-card2/70 flex items-center justify-center shrink-0 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>

          <button
            type="button"
            onClick={() => {
              setMoreOpen(false);
              setSearch("");
              setJumpOpen((o) => !o);
            }}
            aria-expanded={jumpOpen}
            aria-haspopup="dialog"
            className="inline-flex items-center gap-1 sm:gap-1.5 min-w-0 max-w-full px-1.5 py-1 sm:-ml-1.5 rounded-lg hover:bg-card2/70 transition-colors text-left"
          >
            <span className="text-[13px] sm:text-sm font-semibold text-ink truncate">
              {activeSurah ? `${activeSurah.index}. ${activeSurah.tname}` : `Page ${currentPage}`}
            </span>
            <svg
              className={`w-3.5 h-3.5 shrink-0 text-muted transition-transform ${jumpOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            {currentJuz && (
              <span className="hidden sm:inline text-xs text-faint font-normal ml-0.5 tabular-nums shrink-0">
                Juz {currentJuz}
              </span>
            )}
          </button>

          {/* Quick Jump Popover */}
          {jumpOpen && (
            <div
              role="dialog"
              aria-label="Navigate mushaf"
              className="absolute left-0 top-full mt-1.5 w-[min(20rem,calc(100vw-1.5rem))] rounded-xl bg-card border border-edge shadow-xl z-50 overflow-hidden font-sans"
            >
              {/* Direct page jump */}
              <form onSubmit={handlePageSubmit} className="p-2.5 border-b border-edge/80 flex items-center gap-2">
                <label className="text-xs text-muted shrink-0" htmlFor="reader-page-jump">
                  Page
                </label>
                <input
                  id="reader-page-jump"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={604}
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-16 bg-ground border border-edge rounded-lg px-2 py-1 text-xs font-semibold text-ink text-center tabular-nums focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-xs text-faint tabular-nums">/ 604</span>
                <button
                  type="submit"
                  className="ml-auto px-2.5 py-1 rounded-lg bg-primary text-on-primary text-xs font-semibold hover:opacity-90 transition-opacity"
                >
                  Go
                </button>
              </form>

              {/* Tabs: Surahs / Juz */}
              <div className="px-2.5 pt-2 pb-1.5 flex items-center justify-between gap-2">
                <div className="inline-flex rounded-lg bg-card2/80 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setJumpTab("surah")}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      jumpTab === "surah" ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
                    }`}
                  >
                    Surah
                  </button>
                  <button
                    type="button"
                    onClick={() => setJumpTab("juz")}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      jumpTab === "juz" ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
                    }`}
                  >
                    Juz
                  </button>
                </div>
                <Link
                  href="/"
                  onClick={() => setJumpOpen(false)}
                  className="text-xs text-muted hover:text-primary transition-colors"
                >
                  All surahs
                </Link>
              </div>

              {jumpTab === "surah" ? (
                <div className="p-2 pt-1">
                  <input
                    type="text"
                    dir="auto"
                    placeholder="Filter surah…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full bg-ground border border-edge rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder-faint focus:outline-none focus:border-primary mb-1.5"
                  />
                  <div className="max-h-60 overflow-y-auto divide-y divide-edge/40">
                    {filteredSurahs.map((s) => {
                      const active = s.index === currentSurah;
                      return (
                        <button
                          key={s.index}
                          type="button"
                          onClick={() => {
                            onNavigateToSurah(s.index);
                            setJumpOpen(false);
                          }}
                          className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs transition-colors text-left ${
                            active ? "bg-primary-soft text-primary font-semibold" : "text-ink hover:bg-card2/60"
                          }`}
                        >
                          <span className="truncate">
                            <span className="tabular-nums text-faint mr-1.5">{s.index}.</span>
                            {s.tname}
                          </span>
                          <span className="text-[11px] text-faint tabular-nums shrink-0">p.{s.startPage}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="p-2.5 grid grid-cols-5 gap-1.5 max-h-64 overflow-y-auto">
                  {juzs.map((j) => {
                    const active = j.index === currentJuz;
                    return (
                      <button
                        key={j.index}
                        type="button"
                        onClick={() => {
                          onNavigateToJuz(j.index);
                          setJumpOpen(false);
                        }}
                        className={`py-1.5 rounded-lg text-xs font-medium tabular-nums transition-colors ${
                          active
                            ? "bg-primary text-on-primary font-semibold"
                            : "bg-ground text-ink hover:bg-card2 border border-edge/60"
                        }`}
                      >
                        {j.index}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Clean compact reader tools */}
        <div className="flex items-center gap-0.5 sm:gap-1.5 shrink-0">
          {!editMode && onToggleHighlights && (
            <button
              type="button"
              onClick={onToggleHighlights}
              aria-pressed={showHighlights}
              title={showHighlights ? "Hide Mutashabihat highlights" : "Show Mutashabihat highlights"}
              aria-label={showHighlights ? "Hide highlights" : "Show highlights"}
              className={`shrink-0 inline-flex items-center gap-1.5 px-2 sm:px-2.5 h-7 sm:h-8 rounded-lg text-xs font-medium transition-colors font-sans ${
                showHighlights
                  ? "bg-primary-soft text-primary"
                  : "text-muted hover:text-ink hover:bg-card2/70"
              }`}
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
              <span className="hidden md:inline">{showHighlights ? "Highlights" : "Plain"}</span>
            </button>
          )}

          {voiceControl}

          {editMode && onExportImport && (
            <button
              type="button"
              onClick={onExportImport}
              className="px-2.5 h-7 sm:h-8 rounded-lg text-xs font-medium text-ink bg-card2 hover:bg-card2/80 transition-colors font-sans"
            >
              Export
            </button>
          )}

          {editMode && onToggleEditMode && (
            <button
              type="button"
              onClick={onToggleEditMode}
              className="px-2.5 h-7 sm:h-8 rounded-lg text-xs font-semibold bg-gold/20 text-gold-text hover:bg-gold/30 transition-colors font-sans"
            >
              Done
            </button>
          )}

          {/* Overflow menu for secondary reader actions (Edit custom phrases, Theme on mobile, Settings, mobile tabs) */}
          <div className="relative" ref={moreRef}>
            <button
              type="button"
              onClick={() => {
                setJumpOpen(false);
                setMoreOpen((o) => !o);
              }}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              aria-label="More reader options"
              title="More options"
              className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-colors ${
                moreOpen ? "bg-card2 text-ink" : "text-muted hover:text-ink hover:bg-card2/70"
              }`}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                <circle cx="5" cy="12" r="1.75" />
                <circle cx="12" cy="12" r="1.75" />
                <circle cx="19" cy="12" r="1.75" />
              </svg>
            </button>

            {moreOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1.5 w-48 rounded-xl bg-card border border-edge shadow-xl py-1 z-50 font-sans text-xs"
              >
                {onToggleEditMode && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onToggleEditMode();
                      setMoreOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 text-ink hover:bg-card2/70 transition-colors"
                  >
                    <span>{editMode ? "Finish editing phrases" : "Edit custom phrases"}</span>
                  </button>
                )}
                {editMode && onExportImport && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onExportImport();
                      setMoreOpen(false);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 text-ink hover:bg-card2/70 transition-colors"
                  >
                    <span>Export / Import phrases</span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    toggleTheme();
                    setMoreOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 text-ink hover:bg-card2/70 transition-colors"
                >
                  <span>{theme === "dark" ? "Light theme" : "Dark theme"}</span>
                  <span className="text-faint">{theme === "dark" ? "Day" : "Night"}</span>
                </button>
                <div className="my-1 border-t border-edge/70" />
                <Link
                  href="/settings"
                  role="menuitem"
                  onClick={() => setMoreOpen(false)}
                  className="block px-3 py-2 text-muted hover:text-ink hover:bg-card2/70 transition-colors"
                >
                  Mushaf settings
                </Link>
                {/* Quick tab switcher on mobile where AppShell header is hidden inside the reader */}
                <div className="sm:hidden">
                  <div className="my-1 border-t border-edge/70" />
                  <Link
                    href="/browse"
                    role="menuitem"
                    onClick={() => setMoreOpen(false)}
                    className="block px-3 py-2 text-muted hover:text-ink hover:bg-card2/70 transition-colors"
                  >
                    Browse
                  </Link>
                  <Link
                    href="/practice"
                    role="menuitem"
                    onClick={() => setMoreOpen(false)}
                    className="block px-3 py-2 text-muted hover:text-ink hover:bg-card2/70 transition-colors"
                  >
                    Practice
                  </Link>
                  <Link
                    href="/memorize"
                    role="menuitem"
                    onClick={() => setMoreOpen(false)}
                    className="block px-3 py-2 text-muted hover:text-ink hover:bg-card2/70 transition-colors"
                  >
                    Memorize
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Whisper-thin reading progress line (like Quran.com) */}
      <div className="h-[2px] w-full bg-edge/60">
        <div
          className="h-full bg-gold transition-[width] duration-300 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </nav>
  );
}
