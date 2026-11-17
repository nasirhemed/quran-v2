import { lazy, Suspense, type ReactNode } from "react";
import { useTheme } from "@/hooks/useTheme";
import { Link } from "wouter";
import OfflineMushaf from "@/components/mushaf/OfflineMushaf";
import { getVoiceSupport } from "@/recitation/support";
import { useQuery } from "@tanstack/react-query";
import { setMushafLayout, useMushafLayout, useMushafPages } from "@/hooks/useMushafLayout";
import { MUSHAF_LAYOUTS, type MushafLayoutDef } from "@/lib/mushaf/layouts";

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
      className={`flex items-start gap-3 p-4 cursor-pointer ${disabled ? "opacity-60 cursor-not-allowed" : "hover:bg-card2"}`}
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
        <span className="block text-sm font-medium text-ink">{layout.name}</span>
        <span className="block text-xs text-muted">{layout.description}</span>
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
    <div className="space-y-2">
      <div className="bg-card border border-edge rounded-lg divide-y divide-edge" role="radiogroup" aria-label="Mushaf layout">
        {Object.values(MUSHAF_LAYOUTS).map((l) => (
          <LayoutOption key={l.id} layout={l} selected={l.id === current.id} />
        ))}
      </div>
      <p className="text-xs text-muted">
        Both are the King Fahd Complex's 604-page, 15-line Madinah mushaf; lines, and on some pages the page breaks,
        differ. The reader, its surah and juz pages, and Practice's passages follow the one you choose.
      </p>
      {fallback && <p className="text-xs text-red-500">This layout couldn't be loaded, so the reader shows the 1421H pages for now.</p>}
    </div>
  );
}

export default function SettingsPage() {
  const { theme, toggle } = useTheme();
  const voiceSupported = getVoiceSupport().supported;

  return (
    <div className="max-w-xl mx-auto px-4 py-8 space-y-8">
      <h1 className="text-xl font-semibold text-ink">Settings</h1>

      <Section title="Appearance">
        <div className="bg-card border border-edge rounded-lg p-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-ink">Theme</div>
            <div className="text-xs text-muted">Currently {theme === "dark" ? "dark" : "light"}.</div>
          </div>
          <button onClick={toggle} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-on-primary">
            Switch to {theme === "dark" ? "light" : "dark"}
          </button>
        </div>
      </Section>

      <Section title="Mushaf layout">
        <MushafLayoutPicker />
      </Section>

      <Section title="Mushaf pages">
        <p className="text-sm text-muted">
          Pages you open are kept on this device automatically. Save all 604 of the layout you chose to read offline,
          or remove them to free space.
        </p>
        <div className="-mt-4">
          <OfflineMushaf />
        </div>
      </Section>

      {voiceSupported && (
        <Section title="Voice models">
          <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
            <VoiceModels embedded />
          </Suspense>
          <Link href="/transcribe" className="block text-sm text-primary hover:underline">
            Live transcription →
          </Link>
        </Section>
      )}
    </div>
  );
}
