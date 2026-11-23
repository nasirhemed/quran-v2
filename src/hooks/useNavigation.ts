import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { fetchSurahs, fetchJuzMetadata } from "@/lib/data";
import { pageIndex } from "@/lib/mushaf/layouts";
import { nextSpreadPage, prevSpreadPage } from "@/lib/mushaf/spread";
import type { SurahMeta, JuzMeta, QuranPage } from "@/types";

/**
 * The reader's place, from its URL. `pages` are the chosen print's (useMushafPages): start pages depend on it.
 * With `spread` (two facing pages shown), next and previous step a whole spread.
 */
export function useNavigation(pages: QuranPage[] | undefined, spread = false) {
  const search = useSearch();
  const [, setLocation] = useLocation();

  const { data: surahs } = useQuery({
    queryKey: ["surahs"],
    queryFn: fetchSurahs,
  });

  const { data: juzs } = useQuery({
    queryKey: ["juz-metadata"],
    queryFn: fetchJuzMetadata,
  });

  const index = useMemo(() => (pages ? pageIndex(pages) : null), [pages]);

  // Parse URL params
  const params = useMemo(() => {
    const sp = new URLSearchParams(search);
    return {
      page: sp.get("page") ? Number(sp.get("page")) : null,
      surah: sp.get("surah") ? Number(sp.get("surah")) : null,
      ayah: sp.get("ayah") ? Number(sp.get("ayah")) : null,
      juz: sp.get("juz") ? Number(sp.get("juz")) : null,
    };
  }, [search]);

  // Resolve to page number
  const resolvedPage = useMemo(() => {
    if (!surahs || !juzs || !index) return 1;

    // Priority: surah+ayah > surah > juz > page
    if (params.surah) {
      const surah = surahs.find((s) => s.index === params.surah);
      if (surah) {
        if (params.ayah) {
          const target = index.ayahPage.get(`${params.surah}:${params.ayah}`);
          if (target) return target;
        }
        return index.surahPage.get(surah.index) ?? surah.startPage;
      }
    }

    if (params.juz) {
      const juz = juzs.find((j) => j.index === params.juz);
      if (juz) return index.ayahPage.get(`${juz.sura}:${juz.aya}`) ?? juz.startPage;
    }

    if (params.page) {
      return Math.max(1, Math.min(604, params.page));
    }

    return 1;
  }, [params, surahs, juzs, index]);

  // Active ayah (for highlighting when navigated via surah+ayah)
  const activeAyah = useMemo(() => {
    if (params.surah && params.ayah) {
      return { surah: params.surah, ayah: params.ayah };
    }
    return null;
  }, [params.surah, params.ayah]);

  const navigateToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(604, page));
      setLocation(`/read?page=${clamped}`);
    },
    [setLocation]
  );

  const navigateToSurah = useCallback(
    (surahIndex: number) => {
      setLocation(`/read?surah=${surahIndex}`);
    },
    [setLocation]
  );

  const navigateToJuz = useCallback(
    (juzIndex: number) => {
      setLocation(`/read?juz=${juzIndex}`);
    },
    [setLocation]
  );

  const navigateToAyah = useCallback(
    (surah: number, ayah: number) => {
      setLocation(`/read?surah=${surah}&ayah=${ayah}`);
    },
    [setLocation]
  );

  const pageCount = pages?.length || 604;
  const nextPage = useCallback(() => {
    const to = spread ? nextSpreadPage(resolvedPage, pageCount) : resolvedPage + 1;
    if (to !== null && to <= pageCount) navigateToPage(to);
  }, [resolvedPage, navigateToPage, spread, pageCount]);

  const prevPage = useCallback(() => {
    const to = spread ? prevSpreadPage(resolvedPage, pageCount) : resolvedPage - 1;
    if (to !== null && to >= 1) navigateToPage(to);
  }, [resolvedPage, navigateToPage, spread, pageCount]);

  const navigateToHome = useCallback(() => {
    setLocation("/");
  }, [setLocation]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      if (e.key === "ArrowLeft") {
        nextPage();
      } else if (e.key === "ArrowRight") {
        prevPage();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nextPage, prevPage]);

  // Surah and juz lists with this print's start pages.
  const printSurahs = useMemo(
    () => (surahs ?? []).map((s) => ({ ...s, startPage: index?.surahPage.get(s.index) ?? s.startPage })),
    [surahs, index]
  );
  const printJuzs = useMemo(
    () => (juzs ?? []).map((j) => ({ ...j, startPage: index?.ayahPage.get(`${j.sura}:${j.aya}`) ?? j.startPage })),
    [juzs, index]
  );

  return {
    currentPage: resolvedPage,
    activeAyah,
    surahs: printSurahs,
    juzs: printJuzs,
    navigateToPage,
    navigateToSurah,
    navigateToJuz,
    navigateToAyah,
    navigateToHome,
    nextPage,
    prevPage,
  };
}
