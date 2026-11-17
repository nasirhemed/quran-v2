/**
 * The mushaf font packs: the King Fahd Complex's QCF page fonts, one per print the reader can draw (layouts.ts).
 * Every page has its own font in which each word is one pre-drawn glyph, so a page drawn from its words' glyph
 * codes (QuranWord.glyph) on its printed lines (lineNumber) reproduces the print exactly.
 *
 * - qcf-v2: QCF V2, the 1421H Madinah print (as on quran.com). The default.
 * - qcf-v1: QCF V1, the 1405H Madinah print.
 *
 * Packs are hosted with the voice model packs, at `<VITE_MODEL_BASE_URL>/<id>/<version>/<file>` (served from
 * MODELS_DIR at /models in dev), never in the app bundle: ~100 MB each is too much to precache. The same URLs and
 * the manifests (file sizes and SHA-256) serve any other client, e.g. a native app.
 *
 * Files: p1.woff2 … p604.woff2, surah-names.woff2 (headers: the ligatures "surah" and "038" draw "سورة" and "ص") and
 * manifest.json. Built by scripts/build-mushaf-data.py; uploaded with `npm run upload-models -- <dir> <pack id>`.
 */
export interface MushafPack {
  id: string;
  version: string;
  /**
   * Where else a file can be fetched when our host doesn't have it (not uploaded yet): quran.com's own font host,
   * which sends CORS headers, so cross-origin isolation allows it. Same files, so the manifest's SHA-256 holds.
   */
  mirror?: (name: string) => string;
}

/** quran.com's font host (scripts/build-mushaf-data.py downloads the packs from it). */
const QURAN_FONTS = "https://verses.quran.foundation/fonts/quran";
const quranFonts = (pageDir: string) => (name: string) =>
  name === "surah-names.woff2" ? `${QURAN_FONTS}/surah-names/v1/sura_names.woff2` : `${QURAN_FONTS}/${pageDir}/${name}`;

export const QCF_V2: MushafPack = { id: "qcf-v2", version: "1" };
export const QCF_V1: MushafPack = { id: "qcf-v1", version: "1", mirror: quranFonts("hafs/v1/woff2") };

/** The default pack (the 1421H print). */
export const MUSHAF_PACK = QCF_V2;

export const PAGE_COUNT = 604;

export interface MushafFile {
  name: string;
  bytes: number;
  sha256: string;
}

export interface MushafManifest {
  id: string;
  version: string;
  files: MushafFile[];
}

/**
 * The widest printed line of any 1421H page, in em of the QCF V2 page fonts (measured from their advance widths by
 * scripts/build-mushaf-data.py), plus a hair of room. One em = column width / this, so every line fits. (The 1405H
 * print's width is in its own data file, mushaf-1405.json.)
 */
export const LINE_WIDTH_EM = 16.3; // widest: 16.22 (a full line is 15.75)

export const pageFontFile = (page: number) => `p${page}.woff2`;
/** Family names carry the pack, so two prints' page fonts never stand in for each other. */
export const pageFontFamily = (page: number, pack: MushafPack = MUSHAF_PACK) => `${pack.id}-p${page}`;

export const SURAH_NAMES_FILE = "surah-names.woff2";
export const surahNamesFamily = (pack: MushafPack = MUSHAF_PACK) => `${pack.id}-surah-names`;
/** The 1421H pack's surah-name family. */
export const SURAH_NAMES_FAMILY = surahNamesFamily(QCF_V2);

/**
 * The surah-name font has two ligatures per header: "surah" draws the word سورة, and "001" … "114" draws the
 * surah's name. They are drawn as two items of a right-to-left row (SurahHeader), so سورة comes first, on the
 * right, and the name follows on its left. (Both in one string would put the name on the right.)
 */
export const SURAH_WORD_LIGATURE = "surah";
export const surahNameLigature = (surah: number) => String(surah).padStart(3, "0");

/** Where packs are hosted: VITE_MODEL_BASE_URL, or `/models` (served from MODELS_DIR by the dev server). */
export function packBaseUrl(): string {
  return (import.meta.env.VITE_MODEL_BASE_URL || "/models").replace(/\/$/, "");
}

export const packFileUrl = (base: string, name: string, pack: MushafPack = MUSHAF_PACK) =>
  `${base}/${pack.id}/${pack.version}/${name}`;

/** The 1421H manifest ships with the app (precached, so offline status works) and is uploaded beside the fonts. */
export const MANIFEST_URL = "/data/mushaf-fonts.json";
