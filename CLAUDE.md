# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Itqān (quran-v2) unifies three previously separate apps into one Qur'an study
app with three tabs sharing one shell, one theme, and one data folder:

- **Read** (`/`, `/read`) — mushaf reader with word-level Mutashabihat
  highlighting, ported from `nasirhemed/quran-reader`.
- **Browse** (`/browse`) — similar phrases & similar verses by surah and
  verse, with harakat-insensitive search; rebuilt from `nasirhemed/Quran-Practice`.
- **Practice** (`/practice`) — a competition-style recitation test, rebuilt
  from `nasirhemed/memorization`: the opening words of a verse, recite on to
  the end of the next page; questions start where verses have look-alikes.

## Commands

```bash
npm run dev      # Vite dev server
npm run build    # tsc -b && vite build
npm run check    # TypeScript type checking (app, then tests)
npm test         # Vitest: the recitation engine, browse, practice and mushaf libs (tests/)
npm run preview  # Preview production build
```

Tests live in `tests/` (their own `tsconfig.test.json`). The recitation tests replay recorded model output
from `tests/fixtures/recitation/`; the owner's private recordings are picked up from
`$RECITATION_PRIVATE_FIXTURES` (default `../../recordings`) and skipped when absent — never commit them.

## Architecture

- **Stack**: React 18 + TypeScript + Vite, Tailwind 3, wouter (routing),
  TanStack Query (staleTime Infinity — static data never refetches).
- **Data** (`public/data/`): static JSON, currently copied from the source
  repos' generated outputs and then MINIFIED (no whitespace; the unused
  `charType` word field is stripped — quran-pages.json went 14.6MB → 4.8MB).
  The future pipeline must emit minified JSON too. Files: `quran-pages.json`
  (604 pages of the 1421H print, word-level, from the quran.com API; mushaf layout fields and pagination from
  `scripts/build-mushaf-data.py`), `surahs.json`,
  `juz-metadata.json`, `ayah-highlights.json`,
  `mutashabihat-{list,details}.json`, `similar-ayah-{list,details}.json`,
  `phrase-verses.json`. Original source: QUL morphology phrases
  (https://qul.tarteel.ai/morphology_phrases).
- **Theme**: token CSS variables in `src/index.css` (light "paper mushaf" /
  dark slate), applied via `tailwind.config.ts`. The `slate`/`amber`/`surface`
  Tailwind scales are remapped onto tokens so code ported from quran-reader is
  theme-aware without rewrites — do not use raw Tailwind palette colors; use
  the semantic names (ground/card/ink/muted/edge/primary/gold) in new code.
  Theme choice persists in localStorage ("theme") and is stamped on
  `<html data-theme>` pre-paint by an inline script in index.html.
- **Reader internals** (ported): `hooks/useNavigation` (URL params on
  `/read`), `hooks/useQuranPage`, `lib/highlights.ts` (colors are
  `var(--hl-N-bg/bd)` references), localStorage phrase editing in
  `hooks/useLocalPhrases` + `components/edit/`.
- **Mushaf rendering** (`components/page/QuranPage.tsx`): pages are drawn like quran.com, from the King Fahd
  Complex's QCF V2 fonts (the 1421H Madinah print): one font per page, each word one glyph (`QuranWord.glyph`),
  on its printed line. Pages follow that print too (36 pages differ from the older 1405H print, e.g. 120-123,
  583-600). `quran-pages.json` carries, per word, `glyph` + `lineNumber` (V2 line); per ayah, `end`
  (the ayah-number ornament's glyph and line: it can open the next line); per page, `lines` (15, or 8 on pages
  1-2: `surah` header / `bismillah` / `text`, `centered` for short lines; a header can sit at the foot of the
  previous page). `lib/mushaf/layout.ts` turns that into lines (plain TS, portable). One font size for all pages:
  column width / `LINE_WIDTH_EM`, so lines never wrap; highlights must only colour a word (no padding, margin or
  border). Glyph codes are meaningless outside their font, so each word carries `sr-only` text for screen readers,
  and copying swaps in the selected words' Unicode text (`data-copy`, `onCopy`). Without fonts (not hosted, or offline on a page never opened) the page falls back to Unicode text.
  Everything else (Browse, Practice, voice) uses the Unicode `text`.
- **Mushaf font pack** (`lib/mushaf/pack.ts`, `fontStore.ts`, `hooks/useMushafFonts.ts`): `qcf-v2`, 604 page fonts
  + `surah-names.woff2`, 98 MB, hosted with the model packs at `$VITE_MODEL_BASE_URL/qcf-v2/1/<file>` (never
  bundled or precached) with a `manifest.json` (sizes, SHA-256) so other clients (a native app) use the same
  files. A page's font is fetched on first view, kept in Cache Storage (`mushaf-qcf-v2-1`), registered as a
  FontFace, and the pages either side are loaded ahead. The Read home page (`components/mushaf/OfflineMushaf.tsx`)
  saves the whole pack for offline use. The bismillah line is drawn with page 1's glyphs for 1:1. Surah headers
  draw the font's "surah" and "001"…"114" ligatures as two items of a right-to-left row (سورة on the right, the
  name on its left); in one string the name would come out on the right.
  `scripts/build-mushaf-data.py <pack dir>` (Python, fontTools) rebuilds the page data from quran.com's own
  verses API (`api.qurancdn.com/api/qdc`, mushaf=1; NOT the public v4 by_page, which is the 1405H pagination with
  some wrong glyphs), the fonts, the manifest (also `public/data/mushaf-fonts.json`) and `LINE_WIDTH_EM`; it fails
  on any line wider than the print allows (source errors go in its `LINE_FIXES`); `npm run upload-models -- <pack dir>/qcf-v2/1 qcf-v2`
  uploads it. Local testing: put the pack under `MODELS_DIR` (`<dir>/qcf-v2/1/…`).
