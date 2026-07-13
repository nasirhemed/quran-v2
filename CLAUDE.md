# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Itqān (quran-v2) unifies three previously separate apps into one Qur'an study
app with three tabs sharing one shell, one theme, and one data folder:

- **Read** (`/`, `/read`) — mushaf reader with word-level Mutashabihat
  highlighting, ported from `nasirhemed/quran-reader`.
- **Browse** (`/browse`) — similar phrases & similar verses grouped by
  Juz/Surah, rebuilt from `nasirhemed/Quran-Practice`.
- **Practice** (`/practice`) — recall quiz rebuilt from
  `nasirhemed/memorization`, now driven by the curated Mutashabihat data
  instead of the old first-3-words prefix heuristic.

## Commands

```bash
npm run dev      # Vite dev server
npm run build    # tsc -b && vite build
npm run check    # TypeScript type checking
npm run preview  # Preview production build
```

No test framework is configured yet.

## Architecture

- **Stack**: React 18 + TypeScript + Vite, Tailwind 3, wouter (routing),
  TanStack Query (staleTime Infinity — static data never refetches).
- **Data** (`public/data/`): static JSON, currently copied from the source
  repos' generated outputs. `quran-pages.json` (604 pages, word-level, from
  the quran.com API), `surahs.json`, `juz-metadata.json`,
  `ayah-highlights.json`, `mutashabihat-{list,details}.json`,
  `similar-ayah-{list,details}.json`, `phrase-verses.json`. Original source:
  QUL morphology phrases (https://qul.tarteel.ai/morphology_phrases).
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
- **Practice engine**: `src/lib/practice.ts` — builds an ayah index from
  quran-pages.json, generates questions from `mutashabihat-details.json` with
  quality gates (`skipSameSurah` drops groups with `surahCount < 2`).

## Pending work (agreed roadmap)

1. **Merged data pipeline**: combine `scripts/legacy-reader-build-data.ts`
   and `scripts/legacy-practice-export-data.ts` into one `scripts/build-data.ts`
   that re-ingests fresh QUL morphology phrases and emits every JSON artifact
   (kills the sibling-repo coupling both legacy scripts have). The legacy
   scripts reference `../memorization` and `../mutashabihat` paths and do NOT
   run from this repo — they are references only.
2. Practice: "Practice these" entry point from the reader side panel;
   min-similarity-score gate using similar-ayah data; diff-marked twins
   (word ranges exist in mutashabihat-details.json).
3. Browse → Reader deep links could pre-open the side panel on the phrase.
