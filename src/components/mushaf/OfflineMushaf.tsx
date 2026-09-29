import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HostNotSetUpError, mushafFonts, type OfflineStatus } from "@/lib/mushaf/fontStore";
import { MANIFEST_URL, type MushafManifest } from "@/lib/mushaf/pack";

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/** iPhone/iPad Safari (and every iOS browser) may clear a site's storage after 7 days unused, unless installed. */
function needsHomeScreen(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  return ios && !installed;
}

/**
 * The mushaf's fonts on this device: pages once opened are kept automatically; this saves all 604 at once so
 * every page opens offline.
 */
export default function OfflineMushaf() {
  const { data: manifest } = useQuery({
    queryKey: ["mushaf-manifest"],
    queryFn: async (): Promise<MushafManifest> => (await fetch(MANIFEST_URL)).json(),
  });
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (manifest) setStatus(await mushafFonts().status(manifest));
  }, [manifest]);

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
      await mushafFonts().downloadAll(manifest, setStatus, ctl.signal);
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
    await mushafFonts().removeAll();
    void refresh();
  };

  if (!manifest || !status) return null;
  const done = status.files === status.totalFiles;
  const pct = Math.floor((100 * status.bytes) / status.totalBytes);

  return (
    <div className="max-w-md mx-auto mt-4 rounded-lg border border-edge bg-card px-4 py-3 text-left font-sans text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-ink">{done ? "Whole mushaf saved for offline reading" : "Read offline"}</div>
          <div className="text-xs text-muted">
            {done
              ? `${mb(status.totalBytes)} on this device`
              : busy
                ? `Saving… ${pct}% (${mb(status.bytes)} of ${mb(status.totalBytes)})`
                : `Pages you open are kept on this device. Save all 604 pages (${mb(status.totalBytes)}) to read anywhere.`}
          </div>
        </div>
        {done ? (
          <button onClick={remove} className="shrink-0 text-xs text-muted hover:text-ink underline">
            Remove
          </button>
        ) : busy ? (
          <button onClick={() => abort.current?.abort()} className="shrink-0 px-3 py-1.5 rounded border border-edge text-ink hover:bg-card2">
            Pause
          </button>
        ) : (
          <button onClick={download} className="shrink-0 px-3 py-1.5 rounded bg-primary text-on-primary font-medium hover:opacity-90">
            {status.files > 0 && !done ? "Save all" : "Save"}
          </button>
        )}
      </div>
      {busy && (
        <div className="mt-2 h-1.5 rounded-full bg-card2 overflow-hidden">
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
