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
      type="button"
      onClick={onToggle}
      aria-pressed={hidden}
      aria-label={hidden ? "Words hidden" : "Hide words"}
      title={hidden ? "Show the words" : "Hide the words to recite from memory"}
      className={`shrink-0 inline-flex items-center gap-1.5 px-2 sm:px-2.5 h-7 sm:h-8 rounded-lg text-xs font-medium transition-colors font-sans ${
        hidden ? "bg-primary-soft text-primary" : "text-muted hover:text-ink hover:bg-card2/70"
      }`}
    >
      <EyeIcon off={hidden} className="w-3.5 h-3.5" />
      <span className="hidden md:inline">{hidden ? "Hidden" : "Hide"}</span>
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
    ? "Words appear as you recite. Tap any blank for a hint."
    : canFollow
      ? "Words hidden — tap Follow to recite, or tap any blank for a hint."
      : "Words hidden — tap any blank to reveal it.";
  return (
    <div className="flex items-center justify-between gap-2.5 rounded-lg bg-card2/70 border border-edge/70 px-2.5 py-1 text-[11.5px] sm:text-xs font-sans">
      <p className="min-w-0 truncate text-muted" data-testid="hide-words-hint">
        {hint}
      </p>
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          type="button"
          onClick={onReset}
          disabled={revealedCount === 0}
          className="font-semibold text-primary hover:underline disabled:opacity-40 disabled:no-underline"
        >
          Hide again
        </button>
        <button type="button" onClick={onShowAll} className="font-medium text-muted hover:text-ink">
          Show all
        </button>
      </div>
    </div>
  );
}
