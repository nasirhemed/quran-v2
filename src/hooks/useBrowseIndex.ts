import { useQuery } from "@tanstack/react-query";
import {
  fetchAyahHighlights,
  fetchMutashabihatDetails,
  fetchQuranPages,
  fetchSimilarAyahDetails,
} from "@/lib/data";
import { buildBrowseIndex } from "@/lib/browse";

/** The Browse tab's per-verse index, built once per session. */
export function useBrowseIndex() {
  return useQuery({
    queryKey: ["browse-index"],
    queryFn: async () => {
      const [pages, phrases, similar, highlights] = await Promise.all([
        fetchQuranPages(),
        fetchMutashabihatDetails(),
        fetchSimilarAyahDetails(),
        fetchAyahHighlights(),
      ]);
      return buildBrowseIndex(pages, phrases, similar, highlights);
    },
  });
}
