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
- **Practice** — a recall quiz driven by the curated similarity data.
  Modes: walk a whole confusable group back to back, one-verse-per-group
  with twins revealed together, or random verses. Range by Juz or Surah,
  selectable data sources, and quality gates to skip refrain noise.

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
