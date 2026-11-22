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
      className={`rounded-xl border border-edge/80 bg-card px-3.5 py-3 text-left font-sans text-xs ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-ink">{done ? "Whole mushaf saved offline" : "Read offline"}</div>
          <div className="text-muted mt-0.5 leading-relaxed">
            {done
              ? `${mb(status.totalBytes)} saved on this device`
              : busy
                ? `Saving… ${pct}% (${mb(status.bytes)} of ${mb(status.totalBytes)})`
                : `Save all 604 pages (${mb(status.totalBytes)}) to read without internet.`}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {done ? (
            <button type="button" onClick={remove} className="text-xs font-medium text-muted hover:text-ink underline">
              Remove
            </button>
          ) : busy ? (
            <button
              type="button"
              onClick={() => abort.current?.abort()}
              className="px-2.5 py-1 rounded-lg border border-edge-strong text-ink font-medium hover:bg-card2 transition-colors"
            >
              Pause
            </button>
          ) : (
            <button
              type="button"
              onClick={download}
              className="px-2.5 py-1 rounded-lg bg-card2 text-ink font-semibold hover:bg-primary hover:text-on-primary transition-colors"
            >
              {status.files > 0 && !done ? "Save all" : "Save"}
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss"
              title="Dismiss (still available in Settings)"
              className="w-6 h-6 rounded-md text-faint hover:text-ink hover:bg-card2 flex items-center justify-center text-sm leading-none transition-colors"
            >
              ×
            </button>
          )}
        </div>
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
