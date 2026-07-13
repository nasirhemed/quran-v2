import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";

interface PhraseData {
  surahs: number;
  ayahs: number;
  count: number;
  source: {
    key: string;
    from: number;
    to: number;
  };
  ayah: Record<string, [number, number][]>;
}

interface WordByWordEntry {
  id: number;
  surah: string;
  ayah: string;
  word: string;
  location: string;
  text: string;
}

interface SimilarMatch {
  verse_key: string;
  matched_ayah_key: string;
  matched_words_count: number;
  coverage: number;
  score: number;
  match_words_range: string;
}

// Output types matching frontend expectations
interface PhraseListItem {
  id: string;
  phraseText: string;
  surahCount: number;
  ayahCount: number;
  totalOccurrences: number;
  sourceAyah: string;
  occurrences: string[];
  occurrencePhraseTexts: Record<string, string>;
  occurrenceAyahPreviews: Record<string, string>;
}

interface Phrase {
  id: string;
  phraseText: string;
  surahCount: number;
  ayahCount: number;
  totalOccurrences: number;
  sourceAyah: string;
  sourceWordRange: [number, number];
  occurrences: {
    ayahKey: string;
    ayahText: string;
    wordRanges: [number, number][];
  }[];
}

interface SimilarAyahListItem {
  id: string;
  primaryVerseKey: string;
  sourceAyahText: string;
  occurrences: string[];
  totalSimilarCount: number;
}

interface SimilarAyah {
  id: string;
  sourceAyahKey: string;
  sourceAyahText: string;
  similarAyahs: {
    ayahKey: string;
    ayahText: string;
    matchedWordsCount: number;
    coverage: number;
    score: number;
    matchWordsRange: [number, number];
  }[];
}

/**
 * Build a map of ayahKey -> words[] from the word-by-word JSON.
 * The last word of each ayah is the verse number marker and is excluded.
 */
function buildWbwAyahMap(wbwPath: string): Map<string, string[]> {
  console.log("Loading word-by-word Quran data...");
  const wbwData = JSON.parse(fs.readFileSync(wbwPath, "utf-8")) as Record<string, WordByWordEntry>;

  // Group words by ayah key (surah:ayah), ordered by word number
  const ayahWordsMap = new Map<string, { word: number; text: string }[]>();
  for (const entry of Object.values(wbwData)) {
    const ayahKey = `${entry.surah}:${entry.ayah}`;
    const existing = ayahWordsMap.get(ayahKey) || [];
    existing.push({ word: parseInt(entry.word), text: entry.text });
    ayahWordsMap.set(ayahKey, existing);
  }

  // Sort by word number and exclude the last word (verse number marker)
  const result = new Map<string, string[]>();
  for (const [ayahKey, words] of ayahWordsMap) {
    words.sort((a, b) => a.word - b.word);
    // Exclude last word (verse number marker like ٢٣)
    const contentWords = words.slice(0, -1).map(w => w.text);
    result.set(ayahKey, contentWords);
  }

  console.log(`Loaded word-by-word data for ${result.size} ayahs`);
  return result;
}

