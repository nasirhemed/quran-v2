import { useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

/**
 * Offline support: the service worker caches the app so it opens without a connection. When a new version is
 * deployed, this asks before switching; it never reloads by itself (someone may be mid-recitation).
 *
 * Update tells the waiting worker to take over and reloads as soon as it has (not only through workbox-window's
 * own path: an Update that "did nothing" was reported on Android). If it hasn't taken over after a few seconds,
 * the prompt says how to finish: with no tab left on the old version, the new one takes over by itself.
 */
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
  } = useRegisterSW();
  const [step, setStep] = useState<"ask" | "updating" | "stuck">("ask");

  if (!needRefresh) return null;

  const update = async () => {
    setStep("updating");
    const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
    const waiting = reg?.waiting;
    // On a first visit the page has no controlling worker, and when another tab already switched there is no
    // waiting one: either way the new version is active, so a reload shows it.
    if (!navigator.serviceWorker.controller || !waiting) return window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    waiting.postMessage({ type: "SKIP_WAITING" });
    setTimeout(() => setStep("stuck"), 6000);
  };

  return (
    <div
      role="status"
      className="fixed bottom-4 inset-x-4 sm:left-auto sm:right-4 sm:w-80 z-50 bg-card border border-edge-strong rounded-lg shadow-lg p-3 flex items-center gap-3"
    >
      <p className="flex-1 text-sm text-ink">
        {step === "stuck" ? "Almost done: close Itqān's other tabs (or the app) and open it again." : "A new version of Itqān is ready."}
      </p>
      {step !== "updating" && (
        <button onClick={() => setNeedRefresh(false)} className="text-xs font-medium text-muted hover:text-ink">
          Later
        </button>
      )}
      <button
        onClick={() => void update()}
        disabled={step === "updating"}
        className="px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-on-primary disabled:opacity-60"
      >
        {step === "updating" ? "Updating…" : step === "stuck" ? "Try again" : "Update"}
      </button>
    </div>
  );
}
