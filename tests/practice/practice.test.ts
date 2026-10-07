import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPracticeIndex,
  compareVerses,
  foldWord,
  generateQuestions,
  promptLength,
  PROMPT_WORDS,
  SHOW_STRENGTH,
  type PracticeRange,
} from "@/lib/practice";

const read = (name: string) =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/data", name), "utf-8"));
const index = buildPracticeIndex(
  read("quran-pages.json"),
  read("mutashabihat-details.json"),
  read("similar-ayah-details.json")
);
const at = (key: string) => index.at.get(key)!;
const words = (key: string) => index.verses[at(key)].words;
const strength = (a: string, b: string) => index.lookAlikes[at(a)].find((l) => l.other === at(b))?.strength ?? 0;
const pageTrap = (page: number) => index.verses.reduce((sum, v, i) => sum + (v.page === page ? index.trap[i] : 0), 0);
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const WHOLE: PracticeRange = { type: "juz", from: 1, to: 30 };

describe("foldWord", () => {
  it("merges spellings that sound the same, and nothing that sounds different", () => {
    expect(foldWord(words("3:182")[7])).toBe(foldWord(words("8:51")[7])); // بِظَلَّامٍ / بِظَلَّٰمٍ
    expect(foldWord(words("2:231")[26])).toBe(foldWord(words("5:20")[6])); // نِعْمَتَ / نِعْمَةَ
    expect(foldWord("بِمَعْرُوفٍۢ ۚ")).toBe(foldWord("بِمَعْرُوفٍ"));
    expect(foldWord("إِنَّ")).not.toBe(foldWord("أَنَّ"));
    expect(foldWord("قَالَ")).not.toBe(foldWord("قُلْ"));
  });
});

describe("look-alikes", () => {
  it("rates verses hafiz confuse as strong", () => {
    for (const [a, b] of [
      ["2:58", "7:161"],
      ["2:35", "7:19"],
      ["2:27", "13:25"],
      ["2:62", "5:69"],
      ["8:52", "8:54"],
      ["15:28", "38:71"],
      ["45:25", "46:7"],
    ]) {
      expect(strength(a, b), `${a} ~ ${b}`).toBeGreaterThanOrEqual(0.7);
      expect(strength(b, a)).toBe(strength(a, b));
    }
  });

  it("finds look-alikes the QUL data misses", () => {
    // ٱمۡكُثُوٓاْ إِنِّيٓ ءَانَسۡتُ نَارٗا لَّعَلِّيٓ ءَاتِيكُم مِّنۡهَا: 20:10 has no entry in the data.
    expect(strength("20:10", "28:29")).toBeGreaterThan(0.9);
  });

  it("rates stock phrases and refrains weak", () => {
    expect(strength("1:2", "6:45")).toBeLessThan(SHOW_STRENGTH); // ٱلۡحَمۡدُ لِلَّهِ رَبِّ ٱلۡعَٰلَمِينَ
    expect(strength("55:13", "55:16")).toBeLessThan(SHOW_STRENGTH); // فَبِأَيِّ ءَالَآءِ رَبِّكُمَا تُكَذِّبَانِ
  });

  it("rates verses that open alike, then part, as look-alikes", () => {
    // قَالَ ٱلَّذِينَ ٱسۡتَكۡبَرُوٓاْ and وَمَا ظَلَمۡنَٰهُمۡ: little else in common
    for (const [a, b] of [["34:32", "7:76"], ["34:32", "40:48"], ["43:76", "11:101"]]) {
      expect(strength(a, b), `${a} ~ ${b}`).toBeGreaterThanOrEqual(SHOW_STRENGTH);
    }
    // but not an opening dozens of verses share: إِنَّ ٱلَّذِينَ
    expect(strength("2:6", "2:62")).toBeLessThan(SHOW_STRENGTH);
  });

  it("rates openings with the same words in another order as look-alikes", () => {
    expect(strength("28:20", "36:20")).toBeGreaterThanOrEqual(0.6); // رَجُلٞ مِّنۡ أَقۡصَا / مِنۡ أَقۡصَا … رَجُلٞ
    expect(strength("30:47", "40:78")).toBeGreaterThanOrEqual(SHOW_STRENGTH); // مِن قَبۡلِكَ رُسُلًا / رُسُلٗا مِّن قَبۡلِكَ
  });

  it("flags where a run of identical verses ends and the stories part", () => {
    // Ash-Shu'ara: Nuh's and Hud's stories share four verses, then go on differently.
    expect(strength("26:109", "26:127")).toBeGreaterThanOrEqual(0.8);
    expect(strength("26:108", "26:126")).toBeLessThan(SHOW_STRENGTH);
  });

  it("ranks the pages hafiz find hard above the ones they don't", () => {
    // The prophets' stories in Al-A'raf and Ash-Shu'ara, against Yusuf's story and the end of Juz 30.
    for (const hard of [158, 164, 374]) for (const easy of [239, 241, 595, 604]) expect(pageTrap(hard)).toBeGreaterThan(2 * pageTrap(easy));
  });
});

