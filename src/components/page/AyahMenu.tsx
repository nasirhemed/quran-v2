import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import type { PageAyah } from "@/types";
import { ayahCopyText, ayahLink, type AyahRef } from "@/lib/ayahActions";

interface AyahMenuProps {
  ayah: PageAyah;
  tname: string;
  bookmarked: boolean;
  /** opens the reader's side panel on the verse's similar verses, where it has any */
  onSimilar?: () => void;
  onToggleBookmark: () => void;
  onClose: () => void;
}

const canShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function Row({ icon, label, onClick, href }: { icon: ReactNode; label: string; onClick?: () => void; href?: string }) {
  const cls =
    "w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-ink hover:bg-card2/70 active:bg-card2 transition-colors";
  const body = (
    <>
      <span className="w-5 h-5 text-muted shrink-0">{icon}</span>
      {label}
    </>
  );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

const svg = (d: string) => (
  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-5 h-5">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={d} />
  </svg>
);
const ICONS = {
  copy: svg("M8 8V5a2 2 0 012-2h9a2 2 0 012 2v9a2 2 0 01-2 2h-3M5 8h9a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2v-9a2 2 0 012-2z"),
  share: svg("M12 3v12m0-12l-4 4m4-4l4 4M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"),
  link: svg("M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1"),
  bookmark: svg("M6 4h12v17l-6-4-6 4V4z"),
  similar: svg("M4 6h10M4 12h16M4 18h10"),
  browse: svg("M12 6.25C10.5 5 8.25 4.5 4 4.5v14c4.25 0 6.5.5 8 1.75 1.5-1.25 3.75-1.75 8-1.75v-14c-4.25 0-6.5.5-8 1.75zm0 0v14"),
};

/**
 * A verse's actions, opened by a still long press on it in the reader (or a right click): copy it, share it,
 * bookmark it, its similar verses, and its Browse page. A sheet at the foot of the screen on phones, a small card
 * above it on wider screens; the backdrop, Escape or an action closes it.
 */
export default function AyahMenu({ ayah, tname, bookmarked, onSimilar, onToggleBookmark, onClose }: AyahMenuProps) {
  const ref: AyahRef = { surah: ayah.surah, ayah: ayah.ayah };
  const [note, setNote] = useState<string | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const sheet = useRef<HTMLDivElement>(null);
  const backdropDown = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    sheet.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(closeTimer.current);
    };
  }, [onClose]);

  const done = (message: string) => {
    setNote(message);
    closeTimer.current = window.setTimeout(onClose, 900);
  };

  const text = ayahCopyText(ayah, tname);
  const link = ayahLink(location.origin, ref);

  const onCopy = async () => done((await copy(text)) ? "Verse copied" : "Couldn't copy");
  const onCopyLink = async () => done((await copy(link)) ? "Link copied" : "Couldn't copy");
  const onShare = async () => {
    try {
      await navigator.share({ title: `${tname} ${ref.surah}:${ref.ayah}`, text, url: link });
      onClose();
    } catch {
      // cancelled: keep the menu open
    }
  };
  const onBookmark = () => {
    onToggleBookmark();
    done(bookmarked ? "Bookmark removed" : "Bookmarked");
  };

  const opening = ayah.words
    .slice(0, 6)
    .map((w) => w.hafs)
    .join(" ");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:pb-6" role="presentation">
      {/* Closes on a tap that starts on it: the finger lifting from the long press that opened the menu lands here. */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
        onPointerDown={() => (backdropDown.current = true)}
        onClick={() => backdropDown.current && onClose()}
        aria-hidden="true"
      />
      <div
        ref={sheet}
        role="dialog"
        aria-label={`Verse ${ref.surah}:${ref.ayah}`}
        tabIndex={-1}
        className="relative w-full sm:w-[22rem] bg-card border border-edge/80 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden outline-none pb-[env(safe-area-inset-bottom)] select-none"
      >
        <div className="px-4 pt-3 pb-2.5 border-b border-edge/80">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-ink font-sans">
              {tname} <span className="text-muted font-normal tabular-nums">{ref.surah}:{ref.ayah}</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-7 h-7 -mr-1.5 flex items-center justify-center rounded-lg hover:bg-card2 text-muted hover:text-ink transition-colors text-lg leading-none"
            >
              &times;
            </button>
          </div>
          <div lang="ar" dir="rtl" className="font-quran text-lg text-ink/80 truncate mt-0.5">
            {opening}
            {ayah.words.length > 6 ? " …" : ""}
          </div>
        </div>
        {note ? (
          <div className="px-4 py-6 text-center text-sm font-medium text-primary" role="status">
            {note}
          </div>
        ) : (
          <div className="py-1">
            <Row icon={ICONS.copy} label="Copy verse" onClick={onCopy} />
            {canShare() ? (
              <Row icon={ICONS.share} label="Share" onClick={onShare} />
            ) : (
              <Row icon={ICONS.link} label="Copy link" onClick={onCopyLink} />
            )}
            <Row icon={ICONS.bookmark} label={bookmarked ? "Remove bookmark" : "Bookmark"} onClick={onBookmark} />
            {onSimilar && <Row icon={ICONS.similar} label="Similar verses" onClick={onSimilar} />}
            <Row icon={ICONS.browse} label="Phrases & similar verses in Browse" href={`/browse/surah/${ref.surah}/${ref.ayah}`} />
          </div>
        )}
      </div>
    </div>
  );
}