- **Practice** (`src/lib/practice.ts`, plain TS, tested; `pages/PracticePage.tsx`): modelled on how competitions
  test hifz — the judge reads a verse's opening words (5–7, or as many as tell it from look-alikes), the contestant
  recites on (5–7 lines to a page), judges like to start inside look-alikes, and drifting into one is the classic
  slip. A question is a start verse + the passage to the end of the NEXT page (1–2 pages), clipped to the range.
  The only settings are the range (juz or surah) and 3/5/10 questions, remembered in localStorage "practice".
  `buildPracticeIndex` (once per session, `hooks/usePracticeIndex`, ~250 ms) rates verse pairs from their words, not
  the similar-ayah scores (which rate a one-word الٓمٓ a perfect match): candidates are the QUL pairs plus verses
  sharing a rare three-word run (finds what QUL misses, e.g. 20:10/28:29); strength = logistic of the rarity-weighted
  words shared in order (word LCS over `foldWord`, which merges spellings that sound alike: dagger alef/alef, ة/ت)
  + half the weight of a shared opening + a share-of-verse term. Verses that open alike count on their own
  (`openingStrength`: the same first 2–6 words, a leading و/ف aside, in few verses — قَالَ ٱلَّذِينَ ٱسۡتَكۡبَرُواْ in
  7:76/34:32/40:48), and more so the same opening words in another order (28:20/36:20). Identical verses count
  where a run of matching verses ends (the slip is in what follows: Ash-Shu'ara's stories); refrains repeated
  through a surah are discounted. A verse's `trap` = its strongest look-alike + 0.15 × the next three.
  `generateQuestions` weights starts (trap ≥ 0.4) by passage difficulty², never reuses a page, spreads across
  surahs, and skips starts its surah repeats word for word (`promptLength` null). The prompt stops where the start
  verse parts from a look-alike that opens the same way (وَإِذَا بُشِّرَ أَحَدُهُم in 43:17, as 16:58), as teachers'
  questions do; otherwise 5 words, or as many as tell it apart in its surah. Checking shows the passage; verses
  with a look-alike ≥ `SHOW_STRENGTH` stand out with up to two look-alikes beneath, both marked by `compareVerses`
  ("diff" = where they part), and for an identical look-alike, how the other place goes on. The setup screen must
  never block on data loading — Start disables instead.
  Validated against two outside sources (tests/practice): a teacher's 95 recitation questions with the look-alikes
  her notes warn about (`tests/fixtures/practice/sard-questions.json`, verse references only): 72% of her start
  verses are traps (47% of all verses), 73% of her look-alikes shown; and Aswaatul Qurraa's per-juz look-alike
  lists (aswaatulqurraa.com/mutashabihat, not committed): 88% of pairs rated ≥ 0.8 are on their list, page ranks
  correlate 0.6. What neither catches: questions on a unique wording (ضَرَبَ لَكُم مَّثَلٗا vs the usual ضَرَبَ ٱللَّهُ
  مَثَلٗا) and one-word variants (وَلَهُۥ مَن فِي / وَلَهُۥ مَا فِي).
