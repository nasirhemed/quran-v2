import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from "fs";
import { XMLParser } from "fast-xml-parser";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.resolve(import.meta.dirname, "../public/data");
const CACHE_DIR = path.join(OUT, ".cache");

mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

// ─── API Configuration ──────────────────────────────────────────

const API_BASE_URL = "https://api.quran.com/api/v4";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RATE_LIMIT_DELAY_MS = 200; // 5 requests per second
const MAX_RETRIES = 3;

interface QuranComWord {
  text_uthmani: string;
  line_number: number;
  position: number;
  char_type_name: "word" | "end";
}

interface QuranComVerse {
  verse_key: string;
  words: QuranComWord[];
}

interface QuranComResponse {
  verses: QuranComVerse[];
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  retries: number = MAX_RETRIES
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      if (response.status === 429) {
        // Rate limited, wait longer
        const waitTime = Math.pow(2, i) * 1000;
        console.log(`Rate limited, waiting ${waitTime}ms...`);
        await sleep(waitTime);
        continue;
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      if (i === retries - 1) throw error;
      const waitTime = Math.pow(2, i) * 500;
      console.log(`Retry ${i + 1}/${retries} after ${waitTime}ms...`);
      await sleep(waitTime);
    }
  }
  throw new Error("Max retries exceeded");
}

async function fetchPageFromAPI(pageNumber: number): Promise<QuranComVerse[]> {
  // Check cache first
  const cacheFile = path.join(CACHE_DIR, `page-${pageNumber}.json`);
  if (existsSync(cacheFile)) {
    const stats = await import("fs").then((fs) =>
      fs.promises.stat(cacheFile)
    );
    const age = Date.now() - stats.mtimeMs;
    if (age < CACHE_TTL_MS) {
      const cached = JSON.parse(readFileSync(cacheFile, "utf-8"));
      return cached;
    }
  }

  // Fetch from API
  const url = `${API_BASE_URL}/verses/by_page/${pageNumber}?words=true&word_fields=text_uthmani,line_number,position,char_type_name`;

  await sleep(RATE_LIMIT_DELAY_MS); // Rate limiting

  const response = await fetchWithRetry(url);
  const data: QuranComResponse = await response.json();

  // Cache the result
  writeFileSync(cacheFile, JSON.stringify(data.verses, null, 2));

  return data.verses;
}

// ─── Parse XML sources (for metadata only) ─────────────────────

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });

const metaXml = readFileSync(
  path.join(ROOT, "memorization/src/assets/quran/quran-metadata.xml"),
  "utf-8"
);

const metaDoc = parser.parse(metaXml);

// ─── Build surah data ───────────────────────────────────────────

interface SurahMeta {
  index: number;
  name: string;
  tname: string;
  ename: string;
  ayas: number;
  type: string;
  order: number;
  startPage: number;
}

const rawSuras = metaDoc.quran.suras.sura;
const rawPages = metaDoc.quran.pages.page;
const rawJuzs = metaDoc.quran.juzs.juz;

// Build page lookup: array of { index, sura, aya }
const pages: { index: number; sura: number; aya: number }[] = rawPages.map(
  (p: any) => ({
    index: Number(p.index),
    sura: Number(p.sura),
    aya: Number(p.aya),
  })
);

// Juz boundaries
const juzBoundaries: { index: number; sura: number; aya: number }[] =
  rawJuzs.map((j: any) => ({
    index: Number(j.index),
    sura: Number(j.sura),
    aya: Number(j.aya),
  }));

// For each surah, find its start page
function findStartPage(surahIndex: number): number {
  // Get the surah's first ayah
  for (const page of pages) {
    if (page.sura === surahIndex && page.aya === 1) {
      return page.index;
    }
    // If a page starts in the middle of a surah that comes after ours,
    // the previous page must contain our surah's start
    if (page.sura > surahIndex) {
      return page.index - 1;
    }
  }
  return 604;
}

