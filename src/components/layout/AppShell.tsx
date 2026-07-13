import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useTheme } from "@/hooks/useTheme";

const TABS = [
  { href: "/", label: "Read", match: (path: string) => path === "/" || path.startsWith("/read") },
  { href: "/browse", label: "Browse", match: (path: string) => path.startsWith("/browse") },
  { href: "/practice", label: "Practice", match: (path: string) => path.startsWith("/practice") },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 h-14 bg-surface-light/95 backdrop-blur border-b border-edge">
        <div className="max-w-7xl mx-auto h-full px-4 flex items-center gap-4">
          <Link href="/" className="flex items-baseline gap-2 shrink-0">
            <span className="font-arabic text-2xl text-primary leading-none">إتقان</span>
            <span className="hidden sm:inline text-xs font-semibold tracking-[0.08em] text-muted">
              ITQĀN
            </span>
          </Link>

          <nav className="flex gap-1 mx-auto">
            {TABS.map((tab) => {
              const active = tab.match(location);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
                    active
                      ? "bg-primary text-on-primary font-semibold"
                      : "text-muted hover:text-ink hover:bg-card2 font-medium"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>

          <button
            onClick={toggle}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="shrink-0 w-8 h-8 rounded-lg border border-edge bg-card2 text-muted hover:text-ink flex items-center justify-center transition-colors"
          >
            {theme === "dark" ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 3v1.5M12 19.5V21M4.9 4.9l1.06 1.06M18.04 18.04l1.06 1.06M3 12h1.5M19.5 12H21M4.9 19.1l1.06-1.06M18.04 5.96l1.06-1.06M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
            )}
          </button>
        </div>
      </header>

      <div className="flex-1">{children}</div>
    </div>
  );
}