describe("compareVerses", () => {
  it("marks the words where look-alikes part", () => {
    const c = compareVerses(index, at("2:58"), at("7:161"));
    const diff = (key: string, marks: typeof c.a) => words(key).filter((_, k) => marks[k] === "diff").map(foldWord);
    expect(diff("2:58", c.a)).toEqual(["قلنا", "ادخلوا", "فكلوا", "رغدا", "وقولوا", "حطت", "خطاياكم", "وسنزيد"]);
    expect(diff("7:161", c.b)).toEqual(["قيل", "لهم", "اسكنوا", "وكلوا", "وقولوا", "حطت", "خطياتكم", "سنزيد"]);
  });

  it("leaves words outside the shared stretch unmarked", () => {
    // 61:5 and 2:54 share their opening, وَإِذۡ قَالَ مُوسَىٰ لِقَوۡمِهِۦ يَٰقَوۡمِ, then part.
    const c = compareVerses(index, at("61:5"), at("2:54"));
    expect(c.a.slice(0, 6)).toEqual(["same", "same", "same", "same", "same", "diff"]);
    expect(c.a.slice(6).every((m) => m === undefined)).toBe(true);
  });
});

describe("promptLength", () => {
  it("stops where the verse parts from a look-alike that opens the same way", () => {
    expect(promptLength(index, at("43:76"))).toBe(3); // وَمَا ظَلَمۡنَٰهُمۡ وَلَٰكِن, as 11:101
    // 7:65 and 11:50 share thirteen words, up to غَيۡرُهُۥٓ; then أَفَلَا تَتَّقُونَ / إِنۡ أَنتُمۡ إِلَّا مُفۡتَرُونَ
    const n = promptLength(index, at("7:65"))!;
    expect(n).toBe(13);
    expect(foldWord(words("7:65")[n - 1])).toBe(foldWord(words("11:50")[n - 1]));
    expect(foldWord(words("7:65")[n])).not.toBe(foldWord(words("11:50")[n]));
  });

  it("otherwise shows five words, or more where the surah has another verse opening the same way", () => {
    expect(promptLength(index, at("2:58"))).toBe(PROMPT_WORDS);
    expect(promptLength(index, at("112:1"))).toBe(4); // the whole verse
  });

  it("gives up on a verse its surah repeats word for word", () => {
    expect(promptLength(index, at("55:13"))).toBeNull();
    expect(promptLength(index, at("26:108"))).toBeNull();
  });
});

describe("generateQuestions", () => {
  it("starts on a verse with a look-alike and runs to the end of the next page", () => {
    const questions = generateQuestions(index, WHOLE, 10, seeded(1));
    expect(questions).toHaveLength(10);
    for (const q of questions) {
      const start = index.verses[q.start];
      const end = index.verses[q.end];
      expect(index.trap[q.start]).toBeGreaterThanOrEqual(0.4);
      expect(end.page).toBe(start.page + 1);
      expect(index.verses[q.end + 1]?.page).not.toBe(end.page);
      expect(q.promptWords).toBe(promptLength(index, q.start));
    }
  });

  it("never asks about the same page twice", () => {
    const pages = generateQuestions(index, WHOLE, 10, seeded(2)).flatMap((q) => [
      index.verses[q.start].page,
      index.verses[q.end].page,
    ]);
    expect(new Set(pages).size).toBe(pages.length);
  });

  it("keeps the passage inside the range", () => {
    for (const q of generateQuestions(index, { type: "surah", from: 2, to: 2 }, 5, seeded(3))) {
      for (let i = q.start; i <= q.end; i++) expect(index.verses[i].surah).toBe(2);
    }
    const last = generateQuestions(index, { type: "surah", from: 112, to: 114 }, 5, seeded(4));
    expect(last).toHaveLength(1); // one page, one passage
  });

  it("varies with the random source, and only with it", () => {
    const keys = (seed: number) => generateQuestions(index, WHOLE, 5, seeded(seed)).map((q) => q.key);
    expect(keys(5)).toEqual(keys(5));
    expect(keys(5)).not.toEqual(keys(6));
  });
});

describe("against a teacher's question bank", () => {
  // 95 recitation questions a teacher set on the mutashabihat of 20 juz, with the look-alikes her notes warn
  // about (tests/fixtures/practice). When written: 72% of the start verses were traps (47% of all verses),
  // their median trap percentile 75, and 73% of the named look-alikes shown. Most of the rest are questions on
  // a unique wording (ضَرَبَ لَكُم مَّثَلٗا where elsewhere it is ضَرَبَ ٱللَّهُ مَثَلٗا) or a one-word variant
  // (وَلَهُۥ مَن فِي / وَلَهُۥ مَا فِي), which matching words can't see.
  const bank: { questions: { key: string; twins?: string[] }[] } = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../fixtures/practice/sard-questions.json"), "utf-8")
  );
  const starts = bank.questions.map((q) => at(q.key));
  const twins = bank.questions.flatMap((q) => (q.twins ?? []).map((t) => [q.key, t]));
  const isTrap = (i: number) => index.trap[i] >= SHOW_STRENGTH;

  it("finds most of its start verses confusable, well above chance", () => {
    const hit = starts.filter(isTrap).length / starts.length;
    const base = index.verses.filter((_, i) => isTrap(i)).length / index.verses.length;
    expect(hit).toBeGreaterThanOrEqual(0.68);
    expect(hit / base).toBeGreaterThanOrEqual(1.4);
    const percentile = (i: number) => index.trap.filter((t) => t < index.trap[i]).length / index.trap.length;
    const median = starts.map(percentile).sort((a, b) => a - b)[Math.floor(starts.length / 2)];
    expect(median).toBeGreaterThanOrEqual(0.72);
  });

  it("shows most of the look-alikes the teacher warns about", () => {
    const shown = twins.filter(([a, b]) => strength(a, b) >= SHOW_STRENGTH).length / twins.length;
    expect(shown).toBeGreaterThanOrEqual(0.68);
  });
});
