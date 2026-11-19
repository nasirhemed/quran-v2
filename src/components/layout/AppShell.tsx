import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useTheme } from "@/hooks/useTheme";
import { getVoiceSupport } from "@/recitation/support";
import UpdatePrompt from "@/components/layout/UpdatePrompt";

const voiceSupported = getVoiceSupport().supported;

const TABS = [
  {
    href: "/",
    label: "Read",
    match: (path: string) => path === "/" || path.startsWith("/read"),
    icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
  },
  {
    href: "/browse",
    label: "Browse",
    match: (path: string) => path.startsWith("/browse"),
    icon: "M21 21l-5.2-5.2m1.7-4.3a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z",
  },
  {
    href: "/practice",
    label: "Practice",
    match: (path: string) => path.startsWith("/practice"),
    icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    href: "/memorize",
    label: "Memorize",
    match: (path: string) => path.startsWith("/memorize"),
    icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
  },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-screen flex flex-col bg-ground text-ink">
      <header data-sticky-top className="sticky top-0 z-40 h-14 bg-card/90 backdrop-blur-md border-b border-edge">
        <div className="max-w-7xl mx-auto h-full px-2.5 sm:px-5 flex items-center gap-1.5 sm:gap-4">
          <Link href="/" className="flex items-center gap-2 shrink-0 group rounded-lg px-0.5 sm:px-1 py-0.5">
            <span className="font-arabic text-[22px] sm:text-2xl text-primary leading-none group-hover:opacity-85 transition-opacity">
              إتقان
            </span>
            <span className="hidden sm:inline text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
              Itqān
            </span>
          </Link>

          {/* on the smallest phones the tabs scroll rather than push the buttons off screen */}
          <nav
            aria-label="Primary"
            className="flex items-center gap-0.5 sm:gap-1 mx-auto min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:bg-card2/75 sm:p-1 sm:rounded-full sm:border sm:border-edge/80"
          >
            {TABS.map((tab) => {
              const active = tab.match(location);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-2 sm:px-3.5 py-1.5 rounded-full text-[12.5px] sm:text-sm transition-all ${
                    active
                      ? "bg-primary text-on-primary font-semibold shadow-sm"
                      : "text-muted hover:text-ink hover:bg-card/80 font-medium"
                  }`}
                >
                  <svg
                    className={`hidden md:block w-3.5 h-3.5 shrink-0 ${active ? "opacity-95" : "opacity-70"}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
                  </svg>
                  {tab.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-1.5 shrink-0">
            <Link
              href="/settings"
              title="Settings"
              aria-label="Settings"
              className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl border flex items-center justify-center transition-colors ${
                location.startsWith("/settings")
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-edge bg-card text-muted hover:text-ink hover:border-edge-strong hover:bg-card2/70"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.9}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </Link>

            {/* on phones the theme is switched in Settings: four tabs leave no room */}
            <button
              onClick={toggle}
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              className="hidden sm:flex w-9 h-9 rounded-xl border border-edge bg-card text-muted hover:text-ink hover:border-edge-strong hover:bg-card2/70 items-center justify-center transition-colors"
            >
              {theme === "dark" ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.9}
                    d="M12 3v1.5M12 19.5V21M4.9 4.9l1.06 1.06M18.04 18.04l1.06 1.06M3 12h1.5M19.5 12H21M4.9 19.1l1.06-1.06M18.04 5.96l1.06-1.06M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.9}
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      {/* The mic floats at the bottom right (the header has no room for it next to four tabs). Not on the mushaf, where Follow is in the navigation bar and
          its strip (and the phrase editor's bar) take the bottom of the screen, nor on the voice pages themselves. */}
      {voiceSupported && !/^\/(read|transcribe|voice|settings|lab)\b/.test(location) && (
        <Link
          href="/transcribe"
          title="Recite to find a verse (live transcription)"
          aria-label="Live transcription"
          className="fixed z-30 right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] h-12 sm:h-11 w-12 sm:w-auto sm:px-4 rounded-full bg-primary text-on-primary shadow-lg ring-1 ring-black/10 flex items-center justify-center gap-2 hover:opacity-95 active:scale-95 transition-all"
        >
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3zm6-3a6 6 0 01-12 0m6 6v3m-3 0h6"
            />
          </svg>
          <span className="hidden sm:inline text-sm font-semibold">Recite</span>
        </Link>
      )}
      <UpdatePrompt />
    </div>
  );
}