// Actually a more accurate approach: find the page whose start position
// is <= surah:1 and the next page's start is > surah:1
function findPageForAyah(
  surahIndex: number,
  ayahIndex: number
): number {
  for (let i = pages.length - 1; i >= 0; i--) {
    const p = pages[i];
    if (
      p.sura < surahIndex ||
      (p.sura === surahIndex && p.aya <= ayahIndex)
    ) {
      return p.index;
    }
  }
  return 1;
}

const surahs: SurahMeta[] = rawSuras.map((s: any) => ({
  index: Number(s.index),
  name: s.name,
  tname: s.tname,
  ename: s.ename,
  ayas: Number(s.ayas),
  type: s.type,
  order: Number(s.order),
  startPage: findPageForAyah(Number(s.index), 1),
}));

writeFileSync(path.join(OUT, "surahs.json"), JSON.stringify(surahs, null, 2));
console.log("✓ surahs.json (114 entries)");

// ─── Build juz metadata ─────────────────────────────────────────

interface JuzMeta {
  index: number;
  sura: number;
  aya: number;
  startPage: number;
}

const juzMetadata: JuzMeta[] = juzBoundaries.map((j) => ({
  ...j,
  startPage: findPageForAyah(j.sura, j.aya),
}));

writeFileSync(
  path.join(OUT, "juz-metadata.json"),
  JSON.stringify(juzMetadata, null, 2)
);
console.log("✓ juz-metadata.json (30 entries)");

// ─── Build quran-pages.json ─────────────────────────────────────

interface QuranWord {
  text: string;
  lineNumber: number;
  position: number;
  charType: "word" | "end";
}

interface PageAyah {
  surah: number;
  ayah: number;
  words: QuranWord[];
}

interface PageSurahGroup {
  surahIndex: number;
  surahName: string;
  tname: string;
  isSurahStart: boolean;
  bismillah: string | null;
  ayahs: PageAyah[];
}

interface QuranPage {
  pageNumber: number;
  juz: number;
  surahGroups: PageSurahGroup[];
}

function getJuzForPage(pageNum: number): number {
  let juz = 1;
  for (const j of juzMetadata) {
    if (j.startPage <= pageNum) {
      juz = j.index;
    } else {
      break;
    }
  }
  return juz;
}

const quranPages: QuranPage[] = [];

console.log("\nFetching page data from Quran.com API...");

for (let pageNumber = 1; pageNumber <= 604; pageNumber++) {
  if (pageNumber % 50 === 0) {
    console.log(`Processing page ${pageNumber}/604...`);
  }

  // Fetch verses for this page from API
  const verses = await fetchPageFromAPI(pageNumber);

  // Group verses by surah
  const surahMap = new Map<number, PageAyah[]>();

  for (const verse of verses) {
    const [surahStr, ayahStr] = verse.verse_key.split(":");
    const surah = Number(surahStr);
    const ayah = Number(ayahStr);

    // Convert API words to our format (filter out "end" markers)
    const words: QuranWord[] = verse.words
      .filter((w) => w.char_type_name === "word")
      .map((w) => ({
        text: w.text_uthmani,
        lineNumber: w.line_number,
        position: w.position,
        charType: w.char_type_name,
      }));

    // Validate word positions are sequential
    for (let i = 0; i < words.length; i++) {
      if (words[i].position !== i + 1) {
        console.warn(
          `Warning: Non-sequential word positions in ${verse.verse_key}`
        );
      }
    }

    // Validate line numbers are in expected range (1-15 for most pages)
    for (const word of words) {
      if (word.lineNumber < 1 || word.lineNumber > 20) {
        console.warn(
          `Warning: Unusual line number ${word.lineNumber} in ${verse.verse_key}`
        );
      }
    }

    if (!surahMap.has(surah)) {
      surahMap.set(surah, []);
    }

    surahMap.get(surah)!.push({
      surah,
      ayah,
      words,
    });
  }

  // Build surah groups
  const surahGroups: PageSurahGroup[] = [];

  for (const [surah, ayahs] of Array.from(surahMap.entries()).sort(
    ([a], [b]) => a - b
  )) {
    const surahMeta = surahs.find((s) => s.index === surah);
    if (!surahMeta) {
      console.warn(`Warning: No metadata for surah ${surah}`);
      continue;
    }

    // Check if this is the start of the surah (ayah 1 is present)
    const isSurahStart = ayahs.some((a) => a.ayah === 1);

    // Bismillah: only at surah start, not for Surah 1 or 9
    const bismillah =
      isSurahStart && surah !== 1 && surah !== 9
        ? "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ"
        : null;

    surahGroups.push({
      surahIndex: surah,
      surahName: surahMeta.name,
      tname: surahMeta.tname,
      isSurahStart,
      bismillah,
      ayahs,
    });
  }

  quranPages.push({
    pageNumber,
    juz: getJuzForPage(pageNumber),
    surahGroups,
  });
}