function main() {
  const similarAyahDbPath = "attached_assets/matching-ayah_1768282861619.db";
  const phrasesJsonPath = "attached_assets/data/mutashabihat_data/phrases.json";
  const phraseVersesJsonPath = "attached_assets/data/mutashabihat_data/phrase_verses.json";
  const wbwJsonPath = "attached_assets/data/qpc-hafs-word-by-word.json";
  const outputDir = "client/public/data";

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Load word-by-word data (used for phrase text extraction and ayah text)
  const wbwAyahMap = buildWbwAyahMap(wbwJsonPath);

  // Load SQLite database for similar ayahs
  console.log("Opening similar ayah database...");
  const similarAyahDb = new Database(similarAyahDbPath);

  // Load phrases JSON
  console.log("Loading phrases JSON...");
  const phrasesJson = JSON.parse(fs.readFileSync(phrasesJsonPath, "utf-8")) as Record<string, PhraseData>;

  // Load phrase_verses JSON
  console.log("Loading phrase_verses JSON...");
  const phraseVersesJson = JSON.parse(fs.readFileSync(phraseVersesJsonPath, "utf-8")) as Record<string, number[]>;

  // Load similar ayah matches
  console.log("Loading similar ayah matches...");
  const matches = similarAyahDb
    .prepare("SELECT verse_key, matched_ayah_key, matched_words_count, coverage, score, match_words_range FROM similar_ayahs")
    .all() as SimilarMatch[];
  console.log(`Loaded ${matches.length} similar ayah matches`);

  // Process Mutashabihat phrases
  console.log("Processing mutashabihat phrases...");
  const phraseList: PhraseListItem[] = [];
  const phraseDetails: Record<string, Phrase> = {};

  // Build a mapping from original phrase ID to our sequential ID
  const originalIdToId = new Map<string, string>();
  let phraseId = 1;

  for (const [originalId, phrase] of Object.entries(phrasesJson)) {
    const sourceWords = wbwAyahMap.get(phrase.source.key);
    if (!sourceWords) {
      console.warn(`Source ayah not found in WBW data: ${phrase.source.key}`);
      continue;
    }

    // Extract phrase text from source ayah using WBW word indices
    const phraseWords = sourceWords.slice(phrase.source.from - 1, phrase.source.to);
    const phraseText = phraseWords.join(" ");

    // Collect all occurrences
    const occurrenceKeys: string[] = [];
    const occurrencesWithText: Phrase["occurrences"] = [];
    const occurrencePhraseTexts: Record<string, string> = {};
    const occurrenceAyahPreviews: Record<string, string> = {};

    for (const [ayahKey, wordRanges] of Object.entries(phrase.ayah)) {
      occurrenceKeys.push(ayahKey);
      const ayahWords = wbwAyahMap.get(ayahKey);
      const ayahText = ayahWords ? ayahWords.join(" ") : "";
      occurrencesWithText.push({
        ayahKey,
        ayahText,
        wordRanges: wordRanges,
      });

      // Extract per-occurrence phrase text using WBW word ranges
      if (ayahWords && wordRanges.length > 0) {
        const [from, to] = wordRanges[0];
        occurrencePhraseTexts[ayahKey] = ayahWords.slice(from - 1, to).join(" ");
      }

      // First 5 words of the ayah as a preview
      if (ayahWords) {
        occurrenceAyahPreviews[ayahKey] = ayahWords.slice(0, 5).join(" ");
      }
    }

    // Sort occurrences by ayah key
    occurrenceKeys.sort();
    occurrencesWithText.sort((a, b) => a.ayahKey.localeCompare(b.ayahKey));

    // Count unique surahs
    const uniqueSurahs = new Set(occurrenceKeys.map(k => parseInt(k.split(":")[0])));

    const id = phraseId.toString();
    originalIdToId.set(originalId, id);

    phraseList.push({
      id,
      phraseText,
      surahCount: uniqueSurahs.size,
      ayahCount: occurrenceKeys.length,
      totalOccurrences: occurrenceKeys.length,
      sourceAyah: phrase.source.key,
      occurrences: occurrenceKeys,
      occurrencePhraseTexts,
      occurrenceAyahPreviews,
    });

    phraseDetails[id] = {
      id,
      phraseText,
      surahCount: uniqueSurahs.size,
      ayahCount: occurrenceKeys.length,
      totalOccurrences: occurrenceKeys.length,
      sourceAyah: phrase.source.key,
      sourceWordRange: [phrase.source.from, phrase.source.to],
      occurrences: occurrencesWithText,
    };

    phraseId++;
  }

  // Sort phrase list by total occurrences descending
  phraseList.sort((a, b) => b.totalOccurrences - a.totalOccurrences);

  console.log(`Processed ${phraseList.length} phrases`);

  // Build phrase-verses mapping (ayahKey -> list of our sequential phrase IDs)
  console.log("Processing phrase-verses mapping...");
  const phraseVersesOutput: Record<string, string[]> = {};
  for (const [ayahKey, originalIds] of Object.entries(phraseVersesJson)) {
    const mappedIds = originalIds
      .map(oid => originalIdToId.get(oid.toString()))
      .filter((id): id is string => id !== undefined);
    if (mappedIds.length > 0) {
      phraseVersesOutput[ayahKey] = mappedIds;
    }
  }
  console.log(`Processed phrase-verses for ${Object.keys(phraseVersesOutput).length} ayahs`);

  // Helper to get ayah text from WBW map
  function getAyahText(ayahKey: string): string {
    const words = wbwAyahMap.get(ayahKey);
    return words ? words.join(" ") : "";
  }

  // Process Similar Ayahs
  console.log("Processing similar ayahs...");

  // Group matches by source verse text (to deduplicate similar verses with same text)
  const matchesByVerseKey = new Map<string, SimilarMatch[]>();
  for (const match of matches) {
    const existing = matchesByVerseKey.get(match.verse_key) || [];
    existing.push(match);
    matchesByVerseKey.set(match.verse_key, existing);
  }

  // Group by source text to deduplicate
  const matchesBySourceText = new Map<string, { verseKey: string; matches: SimilarMatch[] }>();
  for (const [verseKey, verseMatches] of matchesByVerseKey) {
    const text = getAyahText(verseKey);
    if (!text) continue;

    const existing = matchesBySourceText.get(text);
    if (existing) {
      existing.matches.push(...verseMatches);
    } else {
      matchesBySourceText.set(text, { verseKey, matches: verseMatches });
    }
  }

  const similarAyahList: SimilarAyahListItem[] = [];
  const similarAyahDetails: Record<string, SimilarAyah> = {};

  for (const [sourceText, { verseKey, matches: groupMatches }] of matchesBySourceText) {
    // Get unique verse keys that have similar matches
    const occurrenceKeys = [...new Set(groupMatches.map(m => m.verse_key))].sort();

    // Build detail with all similar ayahs
    const allSimilarAyahs = groupMatches.map(match => {
      const matchRange = JSON.parse(match.match_words_range) as number[][];
      return {
        ayahKey: match.matched_ayah_key,
        ayahText: getAyahText(match.matched_ayah_key),
        matchedWordsCount: match.matched_words_count,
        coverage: match.coverage,
        score: match.score,
        matchWordsRange: (matchRange[0] || [0, 0]) as [number, number],
      };
    });

    // Deduplicate by ayahKey, keeping highest score
    const deduped = new Map<string, typeof allSimilarAyahs[0]>();
    for (const sa of allSimilarAyahs) {
      const existing = deduped.get(sa.ayahKey);
      if (!existing || sa.score > existing.score) {
        deduped.set(sa.ayahKey, sa);
      }
    }
    const similarAyahs = Array.from(deduped.values());

    // Sort by score descending
    similarAyahs.sort((a, b) => b.score - a.score);

    similarAyahList.push({
      id: verseKey,
      primaryVerseKey: verseKey,
      sourceAyahText: sourceText,
      occurrences: occurrenceKeys,
      totalSimilarCount: similarAyahs.length,
    });

    similarAyahDetails[verseKey] = {
      id: verseKey,
      sourceAyahKey: verseKey,
      sourceAyahText: sourceText,
      similarAyahs,
    };
  }

  // Sort similar ayah list by total count descending
  similarAyahList.sort((a, b) => b.totalSimilarCount - a.totalSimilarCount);

  console.log(`Processed ${similarAyahList.length} similar ayah groups`);

  // Write output files
  console.log("Writing output files...");

  fs.writeFileSync(
    path.join(outputDir, "mutashabihat-list.json"),
    JSON.stringify(phraseList, null, 2)
  );
  console.log(`  Written: mutashabihat-list.json (${phraseList.length} items)`);

  fs.writeFileSync(
    path.join(outputDir, "mutashabihat-details.json"),
    JSON.stringify(phraseDetails, null, 2)
  );
  console.log(`  Written: mutashabihat-details.json (${Object.keys(phraseDetails).length} items)`);

  fs.writeFileSync(
    path.join(outputDir, "similar-ayah-list.json"),
    JSON.stringify(similarAyahList, null, 2)
  );
  console.log(`  Written: similar-ayah-list.json (${similarAyahList.length} items)`);

  fs.writeFileSync(
    path.join(outputDir, "similar-ayah-details.json"),
    JSON.stringify(similarAyahDetails, null, 2)
  );
  console.log(`  Written: similar-ayah-details.json (${Object.keys(similarAyahDetails).length} items)`);

  fs.writeFileSync(
    path.join(outputDir, "phrase-verses.json"),
    JSON.stringify(phraseVersesOutput, null, 2)
  );
  console.log(`  Written: phrase-verses.json (${Object.keys(phraseVersesOutput).length} ayahs)`);

  // Close databases
  similarAyahDb.close();

  console.log("\nData export complete!");
}

main();
