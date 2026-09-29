import { useCallback, useRef, useState } from "react";

const STORAGE_KEY = "hideWords";
/** set on a [data-w] span once its word is shown again (see .words-hidden in index.css) */
export const REVEALED_CLASS = "word-revealed";

function saved(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export interface HiddenWords {
  hidden: boolean;
  toggle: () => void;
  /** the words shown again, by key ("s:a:w"); the same Set for the hook's lifetime */
  revealed: ReadonlySet<string>;
  revealedCount: number;
  reveal: (keys: string[]) => void;
  /** hide every word again */
  reset: () => void;
}

/**
 * Hide the mushaf text for recitation from memory: words stay masked until revealed, word by word, as Follow
 * mode hears them (or one at a time by tapping a word for a hint). The class goes straight on the DOM, like
 * Follow's current-word ring, and QuranPage also reads `revealed` when it renders, so a re-render (a page's font
 * arriving, a new page) keeps it.
 */
export function useHiddenWords(): HiddenWords {
  const [hidden, setHidden] = useState(saved);
  const revealed = useRef(new Set<string>()).current;
  const [revealedCount, setRevealedCount] = useState(0);

  const reveal = useCallback(
    (keys: string[]) => {
      let added = false;
      for (const k of keys) {
        if (revealed.has(k)) continue;
        revealed.add(k);
        added = true;
        document.querySelectorAll(`[data-w="${k}"]`).forEach((el) => el.classList.add(REVEALED_CLASS));
      }
      if (added) setRevealedCount(revealed.size);
    },
    [revealed]
  );

  const reset = useCallback(() => {
    revealed.clear();
    document.querySelectorAll(`.${REVEALED_CLASS}`).forEach((el) => el.classList.remove(REVEALED_CLASS));
    setRevealedCount(0);
  }, [revealed]);

  const toggle = useCallback(() => {
    setHidden((h) => {
      try {
        localStorage.setItem(STORAGE_KEY, h ? "0" : "1");
      } catch {
        // private mode: the choice just isn't remembered
      }
      return !h;
    });
    reset();
  }, [reset]);

  return { hidden, toggle, revealed, revealedCount, reveal, reset };
}
