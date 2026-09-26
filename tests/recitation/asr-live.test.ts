import { describe, expect, it } from "vitest";
import { createRing, RingReader, RingWriter } from "@/recitation/asr/ring";
import { EnergyVad } from "@/recitation/asr/vad";

describe("ring buffer (worklet → worker)", () => {
  it("passes every sample through, across wrap-around, in order", () => {
    const ring = createRing(1024);
    const w = new RingWriter(ring);
    const r = new RingReader(ring);
    const got: number[] = [];
    let v = 0;
    for (let q = 0; q < 100; q++) {
      w.write(Float32Array.from({ length: 128 }, () => v++), 1000 + q * 128);
      if (q % 3 === 2) got.push(...r.take());
    }
    got.push(...r.take());
    expect(got).toEqual(Array.from({ length: 12800 }, (_, i) => i));
    expect(r.firstFrame).toBe(1000);
    expect(r.lost).toBe(0);
  });

  it("reports lost audio instead of hiding it when the reader falls a buffer behind", () => {
    const ring = createRing(1024);
    const w = new RingWriter(ring);
    const r = new RingReader(ring);
    for (let q = 0; q < 10; q++) w.write(new Float32Array(128).fill(q), q * 128);
    const x = r.take();
    expect(x.length).toBe(1024);
    expect(r.lost).toBe(256);
    expect(x[0]).toBe(2); // the oldest two quanta were overwritten
  });

  it("rejects a capacity that would break wrap-around", () => {
    expect(() => createRing(1000)).toThrow();
  });
});

describe("energy VAD", () => {
  it("finds speech in a tone burst over quiet noise, with a hangover", () => {
    const sr = 16000;
    let seed = 1;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.002;
    const x = Float32Array.from({ length: sr * 4 }, (_, i) => noise() + (i >= sr * 1.5 && i < sr * 2.5 ? 0.3 * Math.sin((2 * Math.PI * 200 * i) / sr) : 0));
    const vad = new EnergyVad();
    const changes = vad.push(x);
    expect(changes.map((c) => c.speech)).toEqual([true, false]);
    expect(Math.abs(changes[0].atSample / sr - 1.5)).toBeLessThan(0.02);
    expect(Math.abs(changes[1].atSample / sr - 2.5)).toBeLessThan(0.02);
    expect(vad.takeLevel()).toBeGreaterThan(0.05);
  });
});
