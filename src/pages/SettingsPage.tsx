import { lazy, Suspense, type ReactNode } from "react";
import { useTheme } from "@/hooks/useTheme";
import { Link } from "wouter";
import OfflineMushaf from "@/components/mushaf/OfflineMushaf";
import { getVoiceSupport } from "@/recitation/support";
import { useQuery } from "@tanstack/react-query";
import { setMushafLayout, useMushafLayout, useMushafPages } from "@/hooks/useMushafLayout";
import { MUSHAF_LAYOUTS, type MushafLayoutDef } from "@/lib/mushaf/layouts";
import { setPageSpread, usePageSpreadSetting, type PageSpreadSetting } from "@/hooks/usePageSpread";

// The voice model manager pulls in the model store; load it only when Settings opens.
const VoiceModels = lazy(() => import("@/pages/VoicePage"));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

/** Is this print's font pack published with the app? (Its manifest ships beside the layout file.) */
function useLayoutAvailable(layout: MushafLayoutDef) {
  return useQuery({
    queryKey: ["mushaf-available", layout.id],
    queryFn: async () => {
      const res = await fetch(layout.manifestUrl);
      if (!res.ok || !res.headers.get("Content-Type")?.includes("json")) return false;
      return Array.isArray((await res.json()).files);
    },
  });
}

function LayoutOption({ layout, selected }: { layout: MushafLayoutDef; selected: boolean }) {
  const { data: available, isLoading } = useLayoutAvailable(layout);
  const disabled = !selected && available === false;
  return (
    <label
      className={`flex items-start gap-3 p-4 transition-colors first:rounded-t-2xl last:rounded-b-2xl ${
        disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-card2/60"
      } ${selected ? "bg-primary-soft/45" : ""}`}
    >
      <input
        type="radio"
        name="mushaf-layout"
        className="mt-1 accent-[var(--primary)]"
        checked={selected}
        disabled={disabled}
        onChange={() => setMushafLayout(layout.id)}
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{layout.name}</span>
        <span className="block text-xs text-muted mt-0.5">{layout.description}</span>
        {!isLoading && available === false && (
          <span className="block text-xs text-muted mt-1">Not available on this site yet.</span>
        )}
      </span>
    </label>
  );
}

function MushafLayoutPicker() {
  const current = useMushafLayout();
  const { fallback } = useMushafPages();
  return (
    <div className="space-y-2.5">
      <div
        className="bg-card border border-edge/80 rounded-xl divide-y divide-edge/80"
        role="radiogroup"
        aria-label="Mushaf layout"
      >
        {Object.values(MUSHAF_LAYOUTS).map((l) => (
          <LayoutOption key={l.id} layout={l} selected={l.id === current.id} />
        ))}
      </div>
      <p className="text-xs text-muted leading-relaxed">
        Both are the King Fahd Complex's 604-page, 15-line Madinah mushaf; lines, and on some pages the page breaks,
        differ. The reader, its surah and juz pages, and Practice's passages follow the one you choose.
      </p>
      {fallback && (
        <p className="text-xs text-[rgb(var(--danger-rgb))]">
          This layout couldn't be loaded, so the reader shows the 1421H pages for now.
        </p>
      )}
    </div>
  );
}

const SPREAD_OPTIONS: { id: PageSpreadSetting; label: string }[] = [
  { id: "auto", label: "Two on wide screens" },
  { id: "one", label: "Always one" },
];

/** One page, or two facing pages when the screen is wide enough (usePageSpread). */
function PageSpreadPicker() {
  const setting = usePageSpreadSetting();
  return (
    <div className="bg-card border border-edge/80 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-ink">Pages</div>
        <div className="text-xs text-muted mt-0.5">
          Two facing pages on a tablet held sideways, an unfolded foldable or a desktop.
        </div>
      </div>
      <div className="inline-flex rounded-xl border border-edge bg-card2 p-1 gap-0.5" role="radiogroup" aria-label="Pages">
        {SPREAD_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={setting === o.id}
            onClick={() => setPageSpread(o.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              setting === o.id ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { theme, toggle } = useTheme();
  const voiceSupported = getVoiceSupport().supported;

  return (
    <div className="max-w-xl mx-auto w-full px-4 py-6 sm:py-8 pb-24 space-y-7">
      <div className="text-center">
        <h1 className="text-2xl sm:text-3xl font-sans font-semibold tracking-tight text-ink">Settings</h1>
        <p className="text-muted text-xs sm:text-sm mt-1">Customize theme, mushaf print, and offline downloads.</p>
      </div>

      <Section title="Appearance">
        <div className="bg-card border border-edge/80 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-ink">Theme</div>
            <div className="text-xs text-muted mt-0.5">
              {theme === "dark" ? "Calm night reading palette" : "Crisp paper mushaf palette"}
            </div>
          </div>
          <div className="inline-flex rounded-xl border border-edge bg-card2 p-1 gap-0.5" role="radiogroup" aria-label="Theme">
            <button
              type="button"
              role="radio"
              aria-checked={theme === "light"}
              onClick={() => {
                if (theme !== "light") toggle();
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                theme === "light" ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364 6.364l-1.414-1.414M7.05 7.05L5.636 5.636m12.728 0l-1.414 1.414M7.05 16.95l-1.414 1.414M12 8a4 4 0 100 8 4 4 0 000-8z"
                />
              </svg>
              Light
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === "dark"}
              onClick={() => {
                if (theme !== "dark") toggle();
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                theme === "dark" ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
                />
              </svg>
              Dark
            </button>
          </div>
        </div>
      </Section>

      <Section title="Mushaf layout">
        <MushafLayoutPicker />
        <PageSpreadPicker />
      </Section>

      <Section title="Mushaf pages">
        <p className="text-sm text-muted leading-relaxed">
          Pages you open are kept on this device automatically. Save all 604 of the layout you chose to read offline,
          or remove them to free space.
        </p>
        <OfflineMushaf className="w-full" />
      </Section>

      {voiceSupported && (
        <Section title="Voice models">
          <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
            <VoiceModels embedded />
          </Suspense>
          <Link
            href="/transcribe"
            className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
          >
            Open live transcription →
          </Link>
        </Section>
      )}
    </div>
  );
}
