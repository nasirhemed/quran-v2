/**
 * Model A's words → the consonant skeleton the tracker matches on (engine/heardText.ts), and Follow mode on it.
 * Verse texts are imlaei with harakat, as model A writes them.
 */
import { describe, expect, it } from "vitest";
import { wordIndex } from "@/recitation/engine/data";
import { ratio } from "@/recitation/engine/fuzzy";
import { HeardText, textSkeleton } from "@/recitation/engine/heardText";
import { FollowSession, type EngineEvent } from "@/recitation/engine/session";
import { quran } from "./helpers";

const TEXT: Record<string, string> = {
  "1:1": "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ",
  "1:2": "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ",
  "1:3": "الرَّحْمَنِ الرَّحِيمِ",
  "1:4": "مَالِكِ يَوْمِ الدِّينِ",
  "1:5": "إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ",
  "1:6": "اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ",
  "1:7": "صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ",
  "67:1": "تَبَارَكَ الَّذِي بِيَدِهِ الْمُلْكُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ",
  "67:2": "الَّذِي خَلَقَ الْمَوْتَ وَالْحَيَاةَ لِيَبْلُوَكُمْ أَيُّكُمْ أَحْسَنُ عَمَلًا وَهُوَ الْعَزِيزُ الْغَفُورُ",
  "67:3": "الَّذِي خَلَقَ سَبْعَ سَمَاوَاتٍ طِبَاقًا مَا تَرَى فِي خَلْقِ الرَّحْمَنِ مِنْ تَفَاوُتٍ فَارْجِعِ الْبَصَرَ هَلْ تَرَى مِنْ فُطُورٍ",
  "67:4": "ثُمَّ ارْجِعِ الْبَصَرَ كَرَّتَيْنِ يَنقَلِبْ إِلَيْكَ الْبَصَرُ خَاسِئًا وَهُوَ حَسِيرٌ",
  "67:5": "وَلَقَدْ زَيَّنَّا السَّمَاءَ الدُّنْيَا بِمَصَابِيحَ وَجَعَلْنَاهَا رُجُومًا لِلشَّيَاطِينِ وَأَعْتَدْنَا لَهُمْ عَذَابَ السَّعِيرِ",
  "112:1": "قُلْ هُوَ اللَّهُ أَحَدٌ",
  "112:2": "اللَّهُ الصَّمَدُ",
  "112:3": "لَمْ يَلِدْ وَلَمْ يُولَدْ",
  "112:4": "وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ",
};

/** Each word as two pieces, the first starting with a space: the way model A emits sub-word pieces. */
function pieces(text: string): string[] {
  return text.split(" ").flatMap((w, i) => {
    const cut = Math.ceil(w.length / 2);
    return [" " + w.slice(0, cut), w.slice(cut)];
  });
}

describe("text skeleton", () => {
  it("matches the verse's own skeleton (from its phonemes)", () => {
    const { words, ref } = quran();
    for (const [key, text] of Object.entries(TEXT)) {
      const [first, n] = words.ayat[key];
      const want = ref.window(first, first + n - 1).text;
      // (a verse's own skeleton opens with the hamza of a recitation's first word: الرحمن is ءرحمن at 1:3)
      expect(ratio(textSkeleton(text), want), key).toBeGreaterThanOrEqual(90);
    }
  });

  it("reads the article, long vowels, tanween, noon and ta marbuta as recited", () => {
    expect(textSkeleton("الرَّحْمَنِ")).toBe("رحمن"); // sun letter: no lam
    expect(textSkeleton("الْحَمْدُ")).toBe("لحمد"); // moon letter: lam kept
    expect(textSkeleton("يَقُولُونَ")).toBe("يقلن"); // long vowels dropped, consonant waw kept elsewhere
    expect(textSkeleton("يَوْمِ")).toBe("يوم");
    expect(textSkeleton("شَيْءٍ قَدِيرٌ")).toBe("شيءنقدر"); // tanween → nun, dropped at the stop
    expect(textSkeleton("عَمَلًا وَهُوَ")).toBe("عملوهو"); // idgham into waw
    expect(textSkeleton("مِنْ بَعْدِ")).toBe("مبعد"); // iqlab
    expect(textSkeleton("الْحَاقَّةُ")).toBe("لحقه"); // ta marbuta at a stop
    expect(textSkeleton("حَامِيَةً")).toBe("حميت"); // …but read تَا with fathatan
    expect(textSkeleton("الم")).toBe("ءلفلم"); // disjoined letters, spelled out
    expect(textSkeleton("طسم")).toBe("طسم");
  });

  it("streams: a word is released when the next starts, or at a pause", () => {
    const h = new HeardText();
    expect(h.push([" بِسْ", "مِ", " اللَّ"])).toBe("بسم");
    expect(h.push(["هِ"])).toBe("");
    expect(h.push([])).toBe("له"); // a step with nothing new: the held word ends at a stop
    const whole = Object.values(TEXT).join(" ");
    const s = new HeardText();
    const parts = pieces(whole);
    let out = "";
    for (let i = 0; i < parts.length; i += 3) out += s.push(parts.slice(i, i + 3));
    out += s.push([]);
    expect(out.replace(/(.)\1+/gu, "$1")).toBe(textSkeleton(whole));
  });
});

describe("follow session on model A's words", () => {
  function session() {
    const { words, ref } = quran();
    const symbols: string[] = [];
    const ids = new Map<string, number>();
    const id = (p: string) => ids.get(p) ?? (ids.set(p, symbols.length), symbols.push(p), symbols.length - 1);
    return { words, s: new FollowSession(ref, words, symbols, "bpe"), id, key: wordIndex(words).key };
  }

  it("finds Al-Mulk and follows it word by word", () => {
    const { s, id, key } = session();
    const events: EngineEvent[] = [];
    let step = 0;
    for (const a of ["67:1", "67:2", "67:3", "67:4", "67:5"]) {
      const p = pieces(TEXT[a]);
      for (let i = 0; i < p.length; i += 4) events.push(...s.push(p.slice(i, i + 4).map(id), step, ++step * 1.12));
      events.push(...s.push([], step, ++step * 1.12)); // a breath between verses
    }
    const heard = events.flatMap((e) => (e.type === "heard" ? e.words.map((w) => key[w.idx]) : []));
    expect(heard[0]).toBe("67:1:1");
    expect(heard.every((k) => k.startsWith("67:"))).toBe(true);
    expect(new Set(heard).size).toBe(60); // every word of 67:1–5, once
    expect(heard.length).toBe(60);
    expect(events.filter((e) => e.type === "ayahComplete").map((e) => (e as { ayah: string }).ayah)).toEqual(["67:1", "67:2", "67:3", "67:4", "67:5"]);
    expect(events.some((e) => e.type === "lost")).toBe(false);
  });

  it("expect(): completes a verse at its last word, not before", () => {
    for (const a of ["112:1", "1:1", "1:7"]) {
      const { s, id, words } = session();
      s.expect(words.ayat[a][0]);
      const p = pieces(TEXT[a]);
      const lastWord = p.length - 2;
      let done = -1;
      for (let i = 0; i < p.length; i += 2) {
        if (s.push(p.slice(i, i + 2).map(id), i, i).some((e) => e.type === "ayahComplete" && e.ayah === a)) done = i;
      }
      if (done < 0 && s.push([], p.length, p.length).some((e) => e.type === "ayahComplete" && e.ayah === a)) done = p.length;
      expect(done, a).toBeGreaterThanOrEqual(lastWord);
    }
  });
});
