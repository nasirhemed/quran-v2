/**
 * Split a whole-surah recitation into ayahs.
 *
 *   npm run split-ayahs -- <audio file> <surah> [--from A] [--to B] [--out dir] [--clips] [--no-basmala]
 *
 * Decodes the file with ffmpeg (16 kHz mono), runs model B over it (the same pipeline as the app, through
 * onnxruntime-web's WebAssembly backend), aligns what it heard with the surah's text and writes:
 *   <out>/timings.json   [{ ayah, start, end, heard, cut }], seconds
 *   <out>/SSSAAA.mp3     one clip per ayah, everyayah's naming (with --clips; SSS000.mp3 is the basmala)
 * Model B's ONNX: $RECITATION_MODELS_DIR/zipformer_p-arabic-v3/ (default ../quran-audio-c/models).
 * Model output is cached next to the timings (<out>/heard.json), so a rerun only redoes the alignment.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as ort from "onnxruntime-web";
import { ZIPFORMER_P_ARABIC_V3 as PACK } from "../src/recitation/asr/modelPack";
import { AsrPipeline, ZipformerStepper } from "../src/recitation/asr/pipeline";
import type { RecitationWords, UnitTable } from "../src/recitation/engine/data";
import { ayahRange, splitAyahs, type Level } from "../src/recitation/engine/split";
import type { HeardUnit } from "../src/recitation/engine/verify";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const has = (name: string) => {
  const i = args.indexOf(name);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const fromA = flag("--from");
const toA = flag("--to");
const outFlag = flag("--out");
const clips = has("--clips");
const noBasmala = has("--no-basmala");
const [input, surahArg] = args;
if (!input || !surahArg) {
  console.error("usage: npm run split-ayahs -- <audio file> <surah> [--from A] [--to B] [--out dir] [--clips] [--no-basmala]");
  process.exit(1);
}
const surah = Number(surahArg);
const out = path.resolve(outFlag ?? `${input.replace(/\.[^.]+$/, "")}-ayat`);
fs.mkdirSync(out, { recursive: true });

const words: RecitationWords = JSON.parse(fs.readFileSync(path.join(root, "public/data/recitation-words.json"), "utf8"));
const table: UnitTable = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/recitation/zipformer-p-arabic-v3.symbols.json"), "utf8"));
const count = Object.keys(words.ayat).filter((k) => k.startsWith(`${surah}:`)).length;
const ayat = ayahRange(words, `${surah}:${fromA ?? 1}`, `${surah}:${toA ?? count}`);
const basmala = !noBasmala && surah !== 1 && surah !== 9 && (fromA ?? "1") === "1";

const RATE = 16000;
const LEVEL_S = 0.01;

async function hear(): Promise<{ heard: HeardUnit[]; level: Level; duration: number }> {
  const cache = path.join(out, "heard.json");
  const stat = fs.statSync(input);
  if (fs.existsSync(cache)) {
    const c = JSON.parse(fs.readFileSync(cache, "utf8"));
    if (c.input === path.resolve(input) && c.bytes === stat.size) {
      console.log(`model output from ${cache}`);
      return { heard: c.heard, level: { db: Float32Array.from(c.level), frameS: LEVEL_S }, duration: c.duration };
    }
  }
  const modelsDir = path.resolve(root, process.env.RECITATION_MODELS_DIR ?? "../quran-audio-c/models");
  const modelFile = path.join(modelsDir, "zipformer_p-arabic-v3", PACK.files[0].name);
  if (!fs.existsSync(modelFile) || fs.statSync(modelFile).size !== PACK.files[0].bytes) {
    throw new Error(`model B not found at ${modelFile} (set RECITATION_MODELS_DIR; git lfs pull in quran-audio-c)`);
  }
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(modelFile)));
  const pipe = new AsrPipeline(new ZipformerStepper(ort, session, PACK, table.symbols.length), PACK, RATE);
  const frameS = PACK.streaming.frameMs / 1000;
  const heard: HeardUnit[] = [];
  const level: number[] = [];
  const perLevel = RATE * LEVEL_S;
  let acc = 0;
  let accN = 0;
  let samples = 0;
  const t0 = Date.now();
  const run = async () => {
    for (let r = await pipe.runStep(); r; r = await pipe.runStep()) {
      for (const u of r.units) heard.push({ unit: u.id, time: +(u.frame * frameS).toFixed(2) });
    }
  };
  const ff = spawn("ffmpeg", ["-v", "error", "-i", input, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"], { stdio: ["ignore", "pipe", "inherit"] });
  let rest = Buffer.alloc(0);
  let lastLog = 0;
  for await (const chunk of ff.stdout as AsyncIterable<Buffer>) {
    const buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
    const n = Math.floor(buf.length / 4);
    const x = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + n * 4));
    rest = Buffer.from(buf.subarray(n * 4));
    for (let i = 0; i < x.length; i++) {
      acc += x[i] * x[i];
      if (++accN === perLevel) {
        level.push(+(10 * Math.log10(acc / accN + 1e-12)).toFixed(1));
        acc = accN = 0;
      }
    }
    samples += x.length;
    pipe.push(x);
    await run();
    if (samples / RATE - lastLog >= 300) {
      lastLog = samples / RATE;
      console.log(`  ${Math.round(lastLog / 60)} min heard (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
  }
  pipe.finish();
  await run();
  const duration = samples / RATE;
  console.log(`heard ${(duration / 60).toFixed(1)} min in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${heard.length} units`);
  fs.writeFileSync(cache, JSON.stringify({ input: path.resolve(input), bytes: stat.size, duration, heard, level }));
  return { heard, level: { db: Float32Array.from(level), frameS: LEVEL_S }, duration };
}

const { heard, level, duration } = await hear();
const spans = splitAyahs(heard, words, table, ayat, level, { basmala, duration });
const round = (t: number) => Math.round(t * 100) / 100;
const result = spans.map((s) => ({ ...s, start: round(s.start), end: round(s.end), heard: round(s.heard) }));
fs.writeFileSync(path.join(out, "timings.json"), JSON.stringify(result, null, 1));

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;
for (const s of result) {
  const warn = s.heard < 0.7 || s.cut === "estimated" ? "  <- check" : "";
  console.log(`${s.ayah.padEnd(8)} ${fmt(s.start).padStart(8)} – ${fmt(s.end).padStart(8)}  heard ${Math.round(s.heard * 100)}%  cut ${s.cut}${warn}`);
}
console.log(`timings: ${path.join(out, "timings.json")}`);

if (clips) {
  const pad3 = (n: number) => String(n).padStart(3, "0");
  for (const s of result) {
    const a = s.ayah === "basmala" ? 0 : Number(s.ayah.split(":")[1]);
    const file = path.join(out, `${pad3(surah)}${pad3(a)}.mp3`);
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(s.start), "-t", (s.end - s.start).toFixed(2), "-i", input, "-b:a", "128k", file]);
    if (r.status !== 0) throw new Error(`ffmpeg failed on ${s.ayah}: ${r.stderr}`);
  }
  console.log(`${result.length} clips in ${out}`);
}
