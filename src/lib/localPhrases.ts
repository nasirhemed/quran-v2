import type { LocalPhrase, AyahHighlights, QuranPage } from "@/types";

const STORAGE_KEY = "quran-reader-local-phrases";

export function loadLocalPhrases(): LocalPhrase[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalPhrases(phrases: LocalPhrase[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(phrases));
}

export function addLocalPhrase(
  phrases: LocalPhrase[],
  phrase: LocalPhrase
): LocalPhrase[] {
  const updated = [...phrases, phrase];
  saveLocalPhrases(updated);
  return updated;
}

export function deleteLocalPhrase(
  phrases: LocalPhrase[],
  phraseId: string
): LocalPhrase[] {
  const updated = phrases.filter((p) => p.id !== phraseId);
  saveLocalPhrases(updated);
  return updated;
}

export function addOccurrenceToPhrase(
  phrases: LocalPhrase[],
  phraseId: string,
  occurrence: { ayahKey: string; wordRange: [number, number] }
): LocalPhrase[] {
  const updated = phrases.map((p) =>
    p.id === phraseId
      ? { ...p, occurrences: [...p.occurrences, occurrence] }
      : p
  );
  saveLocalPhrases(updated);
  return updated;
}

export function removeOccurrenceFromPhrase(
  phrases: LocalPhrase[],
  phraseId: string,
  occurrenceIndex: number
): LocalPhrase[] {
  const updated = phrases.map((p) =>
    p.id === phraseId
      ? { ...p, occurrences: p.occurrences.filter((_, i) => i !== occurrenceIndex) }
      : p
  );
  saveLocalPhrases(updated);
  return updated;
}

export function exportLocalPhrasesJson(phrases: LocalPhrase[]): string {
  return JSON.stringify(phrases, null, 2);
}

export function importLocalPhrasesJson(json: string): LocalPhrase[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error("Invalid format: expected array");
  // Basic validation
  for (const p of parsed) {
    if (!p.id || !p.phraseText || !p.sourceAyah || !p.sourceWordRange || !p.occurrences) {
      throw new Error("Invalid phrase entry");
    }
  }
  saveLocalPhrases(parsed);
  return parsed;
}

export function localPhrasesToHighlights(phrases: LocalPhrase[]): AyahHighlights {
  const result: AyahHighlights = {};

  for (const phrase of phrases) {
    // Add source ayah highlight
    const sourceKey = phrase.sourceAyah;
    if (!result[sourceKey]) result[sourceKey] = [];
    result[sourceKey].push({
      type: "phrase",
      id: `local-${phrase.id}`,
      wordRanges: [phrase.sourceWordRange],
    });

    // Add occurrence highlights
    for (const occ of phrase.occurrences) {
      if (!result[occ.ayahKey]) result[occ.ayahKey] = [];
      result[occ.ayahKey].push({
        type: "phrase",
        id: `local-${phrase.id}`,
        wordRanges: [occ.wordRange],
      });
    }
  }

  return result;
}

export function findAyahText(
  pages: QuranPage[],
  surah: number,
  ayah: number
): string | null {
  for (const page of pages) {
    for (const group of page.surahGroups) {
      for (const a of group.ayahs) {
        if (a.surah === surah && a.ayah === ayah) {
          return a.words.map(w => w.text).join(' ');
        }
      }
    }
  }
  return null;
}
