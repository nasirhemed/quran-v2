/**
 * The mushaf font pack: the King Fahd Complex's QCF V2 fonts (the 1421H Madinah print, as on quran.com). Every
 * page has its own font in which each word is one pre-drawn glyph, so a page drawn from its words' glyph codes
 * (QuranWord.glyph) on its printed lines (lineNumber) reproduces the print exactly.
 *
 * The pack is hosted with the voice model packs, at `<VITE_MODEL_BASE_URL>/<id>/<version>/<file>` (served from
 * MODELS_DIR at /models in dev), never in the app bundle: 98 MB is too much to precache. The same URLs and the
 * manifest (file sizes and SHA-256) serve any other client, e.g. a native app.
 *
 * Files: p1.woff2 … p604.woff2, surah-names.woff2 (headers: the ligatures "surah" and "038" draw "سورة" and "ص") and
 * manifest.json. Built by scripts/build-mushaf-data.py; uploaded with `npm run upload-models -- <dir> qcf-v2`.
 */
export const MUSHAF_PACK = { id: "qcf-v2", version: "1" } as const;

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
 * The widest printed line of any page, in em of the page fonts (measured from their advance widths by
 * scripts/build-mushaf-data.py), plus a hair of room. One em = column width / this, so every line fits.
 */
export const LINE_WIDTH_EM = 16.3; // widest: 16.22 (a full line is 15.75)

export const pageFontFile = (page: number) => `p${page}.woff2`;
export const pageFontFamily = (page: number) => `qcf-p${page}`;

export const SURAH_NAMES_FILE = "surah-names.woff2";
export const SURAH_NAMES_FAMILY = "qcf-surah-names";

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

export const packFileUrl = (base: string, name: string) => `${base}/${MUSHAF_PACK.id}/${MUSHAF_PACK.version}/${name}`;

/** The manifest ships with the app (precached, so offline status works) and is uploaded beside the fonts. */
export const MANIFEST_URL = "/data/mushaf-fonts.json";
