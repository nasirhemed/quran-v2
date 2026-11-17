import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchAyahHighlights } from "@/lib/data";
import { computePageHighlights, mergeHighlights } from "@/lib/highlights";
import type { QuranPage, PageHighlightMap, AyahHighlights } from "@/types";

/** One page of the chosen print (`pages` from useMushafPages) with its highlights. */
export function useQuranPage(pages: QuranPage[] | undefined, pageNumber: number, localHighlights?: AyahHighlights) {
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
    isLoading: !pages || highlightsLoading,
  };
}
