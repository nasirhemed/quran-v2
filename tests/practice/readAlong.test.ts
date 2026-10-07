import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPracticeIndex, type PracticeQuestion } from "@/lib/practice";
import { peekNext, readAlongProgress } from "@/lib/readAlong";

const read = (name: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/data", name), "utf-8"));
const index = buildPracticeIndex(read("quran-pages.json"), read("mutashabihat-details.json"), read("similar-ayah-details.json"));
const at = (key: string) => index.at.get(key)!;
const question: PracticeQuestion = { start: at("2:2"), end: at("2:4"), key: "2:2", promptWords: 5, traps: 0 };
const len = (key: string) => index.verses[at(key)].words.length;
const verseKeys = (key: string, upTo = len(key)) => Array.from({ length: upTo }, (_, i) => `${key}:${i + 1}`);

describe("readAlongProgress", () => {
  it("starts with the prompt recited and the start verse in progress", () => {
    const p = readAlongProgress(index, question, { keys: [] });
    expect(p.heard).toEqual([5, 0, 0]);
    expect(p.current).toBe(at("2:2"));
  });

  it("moves to the next verse once the last word is heard", () => {
    const p = readAlongProgress(index, question, { keys: [...verseKeys("2:2", len("2:2")), ...verseKeys("2:3", 3)] });
    expect(p.heard).toEqual([len("2:2"), 3, 0]);
    expect(p.current).toBe(at("2:3"));
  });

  it("takes the session's ayah end as the verse being recited, and ignores repeats and other verses", () => {
    const p = readAlongProgress(index, question, {
      keys: ["2:2:7", "2:2:6", "9:9:1", "2:2:7"],
      ayahEnds: ["2:2", "1:1"],
    });
    expect(p.heard[0]).toBe(len("2:2"));
    expect(p.current).toBe(at("2:3"));
  });

  it("finishes when the last verse is recited", () => {
    const p = readAlongProgress(index, question, { keys: [...verseKeys("2:3"), ...verseKeys("2:4")], ayahEnds: ["2:2"] });
    expect(p.current).toBeNull();
  });

  it("shows nothing of a verse before the one in progress is done", () => {
    const p = readAlongProgress(index, question, { keys: verseKeys("2:3", 4) });
    expect(p.heard).toEqual([5, 0, 0]);
  });
});

describe("peekNext", () => {
  it("adds one word per press, from the words heard, up to the verse's end", () => {
    expect(peekNext(5, 0, 9)).toBe(6);
    expect(peekNext(5, 6, 9)).toBe(7);
    expect(peekNext(8, 9, 9)).toBe(9);
    expect(peekNext(7, 5, 9)).toBe(8);
  });
});
