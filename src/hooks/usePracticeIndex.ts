import { useQuery } from "@tanstack/react-query";
import { fetchMushafPages, fetchMutashabihatDetails, fetchQuranPages, fetchSimilarAyahDetails } from "@/lib/data";
import { buildPracticeIndex } from "@/lib/practice";
import { useMushafLayout } from "@/hooks/useMushafLayout";

/**
 * The Practice tab's look-alike index, built once per session and print (a few hundred ms, after the data
 * arrives). Passages run to the end of the next page of the print chosen in Settings.
 */
export function usePracticeIndex() {
  const layout = useMushafLayout();
  return useQuery({
    queryKey: ["practice-index", layout.id],
    queryFn: async () => {
      const [pages, phrases, similar] = await Promise.all([
        // the chosen print's pages; the 1421H ones if its layout file can't be had
        fetchMushafPages(layout.id).then((m) => m.pages, fetchQuranPages),
        fetchMutashabihatDetails(),
        fetchSimilarAyahDetails(),
      ]);
      // Let the setup screen paint before the build takes the main thread.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return buildPracticeIndex(pages, phrases, similar);
    },
  });
}
