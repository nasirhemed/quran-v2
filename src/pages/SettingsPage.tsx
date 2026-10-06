import { lazy, Suspense, type ReactNode } from "react";
import { useTheme } from "@/hooks/useTheme";
import { Link } from "wouter";
import OfflineMushaf from "@/components/mushaf/OfflineMushaf";
import { getVoiceSupport } from "@/recitation/support";

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

      <Section title="Mushaf pages">
        <p className="text-sm text-muted">
          Pages you open are kept on this device automatically. Save all 604 to read offline, or remove them to free space.
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
