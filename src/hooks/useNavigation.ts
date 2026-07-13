import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { fetchSurahs, fetchJuzMetadata, fetchQuranPages } from "@/lib/data";
import type { SurahMeta, JuzMeta } from "@/types";

export function useNavigation() {
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

  const { data: pages } = useQuery({
    queryKey: ["quran-pages"],
    queryFn: fetchQuranPages,
  });

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
    if (!surahs || !juzs || !pages) return 1;

    // Priority: surah+ayah > surah > juz > page
    if (params.surah) {
      const surah = surahs.find((s) => s.index === params.surah);
      if (surah) {
        if (params.ayah) {
          // Find the page containing this specific ayah
          const targetPage = pages.find((p) =>
            p.surahGroups.some(
              (g) =>
                g.surahIndex === params.surah &&
                g.ayahs.some((a) => a.surah === params.surah && a.ayah === params.ayah)
            )
          );
          if (targetPage) return targetPage.pageNumber;
        }
        return surah.startPage;
      }
    }

    if (params.juz) {
      const juz = juzs.find((j) => j.index === params.juz);
      if (juz) return juz.startPage;
    }

    if (params.page) {
      return Math.max(1, Math.min(604, params.page));
    }

    return 1;
  }, [params, surahs, juzs, pages]);

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

  const nextPage = useCallback(() => {
    navigateToPage(resolvedPage + 1);
  }, [resolvedPage, navigateToPage]);

  const prevPage = useCallback(() => {
    navigateToPage(resolvedPage - 1);
  }, [resolvedPage, navigateToPage]);

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

  return {
    currentPage: resolvedPage,
    activeAyah,
    surahs: surahs ?? [],
    juzs: juzs ?? [],
    navigateToPage,
    navigateToSurah,
    navigateToJuz,
    navigateToAyah,
    navigateToHome,
    nextPage,
    prevPage,
  };
}
