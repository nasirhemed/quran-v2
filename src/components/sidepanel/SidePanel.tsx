import type { MutashabihatPhrase, SimilarAyahEntry, SidePanelContent, LocalPhrase } from "@/types";
import PhraseDetail from "./PhraseDetail";
import SimilarAyahDetail from "./SimilarAyahDetail";
import LocalPhraseDetail from "./LocalPhraseDetail";

interface SidePanelProps {
  isOpen: boolean;
  content: SidePanelContent;
  currentPhrase: MutashabihatPhrase | null;
  currentSimilar: SimilarAyahEntry | null;
  currentLocalPhrase?: LocalPhrase | null;
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
  onClose,
  onNavigate,
  onDeleteLocalPhrase,
  onRemoveOccurrence,
  onAddOccurrence,
}: SidePanelProps) {
  const title =
    content?.type === "phrase"
      ? "Phrase Details"
      : content?.type === "local-phrase"
        ? "Custom Phrase"
        : "Similar Verses";

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full z-50 bg-surface-light border-l border-slate-700 shadow-2xl transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        } w-full sm:w-[400px]`}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-slate-200 font-sans">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-surface-lighter text-slate-400 hover:text-slate-200 transition-colors text-lg"
          >
            &times;
          </button>
        </div>

        <div className="p-4 overflow-y-auto h-[calc(100%-60px)]">
          {content?.type === "phrase" && currentPhrase && (
            <PhraseDetail
              phrase={currentPhrase}
              onNavigate={onNavigate}
            />
          )}
          {content?.type === "similar" && currentSimilar && (
            <SimilarAyahDetail
              entry={currentSimilar}
              onNavigate={onNavigate}
            />
          )}
          {content?.type === "local-phrase" && currentLocalPhrase && (
            <LocalPhraseDetail
              phrase={currentLocalPhrase}
              onNavigate={onNavigate}
              onDelete={onDeleteLocalPhrase}
              onRemoveOccurrence={onRemoveOccurrence}
              onAddOccurrence={onAddOccurrence}
            />
          )}
        </div>
      </div>
    </>
  );
}
