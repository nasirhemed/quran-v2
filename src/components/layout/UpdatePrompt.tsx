import { useRegisterSW } from "virtual:pwa-register/react";

/**
 * Offline support: the service worker caches the app so it opens without a connection. When a new version is
 * deployed, this asks before switching; it never reloads by itself (someone may be mid-recitation).
 */
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 inset-x-4 sm:left-auto sm:right-4 sm:w-80 z-50 bg-card border border-edge-strong rounded-lg shadow-lg p-3 flex items-center gap-3"
    >
      <p className="flex-1 text-sm text-ink">A new version of Itqān is ready.</p>
      <button onClick={() => setNeedRefresh(false)} className="text-xs font-medium text-muted hover:text-ink">
        Later
      </button>
      <button
        // On a first visit the page has no controlling worker and the new version is already active: just reload.
        onClick={() => (navigator.serviceWorker.controller ? updateServiceWorker(true) : window.location.reload())}
        className="px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-on-primary"
      >
        Update
      </button>
    </div>
  );
}
