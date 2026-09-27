import { describe, expect, it } from "vitest";
import { KaldiFbank } from "@/recitation/asr/features/kaldiFbank";
import { Resampler } from "@/recitation/asr/resample";
import { golden } from "./helpers";

/** Feed `x` in uneven pieces, as a microphone would. */
function streamed(x: Float32Array, push: (p: Float32Array) => Float32Array, finish: () => Float32Array, sizes = [128, 1000, 37, 4096]) {
  const parts: Float32Array[] = [];
  for (let i = 0, k = 0; i < x.length; k++) {
    const n = sizes[k % sizes.length];
    parts.push(push(x.subarray(i, i + n)));
    i += n;
  }
  parts.push(finish());
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const maxAbsDiff = (a: Float32Array, b: Float32Array) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

describe("Kaldi fbank (model B features) matches the Python reference", () => {
  for (const name of ["husary-1-1", "husary-2-255-12s", "husary-112-1"]) {
    it(name, () => {
      const { meta, audio, f32 } = golden(name);
      const ref = f32("fbank.f32");
      const fb = new KaldiFbank();
      const ours = streamed(audio, (p) => fb.push(p), () => fb.finish());
      expect(ours.length).toBe(meta.frames * 80);
      const d = maxAbsDiff(ours, ref);
      console.log(`${name}: ${meta.frames} frames, max |Δ| = ${d.toExponential(2)}`);
      expect(d).toBeLessThan(1e-3);
    });
  }
});

describe("resampler matches scipy resample_poly", () => {
  for (const name of ["husary-2-255-44k", "husary-1-1-48k"]) {
    it(name, () => {
      const { meta, audio, f32 } = golden(name);
      const ref = f32("ref16.f32");
      const rs = new Resampler(meta.sampleRate, 16000);
      const ours = streamed(audio, (p) => rs.push(p), () => rs.finish());
      expect(ours.length).toBe(meta.samples16);
      const d = maxAbsDiff(ours, ref);
      console.log(`${name}: ${meta.sampleRate} → 16000 Hz, max |Δ| = ${d.toExponential(2)}`);
      expect(d).toBeLessThan(1e-5);
    });
  }

  it("keeps a 1 kHz tone and removes a 12 kHz one (48 kHz → 16 kHz)", () => {
    const n = 48000;
    const tone = (f: number) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * f * i) / 48000));
    const rms = (x: Float32Array) => Math.sqrt(x.slice(2000, -2000).reduce((s, v) => s + v * v, 0) / (x.length - 4000));
    const run = (x: Float32Array) => {
      const r = new Resampler(48000, 16000);
      return streamed(x, (p) => r.push(p), () => r.finish());
    };
    expect(Math.abs(rms(run(tone(1000))) - Math.SQRT1_2)).toBeLessThan(0.002); // Kaiser β=5 pass-band ripple ≈ 0.1%
    // scipy's filter reaches its stop band a little above the new 8 kHz Nyquist; 12 kHz must not alias back in
    expect(rms(run(tone(12000)))).toBeLessThan(Math.SQRT1_2 * 0.01); // ≥ 40 dB down
  });
});
