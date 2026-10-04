import { describe, expect, it } from "vitest";
import { gateOptions, nextStep, RECITERS, skipVerse, TurnGate, verseAudioUrl, versesInRange, type GateOptions, type Step } from "@/lab/memorize";

const AYAS = [7, 286, 200]; // the first three surahs are enough here

describe("versesInRange", () => {
  it("lists a range inside one surah", () => {
    expect(versesInRange(AYAS, { s: 1, a: 5 }, { s: 1, a: 7 })).toEqual([
      { s: 1, a: 5 },
      { s: 1, a: 6 },
      { s: 1, a: 7 },
    ]);
  });
  it("crosses surahs", () => {
    const v = versesInRange(AYAS, { s: 1, a: 7 }, { s: 3, a: 1 });
    expect(v.length).toBe(1 + 286 + 1);
    expect(v[1]).toEqual({ s: 2, a: 1 });
    expect(v[v.length - 1]).toEqual({ s: 3, a: 1 });
  });
  it("is empty when backwards or out of bounds", () => {
    expect(versesInRange(AYAS, { s: 2, a: 5 }, { s: 2, a: 4 })).toEqual([]);
    expect(versesInRange(AYAS, { s: 1, a: 8 }, { s: 2, a: 1 })).toEqual([]);
    expect(versesInRange(AYAS, { s: 4, a: 1 }, { s: 4, a: 2 })).toEqual([]);
  });
});

describe("turn order", () => {
  it("goes reciter → you, N times, then the next verse, then ends", () => {
    const seen: string[] = [];
    let s: Step | null = { verse: 0, rep: 1, turn: "reciter" };
    while (s) {
      seen.push(`${s.verse}.${s.rep}.${s.turn[0]}`);
      s = nextStep(s, 2, 2);
    }
    expect(seen).toEqual(["0.1.r", "0.1.y", "0.2.r", "0.2.y", "1.1.r", "1.1.y", "1.2.r", "1.2.y"]);
  });
  it("skips to the next verse's first repetition", () => {
    expect(skipVerse({ verse: 0, rep: 2, turn: "you" }, 3)).toEqual({ verse: 1, rep: 1, turn: "reciter" });
    expect(skipVerse({ verse: 2, rep: 1, turn: "reciter" }, 3)).toBeNull();
  });
});

describe("verseAudioUrl", () => {
  it("uses everyayah's SSSAAA names", () => {
    expect(verseAudioUrl(RECITERS[0], { s: 2, a: 255 })).toBe("https://everyayah.com/data/Husary_128kbps/002255.mp3");
  });
});

/** Feeds `ms` of a steady level (10 ms frames). */
function feed(g: TurnGate, db: number, ms: number) {
  for (let t = 0; t < ms; t += 10) if (g.push(db).end) break;
  return g.status;
}

const OPTS: GateOptions = { guardMs: 400, thresholdDb: 10, minSpeechDb: -60, endSilenceMs: 2000, minSpeechMs: 500, noSpeechMs: 8000, maxMs: 30000 };

describe("TurnGate", () => {
  it("ends after the quiet that follows your recitation", () => {
    const g = new TurnGate(OPTS);
    feed(g, -50, 1000); // road noise
    expect(g.status.speaking).toBe(false);
    feed(g, -25, 3000); // reciting
    expect(g.status.speaking).toBe(true);
    expect(g.status.end).toBeNull();
    feed(g, -50, 1900);
    expect(g.status.end).toBeNull(); // not quite 2 s yet
    feed(g, -50, 200);
    expect(g.status.end).toBe("silence");
    expect(g.status.speechMs).toBeGreaterThan(2500);
  });

  it("learns loud road noise at once, so it does not count as speech", () => {
    const g = new TurnGate(OPTS);
    const st = feed(g, -35, 1500);
    expect(st.floorDb).toBeCloseTo(-35, 0);
    expect(st.speaking).toBe(false);
  });

  it("a pause shorter than the end silence keeps the turn going", () => {
    const g = new TurnGate(OPTS);
    feed(g, -60, 600);
    feed(g, -25, 2000);
    feed(g, -60, 1500); // thinking of the next words
    feed(g, -25, 2000);
    expect(g.status.end).toBeNull();
    feed(g, -60, 2100);
    expect(g.status.end).toBe("silence");
  });

  it("long continuous speech is not mistaken for the noise floor", () => {
    const g = new TurnGate(OPTS);
    feed(g, -60, 600);
    feed(g, -25, 10000); // 10 s without a single pause
    expect(g.status.end).toBeNull();
    expect(g.status.speaking).toBe(true);
    expect(g.status.floorDb).toBeLessThan(-45);
  });

  it("follows road noise that gets louder (the car speeds up)", () => {
    const g = new TurnGate({ ...OPTS, noSpeechMs: 60000 });
    feed(g, -55, 1000);
    for (let db = -55; db <= -40; db += 0.5) feed(g, db, 500); // 1 dB/s for 15 s
    expect(g.status.firstSpeechAt).toBeNull();
    expect(g.status.floorDb).toBeGreaterThan(-46);
  });

  it("ends with no-speech when you say nothing, and never runs past the maximum", () => {
    const quiet = new TurnGate(OPTS);
    expect(feed(quiet, -60, 9000).end).toBe("no-speech");
    const talky = new TurnGate({ ...OPTS, maxMs: 5000 });
    feed(talky, -60, 600);
    expect(feed(talky, -20, 10000).end).toBe("timeout");
  });

  it("ignores the guard period (the beep, the reciter's echo)", () => {
    const g = new TurnGate(OPTS);
    feed(g, -10, 400); // loud beep inside the guard
    feed(g, -60, 2500);
    expect(g.status.firstSpeechAt).toBeNull();
    expect(g.status.end).toBeNull();
  });

  it("ignores a mic's start-up silence (Bluetooth): road noise after it is not speech", () => {
    const g = new TurnGate(OPTS);
    feed(g, -120, 1200); // exact zeros while the Bluetooth mic starts
    feed(g, -50, 3000); // then the car
    expect(g.status.firstSpeechAt).toBeNull();
    expect(g.status.floorDb).toBeCloseTo(-50, 0);
    feed(g, -25, 2000);
    feed(g, -50, 2100);
    expect(g.status.end).toBe("silence");
  });

  it("scales its limits with the reciter's verse", () => {
    const o = gateOptions(20000, 2000, 10);
    expect(o.maxMs).toBe(65000);
    expect(o.noSpeechMs).toBe(34000);
    expect(gateOptions(NaN, 2000, 10).maxMs).toBe(29000);
  });
});
