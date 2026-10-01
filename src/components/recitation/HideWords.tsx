/**
 * Recite from memory in the reader: the Hide button (in the navigation bar, beside Follow) masks the mushaf's
 * words, and the bar above the page explains how they come back (Follow mode reveals each word as it is heard, a
 * tap reveals one word as a hint) with Hide again / Show all. The masking itself is .words-hidden in index.css.
 */

const EyeIcon = ({ off, className }: { off: boolean; className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
    {off ? (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.8 9.8 0 0112 5c4.5 0 8.3 2.9 9.5 7a10 10 0 01-2.7 4.2M6.6 6.6A10 10 0 002.5 12c1.2 4.1 5 7 9.5 7a9.8 9.8 0 005.4-1.6"
      />
    ) : (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.5 12C3.7 7.9 7.5 5 12 5s8.3 2.9 9.5 7c-1.2 4.1-5 7-9.5 7s-8.3-2.9-9.5-7z" />
        <circle cx="12" cy="12" r="3" strokeWidth={2} />
      </>
    )}
  </svg>
);

export function HideWordsButton({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={hidden}
      aria-label={hidden ? "Words hidden" : "Hide words"}
      title={hidden ? "Show the words" : "Hide the words to recite from memory"}
      className={`shrink-0 flex items-center gap-1.5 px-2.5 lg:px-3 h-9 rounded-full text-sm font-semibold border transition-colors ${
        hidden ? "bg-primary-soft border-primary text-primary" : "bg-card border-edge text-ink hover:border-edge-strong"
      }`}
    >
      <EyeIcon off={hidden} className="w-4 h-4" />
      <span className="hidden lg:inline">{hidden ? "Hidden" : "Hide"}</span>
    </button>
  );
}

export function HideWordsBar({
  canFollow,
  following,
  revealedCount,
  onReset,
  onShowAll,
}: {
  canFollow: boolean;
  following: boolean;
  revealedCount: number;
  onReset: () => void;
  onShowAll: () => void;
}) {
  const hint = following
    ? "Words appear as you recite them. Tap a word for a hint."
    : canFollow
      ? "Words are hidden. Tap Follow and recite: each word appears as you say it. Tap a word for a hint."
      : "Words are hidden. Tap a word to reveal it.";
  return (
    <div className="max-w-[40rem] mx-auto px-3 sm:px-6 pt-4">
      <div className="flex items-center gap-3 rounded-lg border border-edge bg-card px-3 py-2 text-xs font-sans">
        <p className="flex-1 min-w-0 text-muted" data-testid="hide-words-hint">
          {hint}
        </p>
        <button onClick={onReset} disabled={revealedCount === 0} className="shrink-0 font-semibold text-primary hover:underline disabled:opacity-40 disabled:no-underline">
          Hide again
        </button>
        <button onClick={onShowAll} className="shrink-0 font-semibold text-muted hover:text-ink">
          Show all
        </button>
      </div>
    </div>
  );
}
