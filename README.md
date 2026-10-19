# Itqān · إتقان

A Qur'an study app for hifz, built around the **Mutashabihat** — the similar
verses that are easiest to confuse when reciting from memory.

**Live app:** https://quran-v2-nasirhemeds-projects.vercel.app

## The four tabs

- **Read** — the mushaf as printed: the King Fahd Complex's 1421H Madinah
  page fonts (QCF V2), every word on its printed line, as on quran.com.
  Similar phrases and similar verses are highlighted word by word; tap one to
  see everywhere else it appears. You can curate your own phrase groups
  (stored on your device, with export/import). The pages can be saved for
  offline reading from the Read home page.
- **Browse** — look up any surah or verse and see the phrases it shares with
  other verses and its similar verses. Search ignores harakat, so
  `وما ارسلنا` finds وَمَآ أَرۡسَلۡنَا.
- **Practice** — tested the way Qur'an competitions test: you get the
  opening words of a verse and recite on to the end of the next page.
  Questions start where verses have look-alikes elsewhere. Checking shows the
  passage with each look-alike beneath its verse and the words where they
  part marked. Pick a range by Juz or Surah and 3, 5 or 10 questions.
- **Memorize** — learn new verses by turns: the reciter recites a verse, you
  recite it back, as many times as you choose, verse by verse. With the
  speech model downloaded it knows when you have finished and shows the next
  words when you get stuck. Built to work hands-free in the car.

## Voice

Recitation is recognised on your device; your voice is never uploaded.
Download a speech model once from **Settings → Voice models** (it then works
offline). Recent Chrome on Android or desktop works best.

- **Follow mode** — in Read, recite and the page follows you, marking the
  word you just said and turning pages for you.
- **Hide words** — in Read, hide the page and recite from memory; words come
  back as Follow mode hears them, or when you tap one for a hint.

Mistake marking (verify mode) is still in progress.

## Offline

The app installs as a PWA and works offline. The mushaf page fonts (98 MB)
and speech models are optional downloads, kept on your device once fetched.

Light theme is a warm "paper mushaf"; dark theme is slate.

## Data

Static JSON in `public/data/`, generated from:

- [QUL morphology phrases](https://qul.tarteel.ai/morphology_phrases)
  (Tarteel) — the curated Mutashabihat phrase groups
- a scored similar-ayah matching database
- quran.com's verses API — the 1421H word-level page layout
- the King Fahd Complex's QCF V2 page fonts and the
  [QPC Hafs font](https://qul.tarteel.ai/resources/font/245)
- Tanzil surah/juz metadata
- [everyayah.com](https://everyayah.com) — reciter audio for Memorize

The merged data pipeline that regenerates all of this from fresh QUL exports
is in progress; see `scripts/` for the generators it replaces.

## Development

```bash
npm install
npm run dev      # Vite dev server
npm run check    # TypeScript
npm test         # Vitest
npm run build    # production build to dist/
```

React 18 + TypeScript + Vite, Tailwind, wouter, TanStack Query, ONNX Runtime
Web for the speech model. Pushes to `main` deploy automatically via Vercel.
See `CLAUDE.md` for architecture notes.

## Lineage

This app unifies three earlier projects:
[quran-reader](https://github.com/nasirhemed/quran-reader) (the mushaf),
[Quran-Practice](https://github.com/nasirhemed/Quran-Practice) (browsing
mutashabihat), and
[memorization](https://github.com/nasirhemed/memorization) (the quiz).
