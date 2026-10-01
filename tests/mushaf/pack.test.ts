import { describe, expect, it } from "vitest";
import { SURAH_WORD_LIGATURE, surahNameLigature } from "@/lib/mushaf/pack";

describe("surah header ligatures", () => {
  it("names each surah by three digits, and the word سورة by its own ligature", () => {
    expect(surahNameLigature(1)).toBe("001");
    expect(surahNameLigature(38)).toBe("038");
    expect(surahNameLigature(114)).toBe("114");
    expect(SURAH_WORD_LIGATURE).toBe("surah");
  });
});
