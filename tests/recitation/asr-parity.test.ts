/**
 * Golden parity (spec §5.4): the TypeScript pipeline, run through onnxruntime-web's WebAssembly backend (the same
 * runtime the phone uses), must emit exactly the Python reference's greedy unit sequence (spec: "identical greedy
 * token sequences"). Unit start frames may differ by one: the WebAssembly int8 kernels differ from native ONNX
 * Runtime in the last bits, which can move a near-tie at a unit boundary by one 40 ms frame. This happens even
 * with Python's own features as input (checked for husary-1-1 and husary-2-255-12s), so it is the runtime, not
 * our front end.
 * Needs model B's ONNX file: $RECITATION_MODELS_DIR (default ../../models, i.e. quran-audio-c/models) or skipped.
 */
import fs from "node:fs";
import path from "node:path";
import * as ort from "onnxruntime-web";
import { beforeAll, describe, expect, it } from "vitest";
import { ZIPFORMER_P_ARABIC_V3 as PACK } from "@/recitation/asr/modelPack";
import { AsrPipeline, ZipformerStepper } from "@/recitation/asr/pipeline";
import { FIXTURES, golden } from "./helpers";

const MODELS = path.resolve(__dirname, "../..", process.env.RECITATION_MODELS_DIR ?? "../../models");
const MODEL_FILE = path.join(MODELS, "zipformer_p-arabic-v3", PACK.files[0].name);
const haveModel = fs.existsSync(MODEL_FILE) && fs.statSync(MODEL_FILE).size === PACK.files[0].bytes;
if (!haveModel) console.warn(`[asr-parity] skipped: model B not found at ${MODEL_FILE} (set RECITATION_MODELS_DIR)`);

const VOCAB: number = JSON.parse(fs.readFileSync(path.join(FIXTURES, "zipformer-p-arabic-v3.symbols.json"), "utf8")).symbols.length;

describe.skipIf(!haveModel)("model B pipeline: TS + onnxruntime-web vs Python", () => {
  let session: ort.InferenceSession;
  beforeAll(async () => {
    ort.env.wasm.numThreads = 1;
    session = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(MODEL_FILE)));
  });

  for (const name of ["husary-1-1", "husary-2-255-12s", "husary-112-1", "husary-2-255-44k", "husary-1-1-48k"]) {
    it(name, async () => {
      const { meta, audio } = golden(name);
      const pipe = new AsrPipeline(new ZipformerStepper(ort, session, PACK, VOCAB), PACK, meta.sampleRate);
      const units: [number, number][] = [];
      const perStep: number[] = [];
      const run = async () => {
        for (let r = await pipe.runStep(); r; r = await pipe.runStep()) {
          perStep.push(r.frames);
          for (const u of r.units) units.push([u.id, u.frame]);
        }
      };
      // live-like: 100 ms pieces, stepping whenever a window is ready
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
      console.log(`${name}: ${units.length} units identical; ${shifts.filter((d) => d > 0).length} start 1 frame off`);
    });
  }
});
