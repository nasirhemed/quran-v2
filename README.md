# Itqān · إتقان

A unified Qur'an study app for hifz review, built around the **Mutashabihat**
— the similar verses that are easiest to confuse when reciting from memory.

**Live app:** https://quran-v2-nasirhemeds-projects.vercel.app

## The three tabs

- **Read** — a mushaf reader with the printed madani page layout (justified
  15-line pages). Similar phrases and similar verses are highlighted at the
  word level; tapping a highlight opens a panel showing everywhere else that
  phrase appears. An edit mode lets you curate your own phrase groups
  (stored locally, with export/import).
- **Browse** — every similar phrase and similar verse, grouped by Juz and
  Surah. Same-surah repeats (refrains) are hidden by default; Similar Ayah
  cards expand in place to show each look-alike with its match score and the
  matched words highlighted.
- **Practice** — tested the way Qur'an competitions test: you get the
  opening words of a verse and recite on to the end of the next page.
  Questions start where verses have look-alikes elsewhere, on the pages where
  look-alikes crowd together (the prophets' stories in Al-A'raf and
  Ash-Shu'ara rank hardest, Surah Yusuf and Juz 30 easiest). Checking shows
  the passage with each look-alike beneath its verse and the words where they
  part marked. Pick a range by Juz or Surah and 3, 5 or 10 questions.

Light theme is a warm "paper mushaf"; dark theme is slate. One token set
drives both.

## Data

Static JSON in `public/data/`, generated from:

- [QUL morphology phrases](https://qul.tarteel.ai/morphology_phrases)
  (Tarteel) — the curated Mutashabihat phrase groups
- a scored similar-ayah matching database
- the [quran.com API](https://api.quran.com) — word-level page layout
  (QPC Hafs, 15-line madani)
- Tanzil surah/juz metadata

The merged data pipeline that regenerates all of this from fresh QUL exports
is in progress; see `scripts/` for the legacy generators it replaces.

## Development

```bash
npm install
npm run dev      # Vite dev server
npm run check    # TypeScript
npm run build    # production build to dist/
```

React 18 + TypeScript + Vite, Tailwind, wouter, TanStack Query. Pushes to
`main` deploy automatically via Vercel.

## Lineage

This app unifies three earlier projects:
[quran-reader](https://github.com/nasirhemed/quran-reader) (the mushaf),
[Quran-Practice](https://github.com/nasirhemed/Quran-Practice) (browsing
mutashabihat), and
[memorization](https://github.com/nasirhemed/memorization) (the quiz).
