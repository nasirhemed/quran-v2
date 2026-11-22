import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HostNotSetUpError, mushafFonts, type OfflineStatus } from "@/lib/mushaf/fontStore";
import type { MushafManifest } from "@/lib/mushaf/pack";
import { useMushafLayout } from "@/hooks/useMushafLayout";

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/** iPhone/iPad Safari (and every iOS browser) may clear a site's storage after 7 days unused, unless installed. */
function needsHomeScreen(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  return ios && !installed;
}

/**
 * The chosen print's fonts on this device: pages once opened are kept automatically; this saves all 604 at once
 * so every page opens offline. Each print has its own pack, saved and removed on its own.
 */
export default function OfflineMushaf({
  onDismiss,
  className = "max-w-md mx-auto mt-4",
}: {
  onDismiss?: () => void;
  className?: string;
} = {}) {
  const layout = useMushafLayout();
  const fonts = mushafFonts(layout.pack);
  const { data: manifest } = useQuery({
    queryKey: ["mushaf-manifest", layout.id],
    queryFn: async (): Promise<MushafManifest> => (await fetch(layout.manifestUrl)).json(),
  });
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (manifest) setStatus(await fonts.status(manifest));
  }, [manifest, fonts]);

  useEffect(() => {
    void refresh();
    return () => abort.current?.abort();
  }, [refresh]);

  const download = async () => {
    if (!manifest) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setError(null);
    // Ask the browser not to evict the mushaf under storage pressure.
    if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
    try {
      await fonts.downloadAll(manifest, setStatus, ctl.signal);
    } catch (e) {
      if ((e as Error).name === "AbortError") setError("Paused. Save again to continue.");
      else if (e instanceof HostNotSetUpError) setError("Saving the mushaf isn't available on this site yet.");
      else setError(`${(e as Error).message} Save again to continue where it stopped.`);
    } finally {
      abort.current = null;
      setBusy(false);
      void refresh();
    }
  };

  const remove = async () => {
    await fonts.removeAll();
    void refresh();
  };

  if (!manifest || !status) return null;
  const done = status.files === status.totalFiles;
  const pct = Math.floor((100 * status.bytes) / status.totalBytes);

  return (
    <div
      className={`relative rounded-2xl border border-edge bg-card shadow-card px-4 py-3.5 text-left font-sans text-sm ${className}`}
    >
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss (you can still manage this in Settings)"
          className="absolute -top-2.5 -right-2.5 w-6 h-6 rounded-full border border-edge bg-card text-muted hover:text-ink hover:border-edge-strong shadow-sm flex items-center justify-center text-sm leading-none transition-colors"
        >
          ×
        </button>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0 mt-0.5">
            {done ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4"
                />
              </svg>
            )}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-ink">{done ? "Whole mushaf saved offline" : "Read offline"}</div>
            <div className="text-xs text-muted mt-0.5 leading-relaxed">
              {done
                ? `${mb(status.totalBytes)} saved on this device`
                : busy
                  ? `Saving… ${pct}% (${mb(status.bytes)} of ${mb(status.totalBytes)})`
                  : `Pages you open stay on this device. Save all 604 pages (${mb(status.totalBytes)}) to read anywhere.`}
            </div>
          </div>
        </div>
        {done ? (
          <button onClick={remove} className="shrink-0 text-xs font-medium text-muted hover:text-ink underline">
            Remove
          </button>
        ) : busy ? (
          <button
            onClick={() => abort.current?.abort()}
            className="shrink-0 px-3.5 py-1.5 rounded-xl border border-edge-strong text-ink font-medium hover:bg-card2 transition-colors"
          >
            Pause
          </button>
        ) : (
          <button
            onClick={download}
            className="shrink-0 px-3.5 py-1.5 rounded-xl bg-primary text-on-primary font-semibold hover:opacity-90 transition-opacity"
          >
            {status.files > 0 && !done ? "Save all" : "Save"}
          </button>
        )}
      </div>
      {busy && (
        <div className="mt-3 h-1.5 rounded-full bg-card2 overflow-hidden">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}
      {error && <div className="mt-2 text-xs text-red-500">{error}</div>}
      {!done && needsHomeScreen() && (
        <div className="mt-2 text-xs text-muted">
          On iPhone and iPad, add Itqān to your Home Screen (Share → Add to Home Screen) so the saved pages aren't
          cleared after a week without use.
        </div>
      )}
    </div>
  );
}