- **Browse**: verse-centred. `/browse` lists the 114 surahs and searches (`?q=`); `/browse/surah/:s` lists
  that surah's verses that share a phrase or have a similar verse; `/browse/surah/:s/:a` shows one verse with
  each of its phrases (and the other verses they occur in) and its similar verses; `/browse/phrase/:id` lists a
  phrase's verses. `lib/browse.ts` (plain TS, tested) builds the per-verse index from quran-pages.json +
  mutashabihat-details + similar-ayah-details + ayah-highlights, once per session (`hooks/useBrowseIndex`):
  duplicate phrases merged by occurrence set (the QUL duplicates; merged ids still resolve), similar pairs shown
  from both sides (the data lists them under the source only), phrase ranges nudged onto the words that spell
  the phrase where the source is a word or two off. Verse text comes from the page words, whose segmentation the
  ranges use (the details files' `ayahText` split on spaces does not: waqf marks are separate tokens there).
  Search folds Arabic (`foldArabic`: no harakat/Qur'anic marks, no alef/hamza, no spaces, ى/ي and ة/ه merged)
  so وما ارسلنا finds وَمَآ أَرۡسَلۡنَا; it covers every verse (one with no matches still gets its verse page,
  which links to the reader). Browse links (`BrowseLink` + `useRestoreScroll`) put you back where you
  were when you go back.

- **Voice features (in progress)**: the build spec is `docs/RECITATION_SPEC.md` in the private
  `quran-audio-c` repo (models, prototypes, milestone reports). `src/recitation/` is the voice engine —
  pure TS, no DOM, never imported by the Read/Browse/Practice code paths (it must stay lazy-loaded).
  `public/data/recitation-words.json` (per-word Hafs phonemes) is generated by
  `scripts/build-recitation-data.py` and loaded only by voice features.
  The `/voice` settings page is lazy-loaded; the header's mic button appears only when
  `getVoiceSupport()` (`src/recitation/support.ts`) says yes. Model packs (`src/recitation/asr/modelPack.ts`)
  are downloaded to OPFS by `asr/modelStore.ts` (resumable, SHA-256 checked) from
  `$VITE_MODEL_BASE_URL/<pack id>/<version>/<file>`. For local testing, `MODELS_DIR=<dir> npm run dev`
  (or `preview`) serves `<dir>/<pack id>/<version>/<file>` at `/models`, with Range support. Packs are hosted on
  Vercel Blob for now (R2 later): `BLOB_READ_WRITE_TOKEN=… npm run upload-models -- <dir> [pack id]` checks
  each file's SHA-256, uploads it to that layout, verifies CORS + Range, and prints the base URL.
- **Live ASR (M3)**: `src/recitation/asr/` is plain TS tested in Node — `resample.ts` (= scipy
  `resample_poly`), `features/kaldiFbank.ts` (= kaldi-native-fbank), `pipeline.ts` (61-frame windows every 48,
  greedy CTC), `vad.ts`, `ring.ts`. `workers/asr.worker.ts` and `workers/capture.worklet.ts` are thin hosts;
  `sources/BrowserSource.ts` owns the mic and worker; `/transcribe` (`pages/TranscribePage.tsx`) shows the raw
  phonemes plus a Details panel (step time, real-time factor, sound→screen latency). ONNX Runtime Web's `.wasm`
  is served from `/ort/` (copied at build, never a CDN) and cached on first voice use. Golden parity files are in
  `tests/golden/`; `asr-parity.test.ts` needs model B's ONNX (`RECITATION_MODELS_DIR`, default `../../models`)
  and is skipped without it. Parity rule: identical unit sequence; start frames may differ by one (WASM int8).
- **Follow mode (M4)**: `engine/session.ts` (FollowSession) turns each step's units into engine events
  (heard words, cursor, located/lost, ayahComplete, candidates, pending); `workers/engine.worker.ts` hosts it
  with the whole-Quran index. `session/voice.ts` is the one voice session per tab (ASR worker + engine worker +
  state), shared by `/transcribe` and the reader; it is loaded lazily through `session/lazy.ts` (`useVoice`),
  so importing that hook costs almost nothing. The reader's `components/recitation/FollowControl.tsx` adds
  the Follow button, turns pages, and marks the word just recited by toggling `.voice-current` on the
  `[data-w="s:a:w"]` span directly (QuranPage never re-renders per step). Follow mode never marks mistakes.
- **Hidden words** (recite from memory): the reader's Hide button (`components/recitation/HideWords.tsx`,
  `hooks/useHiddenWords.ts`, remembered in localStorage "hideWords") masks every word (`.words-hidden` in
  `index.css`: transparent text over a faint baseline, highlights suppressed). Words come back one by one as
  Follow mode hears them (`useFollowMode`'s `onHeard`) or when tapped (a hint); `.word-revealed` goes on the span
  directly and QuranPage also reads the revealed set when it renders.
- **Offline / PWA** (`vite-plugin-pwa`, config in `vite.config.ts`): the service worker precaches the app
  shell, fonts and every `public/data/*.json` except `recitation-words.json` (cached on first use). The mushaf's
  page fonts are not precached (98 MB): see Mushaf font pack. Updates
  wait for the user (`components/layout/UpdatePrompt.tsx`) and never reload by themselves. Any new data file
  over 8 MB needs `maximumFileSizeToCacheInBytes` raised.
- **Cross-origin isolation**: every response carries COOP `same-origin` + COEP `require-corp`
  (`vercel.json`, and `server`/`preview.headers` in `vite.config.ts`), needed for threaded WebAssembly. So
  nothing may be loaded from another origin unless it sends CORS or CORP headers — no CDN fonts or scripts.
- **Fonts** are bundled: `src/fonts.css` points at the `@fontsource` files with Google Fonts' unicode-ranges.
  Keep those ranges: without them Chrome shapes waqf marks after a space with the wrong subset.

## Pending work (agreed roadmap)

1. **Merged data pipeline**: combine `scripts/legacy-reader-build-data.ts`
   and `scripts/legacy-practice-export-data.ts` (and `scripts/build-mushaf-data.py`'s layout step) into one `scripts/build-data.ts`
   that re-ingests fresh QUL morphology phrases and emits every JSON artifact
   (kills the sibling-repo coupling both legacy scripts have). The legacy
   scripts reference `../memorization` and `../mutashabihat` paths and do NOT
   run from this repo — they are references only.
2. Practice: "Practice these" entry point from the reader side panel; keep
   slips across sessions and bring them back (spaced review); recite a question
   in the Reader with hidden words and voice Follow mode.
3. Browse → Reader deep links could pre-open the side panel on the phrase.
