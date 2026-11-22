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
  },
  {
    href: "/browse",
    label: "Browse",
    match: (path: string) => path.startsWith("/browse"),
  },
  {
    href: "/practice",
    label: "Practice",
    match: (path: string) => path.startsWith("/practice"),
  },
  {
    href: "/memorize",
    label: "Memorize",
    match: (path: string) => path.startsWith("/memorize"),
  },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();
  const isReader = location.startsWith("/read");

  return (
    <div className={`min-h-[100dvh] flex flex-col text-ink ${isReader ? "bg-card" : "bg-ground"}`}>
      <header data-sticky-top className="sticky top-0 z-40 h-12 bg-card/95 backdrop-blur-md border-b border-edge/70">
        <div className="max-w-6xl mx-auto h-full px-3 sm:px-5 flex items-center gap-2 sm:gap-4">
          <Link href="/" className="flex items-center gap-1.5 shrink-0 group rounded-lg px-0.5 py-0.5">
            <span className="font-arabic text-[21px] text-gold leading-none group-hover:opacity-80 transition-opacity">
              إتقان
            </span>
            <span className="hidden sm:inline text-xs font-semibold tracking-wide text-ink-soft">
              Itqān
            </span>
          </Link>

          {/* on the smallest phones the tabs scroll rather than push the buttons off screen */}
          <nav
            aria-label="Primary"
            className="flex items-center gap-0.5 sm:gap-1 mx-auto min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {TABS.map((tab) => {
              const active = tab.match(location);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`shrink-0 px-2 sm:px-3 py-1.5 rounded-lg text-[12.5px] sm:text-[13px] transition-colors ${
                    active
                      ? "bg-card2 text-ink font-semibold"
                      : "text-muted hover:text-ink hover:bg-card2/50 font-medium"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-0.5 shrink-0">
            {/* on phones the theme is switched in Reader menu or Settings: four tabs leave minimal room */}
            <button
              onClick={toggle}
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              className="hidden sm:flex w-8 h-8 rounded-lg text-muted hover:text-ink hover:bg-card2/70 items-center justify-center transition-colors"
            >
              {theme === "dark" ? (
                <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M12 3v1.5M12 19.5V21M4.9 4.9l1.06 1.06M18.04 18.04l1.06 1.06M3 12h1.5M19.5 12H21M4.9 19.1l1.06-1.06M18.04 5.96l1.06-1.06M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
              ) : (
                <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.8}
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                  />
                </svg>
              )}
            </button>

            <Link
              href="/settings"
              title="Settings"
              aria-label="Settings"
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                location.startsWith("/settings")
                  ? "bg-primary-soft text-primary"
                  : "text-muted hover:text-ink hover:bg-card2/70"
              }`}
            >
              <svg className="w-[17px] h-[17px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </Link>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col">{children}</div>

      {/* The mic floats at the bottom right (the header has no room for it next to four tabs). Not on the mushaf, where Follow is in the navigation bar and
          its strip (and the phrase editor's bar) take the bottom of the screen, nor on the voice pages themselves. */}
      {voiceSupported && !/^\/(read|transcribe|voice|settings|lab)\b/.test(location) && (
        <Link
          href="/transcribe"
          title="Recite to find a verse (live transcription)"
          aria-label="Live transcription"
          className="fixed z-30 right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] h-11 w-11 sm:w-auto sm:px-3.5 rounded-full bg-primary text-on-primary shadow-md flex items-center justify-center gap-1.5 hover:opacity-95 active:scale-95 transition-all"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3zm6-3a6 6 0 01-12 0m6 6v3m-3 0h6"
            />
          </svg>
          <span className="hidden sm:inline text-xs font-semibold">Recite</span>
        </Link>
      )}
      <UpdatePrompt />
    </div>
  );
}
