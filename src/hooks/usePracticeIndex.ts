import { useQuery } from "@tanstack/react-query";
import { fetchMutashabihatDetails, fetchQuranPages, fetchSimilarAyahDetails } from "@/lib/data";
import { buildPracticeIndex } from "@/lib/practice";

/** The Practice tab's look-alike index, built once per session (a few hundred ms, after the data arrives). */
export function usePracticeIndex() {
  return useQuery({
    queryKey: ["practice-index"],
    queryFn: async () => {
      const [pages, phrases, similar] = await Promise.all([
        fetchQuranPages(),
        fetchMutashabihatDetails(),
        fetchSimilarAyahDetails(),
      ]);
      // Let the setup screen paint before the build takes the main thread.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return buildPracticeIndex(pages, phrases, similar);
    },
  });
}
