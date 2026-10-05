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

const OPTS: GateOptions = { guardMs: 400, thresholdDb: 10, minSpeechDb: -60, endSilenceMs: 2000, minSpeechMs: 500, expectSpeechMs: 0, noSpeechMs: 8000, maxMs: 30000 };

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
    expect(g.status.floorDb).toBeLessThan(-40); // rises at most 2 dB/s
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

  it("a little speech, then giving up, ends as no-speech, not at the timeout", () => {
    const g = new TurnGate({ ...gateOptions(20000, 2000, 10), minSpeechMs: 1000 }); // a 20 s verse: maxMs 65 s
    feed(g, -50, 1000);
    feed(g, -25, 400); // one word, then forgot the verse
    expect(feed(g, -50, 12000).end).toBe("no-speech");
    expect(g.elapsedMs).toBeLessThan(13000);
  });

  it("near-silence from a starting mic (not exact zeros) does not hold the floor down", () => {
    const g = new TurnGate(OPTS);
    feed(g, -95, 800); // hands-free unit starting up
    feed(g, -50, 3000);
    expect(g.status.firstSpeechAt).toBeNull();
    expect(feed(g, -50, 6000).end).toBe("no-speech");
  });

  it("road bumps (short loud blocks) are not speech and don't hold the turn open", () => {
    const g = new TurnGate(OPTS);
    feed(g, -50, 1000);
    feed(g, -25, 3000);
    // 2.4 s of quiet with a 100 ms thump in it: the thump does not restart the quiet
    feed(g, -50, 800);
    feed(g, -30, 100);
    feed(g, -50, 1150);
    expect(g.status.end).toBe("silence");
  });

  it("tells you the room's level while you are quiet", () => {
    const g = new TurnGate(OPTS);
    feed(g, -48, 2000);
    feed(g, -25, 2000);
    feed(g, -48, 1000);
    expect(g.roomDb()).toBeCloseTo(-48, 0);
  });

  it("starting to recite straight away: the previous turn's room level lets it hear you", () => {
    const blind = new TurnGate(OPTS);
    feed(blind, -25, 3000); // reciting from the first moment
    expect(blind.status.speechMs).toBe(0); // with nothing to compare, your voice looks like the room
    const seeded = new TurnGate({ ...OPTS, seedFloorDb: -50 });
    feed(seeded, -25, 3000);
    expect(seeded.status.speechMs).toBeGreaterThan(2000);
    feed(seeded, -50, 2100);
    expect(seeded.status.end).toBe("silence");
    expect(seeded.roomDb()).toBeCloseTo(-50, 0);
  });

  it("the first turn (no room level measured yet) still hears you if you start at once", () => {
    const g = new TurnGate({ ...gateOptions(5000, 3000, 10, 400), expectSpeechMs: 0 });
    for (let i = 0; i < 7; i++) {
      feed(g, -28, 450); // words…
      feed(g, -62, 100); // …with the short gaps between them
    }
    expect(g.status.speechMs).toBeGreaterThan(2500);
    feed(g, -62, 3100);
    expect(g.status.end).toBe("silence");
    expect(g.roomDb()).toBeCloseTo(-62, 0);
  });

  it("a bad room estimate (recited without a pause) never hides your voice next turn", () => {
    expect(gateOptions(5000, 3000, 10, 400, -30).seedFloorDb).toBe(-48);
    expect(gateOptions(5000, 3000, 10, 400, -65).seedFloorDb).toBe(-65);
  });

  it("a louder car than last turn is not taken for speech", () => {
    const g = new TurnGate({ ...OPTS, seedFloorDb: -60, noSpeechMs: 60000 });
    feed(g, -48, 10000); // 12 dB louder than the seed
    expect(g.status.firstSpeechAt).toBeNull();
  });

  it("long verses: a pause to remember a word does not end the turn early", () => {
    const o = gateOptions(30000, 2000, 10); // the reciter took 30 s
    const g = new TurnGate(o);
    feed(g, -50, 1000);
    feed(g, -25, 6000);
    feed(g, -50, 3000); // 3 s pause, past the 2 s end silence
    expect(g.status.end).toBeNull();
    feed(g, -25, 7000);
    feed(g, -50, 2100);
    expect(g.status.end).toBe("silence"); // after recitation that long, 2 s of quiet is enough
  });

  it("a breath early in the verse doesn't end the turn (silence only)", () => {
    const g = new TurnGate(gateOptions(8000, 3000, 10)); // the reciter took 8 s: 3.2 s of speech expected
    feed(g, -50, 1000);
    feed(g, -25, 1500); // the first words
    feed(g, -50, 4000); // a long breath: more than the 3 s end silence
    expect(g.status.end).toBeNull();
    feed(g, -25, 2500);
    feed(g, -50, 3100);
    expect(g.status.end).toBe("silence");
  });

  it("counts the quiet since you last spoke", () => {
    const g = new TurnGate(OPTS);
    feed(g, -50, 1000);
    expect(g.status.quietMs).toBe(0); // nothing said yet
    feed(g, -25, 1000);
    expect(g.status.quietMs).toBe(0);
    feed(g, -50, 700);
    expect(g.status.quietMs).toBeGreaterThanOrEqual(600);
    expect(g.status.quietMs).toBeLessThanOrEqual(750);
  });

  it("scales its limits with the reciter's verse", () => {
    const o = gateOptions(20000, 2000, 10, 800);
    expect(o.guardMs).toBe(800);
    expect(o.maxMs).toBe(65000);
    expect(o.noSpeechMs).toBe(10000);
    expect(o.expectSpeechMs).toBe(8000);
    expect(gateOptions(3000, 2000, 10).expectSpeechMs).toBe(0);
    expect(gateOptions(6000, 2000, 10).expectSpeechMs).toBe(2400);
    expect(gateOptions(NaN, 2000, 10).maxMs).toBe(29000);
  });
});
