import { useState, useCallback, useMemo } from "react";
import type { LocalPhrase, WordSelection, AyahHighlights, QuranPage } from "@/types";
import {
  loadLocalPhrases,
  addLocalPhrase,
  deleteLocalPhrase as deleteLocalPhraseFromStorage,
  addOccurrenceToPhrase,
  removeOccurrenceFromPhrase,
  exportLocalPhrasesJson,
  importLocalPhrasesJson,
  localPhrasesToHighlights,
  findAyahText,
} from "@/lib/localPhrases";

export function useLocalPhrases(pages?: QuranPage[]) {
  const [editMode, setEditMode] = useState(false);
  const [phrases, setPhrases] = useState<LocalPhrase[]>(() => loadLocalPhrases());
  const [selection, setSelection] = useState<WordSelection | null>(null);

  const toggleEditMode = useCallback(() => {
    setEditMode((prev) => {
      if (prev) setSelection(null); // clear selection when exiting
      return !prev;
    });
  }, []);

  const handleWordClick = useCallback(
    (ayahKey: string, wordIndex1Based: number) => {
      setSelection((prev) => {
        if (!prev || prev.ayahKey !== ayahKey || prev.endWord !== null) {
          // Start new selection
          return { ayahKey, startWord: wordIndex1Based, endWord: null };
        }
        // Complete selection
        const start = Math.min(prev.startWord, wordIndex1Based);
        const end = Math.max(prev.startWord, wordIndex1Based);
        return { ayahKey, startWord: start, endWord: end };
      });
    },
    []
  );

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  const createPhraseFromSelection = useCallback((): LocalPhrase | null => {
    if (!selection || selection.endWord === null || !pages) return null;

    const [surahStr, ayahStr] = selection.ayahKey.split(":");
    const text = findAyahText(pages, Number(surahStr), Number(ayahStr));
    if (!text) return null;

    const words = text.split(/\s+/);
    const phraseWords = words.slice(selection.startWord - 1, selection.endWord);
    const phraseText = phraseWords.join(" ");

    const phrase: LocalPhrase = {
      id: crypto.randomUUID(),
      phraseText,
      sourceAyah: selection.ayahKey,
      sourceWordRange: [selection.startWord, selection.endWord],
      occurrences: [],
      createdAt: Date.now(),
    };

    setPhrases((prev) => addLocalPhrase(prev, phrase));
    setSelection(null);
    return phrase;
  }, [selection, pages]);

  const deletePhrase = useCallback((phraseId: string) => {
    setPhrases((prev) => deleteLocalPhraseFromStorage(prev, phraseId));
  }, []);

  const addOccurrence = useCallback(
    (phraseId: string, ayahKey: string, wordRange: [number, number]) => {
      setPhrases((prev) => addOccurrenceToPhrase(prev, phraseId, { ayahKey, wordRange }));
    },
    []
  );

  const removeOccurrence = useCallback(
    (phraseId: string, occurrenceIndex: number) => {
      setPhrases((prev) => removeOccurrenceFromPhrase(prev, phraseId, occurrenceIndex));
    },
    []
  );

  const localHighlights: AyahHighlights = useMemo(
    () => localPhrasesToHighlights(phrases),
    [phrases]
  );

  const exportPhrases = useCallback((): string => {
    return exportLocalPhrasesJson(phrases);
  }, [phrases]);

  const importPhrases = useCallback((json: string) => {
    const imported = importLocalPhrasesJson(json);
    setPhrases(imported);
  }, []);

  return {
    editMode,
    toggleEditMode,
    phrases,
    selection,
    handleWordClick,
    clearSelection,
    createPhraseFromSelection,
    deletePhrase,
    addOccurrence,
    removeOccurrence,
    localHighlights,
    exportPhrases,
    importPhrases,
  };
}
