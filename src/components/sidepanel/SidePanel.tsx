import { useEffect } from "react";
import type { MutashabihatPhrase, SimilarAyahEntry, SidePanelContent, LocalPhrase, SurahMeta } from "@/types";
import PhraseDetail from "./PhraseDetail";
import SimilarAyahDetail from "./SimilarAyahDetail";
import LocalPhraseDetail from "./LocalPhraseDetail";

interface SidePanelProps {
  isOpen: boolean;
  content: SidePanelContent;
  currentPhrase: MutashabihatPhrase | null;
  currentSimilar: SimilarAyahEntry | null;
  currentLocalPhrase?: LocalPhrase | null;
  surahs?: SurahMeta[];
  onClose: () => void;
  onNavigate: (surah: number, ayah: number) => void;
  onDeleteLocalPhrase?: (phraseId: string) => void;
  onRemoveOccurrence?: (phraseId: string, occurrenceIndex: number) => void;
  onAddOccurrence?: (phraseId: string) => void;
}

export default function SidePanel({
  isOpen,
  content,
  currentPhrase,
  currentSimilar,
  currentLocalPhrase,
  surahs,
  onClose,
  onNavigate,
  onDeleteLocalPhrase,
  onRemoveOccurrence,
  onAddOccurrence,
}: SidePanelProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const title =
    content?.type === "phrase"
      ? "Shared Phrase"
      : content?.type === "local-phrase"
        ? "Custom Phrase"
        : "Similar Verses";

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/30 md:bg-black/15 backdrop-blur-[1px] z-40 transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Panel */}
      <aside
        role="dialog"
        aria-label={title}
        aria-hidden={!isOpen}
        className={`fixed top-0 right-0 h-full z-50 bg-card border-l border-edge shadow-2xl sm:rounded-l-2xl flex flex-col transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full pointer-events-none"
        } w-full sm:w-[420px]`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
          <h2 className="text-base font-semibold text-ink font-sans">
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-card2 text-muted hover:text-ink transition-colors text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {content?.type === "phrase" && currentPhrase && (
            <PhraseDetail
              phrase={currentPhrase}
              surahs={surahs}
              onNavigate={onNavigate}
              onClose={onClose}
            />
          )}
          {content?.type === "similar" && currentSimilar && (
            <SimilarAyahDetail
              entry={currentSimilar}
              surahs={surahs}
              onNavigate={onNavigate}
              onClose={onClose}
            />
          )}
          {content?.type === "local-phrase" && currentLocalPhrase && (
            <LocalPhraseDetail
              phrase={currentLocalPhrase}
              surahs={surahs}
              onNavigate={onNavigate}
              onDelete={onDeleteLocalPhrase}
              onRemoveOccurrence={onRemoveOccurrence}
              onAddOccurrence={onAddOccurrence}
            />
          )}
        </div>
      </aside>
    </>
  );
}
