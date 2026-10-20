/**
 * Model A, the FastConformer word model: features against NeMo's (golden files from
 * scripts/export-fastconformer-golden.py), then the whole streaming pipeline against the Python reference.
 */
import fs from "node:fs";
import path from "node:path";
import * as ort from "onnxruntime-web";
import { beforeAll, describe, expect, it } from "vitest";
import { NemoMel, readNpz, type Cmvn } from "@/recitation/asr/features/nemoMel";
import { FASTCONFORMER_QURAN_STREAMING as PACK } from "@/recitation/asr/modelPack";
import { AsrPipeline, createStepper } from "@/recitation/asr/pipeline";
import { bpeSymbols } from "@/recitation/asr/sentencepiece";
import { wordIndex } from "@/recitation/engine/data";
import { FollowSession } from "@/recitation/engine/session";
import { goldenA, quran } from "./helpers";

describe("NeMo log-mel (model A features) matches the Python reference", () => {
  for (const name of ["husary-1-1", "husary-112-1"]) {
    it(name, () => {
      const { meta, audio, f32 } = goldenA(name);
      const ref = f32("mel.f32");
      const mel = new NemoMel();
      const parts: Float32Array[] = [];
      const sizes = [128, 1000, 37, 4096];
      for (let i = 0, k = 0; i < audio.length; k++) {
        parts.push(mel.push(audio.subarray(i, i + sizes[k % 4])));
        i += sizes[k % 4];
      }
      parts.push(mel.finish());
      const ours = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
      parts.reduce((o, p) => (ours.set(p, o), o + p.length), 0);
      expect(ours.length).toBe(meta.frames * 80);
      const d = ours.reduce((m, v, i) => Math.max(m, Math.abs(v - ref[i])), 0);
      console.log(`${name}: ${meta.frames} frames, max |Δ| = ${d.toExponential(2)}`);
      expect(d).toBeLessThan(1e-3);
    });
  }
});

/**
 * Golden parity for model A (spec §5.4), through onnxruntime-web's WebAssembly backend: the TS pipeline must emit
 * the Python reference's greedy token sequence, with start frames at most one frame off (as for model B).
 * Needs model A's files: $RECITATION_MODELS_DIR (default ../../models, i.e. quran-audio-c/models) or skipped.
 */
const MODELS = path.resolve(__dirname, "../..", process.env.RECITATION_MODELS_DIR ?? "../../models");
const DIR = path.join(MODELS, "fastconformer-quran-streaming");
const MODEL_FILE = path.join(DIR, PACK.files[0].name);
const haveModel = fs.existsSync(MODEL_FILE) && fs.statSync(MODEL_FILE).size === PACK.files[0].bytes;
if (!haveModel) console.warn(`[asr-fastconformer] parity skipped: model A not found at ${MODEL_FILE} (set RECITATION_MODELS_DIR)`);

describe.skipIf(!haveModel)("model A pipeline: TS + onnxruntime-web vs Python", () => {
  let session: ort.InferenceSession;
  let cmvn: Cmvn;
  let symbols: string[];
  beforeAll(async () => {
    ort.env.wasm.numThreads = 1;
    session = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(MODEL_FILE)));
    const npz = readNpz(new Uint8Array(fs.readFileSync(path.join(DIR, "streaming_global_cmvn.npz"))));
    cmvn = { mean: npz.tlog_mean, std: npz.tlog_std };
    symbols = bpeSymbols(new Uint8Array(fs.readFileSync(path.join(DIR, PACK.units.tokensFile))), PACK.units.blank);
  });

  it("reads the tokenizer and the CMVN file", () => {
    expect(symbols.length).toBe(1025);
    expect(symbols[10]).toBe(" ");
    expect(cmvn.mean.length).toBe(80);
    expect(cmvn.std.every((v) => v > 0)).toBe(true);
  });

  for (const name of ["husary-1-1", "husary-2-255-12s", "husary-112-1", "husary-2-255-44k", "husary-1-1-48k"]) {
    it(name, async () => {
      const { meta, audio } = goldenA(name);
      const pipe = new AsrPipeline(createStepper(ort, session, PACK, symbols.length), PACK, meta.sampleRate, cmvn);
      const units: [number, number][] = [];
      const perStep: number[] = [];
      const run = async () => {
        for (let r = await pipe.runStep(); r; r = await pipe.runStep()) {
          perStep.push(r.frames);
          for (const u of r.units) units.push([u.id, u.frame]);
        }
      };
      const piece = Math.round(meta.sampleRate / 10);
      for (let i = 0; i < audio.length; i += piece) {
        pipe.push(audio.subarray(i, i + piece));
        await run();
      }
      pipe.finish();
      await run();
      expect(perStep).toEqual(meta.outputFramesPerStep);
      expect(units.map((u) => u[0])).toEqual(meta.units.map((u) => u[0]));
      const shifts = units.map((u, i) => Math.abs(u[1] - meta.units[i][1]));
      expect(Math.max(...shifts)).toBeLessThanOrEqual(1);
      expect(units.map((u) => symbols[u[0]]).join("").trim()).toBe(meta.text);
      console.log(`${name}: ${units.length} tokens identical; ${shifts.filter((d) => d > 0).length} start 1 frame off`);
    }, 60_000);
  }

  it("Follow mode on its real output for 2:255's opening offers 2:255 and 3:2, which open alike", () => {
    const { meta } = goldenA("husary-2-255-12s");
    const { words, ref } = quran();
    const key = wordIndex(words).key;
    const s = new FollowSession(ref, words, symbols, "bpe");
    const offered = new Set<string>();
    let first = 0;
    meta.outputFramesPerStep.forEach((n, step) => {
      const units = meta.units.filter(([, f]) => f >= first && f < first + n).map(([u]) => u);
      first += n;
      for (const e of s.push(units, step, (step + 1) * 1.12)) if (e.type === "candidates") e.places.forEach((p) => offered.add(key[p.word].split(":").slice(0, 2).join(":")));
    });
    expect(offered).toContain("2:255");
    expect(offered).toContain("3:2");
  });
});