writeFileSync(
  path.join(OUT, "quran-pages.json"),
  JSON.stringify(quranPages, null, 2)
);
console.log(`✓ quran-pages.json (${quranPages.length} pages)`);

// ─── Build ayah-highlights.json ─────────────────────────────────

const mutashabihatPath = path.join(
  ROOT,
  "mutashabihat/client/public/data/mutashabihat-details.json"
);
const similarAyahPath = path.join(
  ROOT,
  "mutashabihat/client/public/data/similar-ayah-details.json"
);

const mutashabihat = JSON.parse(readFileSync(mutashabihatPath, "utf-8"));
const similarAyahs = JSON.parse(readFileSync(similarAyahPath, "utf-8"));

// ayah-highlights: for each ayahKey, list all phrase highlights and similar ayah highlights
interface HighlightEntry {
  type: "phrase" | "similar";
  id: string;
  wordRanges: [number, number][];
}

const ayahHighlights: Record<string, HighlightEntry[]> = {};

function addHighlight(ayahKey: string, entry: HighlightEntry) {
  if (!ayahHighlights[ayahKey]) {
    ayahHighlights[ayahKey] = [];
  }
  ayahHighlights[ayahKey].push(entry);
}

// Process mutashabihat phrases
for (const [id, phrase] of Object.entries(mutashabihat) as [string, any][]) {
  if (!phrase.occurrences) continue;
  for (const occ of phrase.occurrences) {
    if (occ.wordRanges && occ.wordRanges.length > 0) {
      addHighlight(occ.ayahKey, {
        type: "phrase",
        id,
        wordRanges: occ.wordRanges,
      });
    }
  }
}

// Process similar ayahs - highlight the source ayah
for (const [id, entry] of Object.entries(similarAyahs) as [string, any][]) {
  if (!entry.similarAyahs || entry.similarAyahs.length === 0) continue;

  // Find the source ayah to get word count
  const [surahStr, ayahStr] = entry.sourceAyahKey.split(":");
  const surah = Number(surahStr);
  const ayah = Number(ayahStr);

  let wordCount = 0;
  for (const page of quranPages) {
    for (const group of page.surahGroups) {
      for (const a of group.ayahs) {
        if (a.surah === surah && a.ayah === ayah) {
          wordCount = a.words.length;
          break;
        }
      }
      if (wordCount > 0) break;
    }
    if (wordCount > 0) break;
  }

  if (wordCount > 0) {
    addHighlight(entry.sourceAyahKey, {
      type: "similar",
      id,
      wordRanges: [[1, wordCount]], // full ayah
    });
  }
}

writeFileSync(
  path.join(OUT, "ayah-highlights.json"),
  JSON.stringify(ayahHighlights, null, 2)
);
console.log(
  `✓ ayah-highlights.json (${Object.keys(ayahHighlights).length} ayahs with highlights)`
);

// ─── Copy mutashabihat data files ───────────────────────────────

copyFileSync(mutashabihatPath, path.join(OUT, "mutashabihat-details.json"));
console.log("✓ mutashabihat-details.json (copied)");

copyFileSync(similarAyahPath, path.join(OUT, "similar-ayah-details.json"));
console.log("✓ similar-ayah-details.json (copied)");

console.log("\nDone! All data files written to public/data/");
