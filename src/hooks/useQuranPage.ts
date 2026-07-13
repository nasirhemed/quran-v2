import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchQuranPages, fetchAyahHighlights } from "@/lib/data";
import { computePageHighlights, mergeHighlights } from "@/lib/highlights";
import type { QuranPage, PageHighlightMap, AyahHighlights } from "@/types";

export function useQuranPage(pageNumber: number, localHighlights?: AyahHighlights) {
  const {
    data: pages,
    isLoading: pagesLoading,
    error: pagesError,
  } = useQuery({
    queryKey: ["quran-pages"],
    queryFn: fetchQuranPages,
  });

  const {
    data: highlights,
    isLoading: highlightsLoading,
  } = useQuery({
    queryKey: ["ayah-highlights"],
    queryFn: fetchAyahHighlights,
  });

  const page: QuranPage | undefined = useMemo(() => {
    if (!pages) return undefined;
    return pages.find((p) => p.pageNumber === pageNumber);
  }, [pages, pageNumber]);

  const pageHighlights: PageHighlightMap = useMemo(() => {
    if (!page || !highlights) return {};
    const merged = localHighlights
      ? mergeHighlights(highlights, localHighlights)
      : highlights;
    return computePageHighlights(page, merged);
  }, [page, highlights, localHighlights]);

  return {
    page,
    pageHighlights,
    isLoading: pagesLoading || highlightsLoading,
    error: pagesError,
  };
}
