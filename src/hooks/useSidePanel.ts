import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMutashabihatDetails, fetchSimilarAyahDetails } from "@/lib/data";
import type { SidePanelContent, MutashabihatPhrase, SimilarAyahEntry, LocalPhrase } from "@/types";

export function useSidePanel(localPhrases?: LocalPhrase[]) {
  const [content, setContent] = useState<SidePanelContent>(null);

  const { data: mutashabihatDetails } = useQuery({
    queryKey: ["mutashabihat-details"],
    queryFn: fetchMutashabihatDetails,
  });

  const { data: similarAyahDetails } = useQuery({
    queryKey: ["similar-ayah-details"],
    queryFn: fetchSimilarAyahDetails,
  });

  const isOpen = content !== null;

  const openPhrase = useCallback((phraseId: string) => {
    setContent({ type: "phrase", phraseId });
  }, []);

  const openSimilar = useCallback((ayahKey: string) => {
    setContent({ type: "similar", ayahKey });
  }, []);

  const openLocalPhrase = useCallback((phraseId: string) => {
    setContent({ type: "local-phrase", phraseId });
  }, []);

  const close = useCallback(() => {
    setContent(null);
  }, []);

  const currentPhrase: MutashabihatPhrase | null =
    content?.type === "phrase" && mutashabihatDetails
      ? mutashabihatDetails[content.phraseId] ?? null
      : null;

  const currentSimilar: SimilarAyahEntry | null =
    content?.type === "similar" && similarAyahDetails
      ? similarAyahDetails[content.ayahKey] ?? null
      : null;

  const currentLocalPhrase: LocalPhrase | null =
    content?.type === "local-phrase" && localPhrases
      ? localPhrases.find((p) => p.id === content.phraseId) ?? null
      : null;

  return {
    isOpen,
    content,
    currentPhrase,
    currentSimilar,
    currentLocalPhrase,
    openPhrase,
    openSimilar,
    openLocalPhrase,
    close,
  };
}
