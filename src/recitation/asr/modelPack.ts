/**
 * A model pack: everything model-specific, so models are interchangeable (spec §5.5, amended in quran-audio-c
 * docs/REPO_NOTES.md §6.4). The engine only sees unit ids and this description.
 */
export interface StateSpec {
  input: string;
  output: string;
  dtype: "float32" | "int64";
  shape: number[];
}

export interface PackFile {
  name: string;
  bytes: number;
  sha256: string;
}

export interface ModelPack {
  id: string;
  version: string;
  /** shown in voice settings */
  label: string;
  description: string;
  license: string;
  /** Model file, token list and LICENSE; hosted by us (spec §10.5) at `<VITE_MODEL_BASE_URL>/<id>/<version>/<name>`,
   * downloaded on first use and kept in OPFS (see modelStore.ts). */
  files: PackFile[];
  features:
    | { kind: "kaldi-fbank"; bins: 80; frameShiftMs: 10; frameLengthMs: 25; window: "povey"; dither: 0; snipEdges: false; lowFreq: 20; highFreq: -400; preemph: 0.97; removeDc: true }
    | { kind: "nemo-mel"; bins: 80; nFft: 512; winLength: 400; hop: 160; preemph: 0.97; logGuard: number; cmvnFile: string };
  streaming: {
    featureLayout: "BTF" | "BFT";
    chunkInputFrames: number; // feature frames per call
    chunkHopFrames: number; // feature frames advanced per call
    chunkOutputFrames: number;
    frameMs: number; // one output frame
    lengthInput?: string;
    logProbsOutput: string;
    states: StateSpec[] | "from-graph"; // B's 98 states are read from the ONNX graph at load time
    flush: { kind: "padFeatures"; frames: number; value: number } | { kind: "shortChunk" };
  };
  units: { kind: "phoneme" | "bpe"; tokensFile: string; blank: number };
  /** false: the app can download the pack but has no pipeline for it yet */
  runnable?: boolean;
}

/** Model B, the default (quran-audio-c docs/milestones/M0b_FIRST_LOOK.md). */
export const ZIPFORMER_P_ARABIC_V3: ModelPack = {
  id: "zipformer-p-arabic-v3",
  version: "v3-int8",
  label: "Phoneme model (recommended)",
  description: "Quran-Lab zipformer_p-arabic-v3. Hears phonemes, so it copes with tajwīd and waqf. Follows about 0.5 s behind you.",
  license: "NPL-1.2",
  files: [
    { name: "zipformer_p_arabic_v3.int8.onnx", bytes: 72_705_392, sha256: "6a5ddafa9c5e5c01260d30264031b341785bdc152e9ef1d569b41c8c278508eb" },
    { name: "tokens.txt", bytes: 2_346, sha256: "252c10687e442aa9291973065fae19fa39bcd681c4f5612ec496a647e20b43a1" },
    { name: "LICENSE", bytes: 7_041, sha256: "77526bdbfac94132e5114c3a34492c33f915e4b7f310f00b9995500d3610cab5" },
  ],
  features: { kind: "kaldi-fbank", bins: 80, frameShiftMs: 10, frameLengthMs: 25, window: "povey", dither: 0, snipEdges: false, lowFreq: 20, highFreq: -400, preemph: 0.97, removeDc: true },
  streaming: {
    featureLayout: "BTF",
    chunkInputFrames: 61,
    chunkHopFrames: 48,
    chunkOutputFrames: 12,
    frameMs: 40,
    logProbsOutput: "log_probs",
    states: "from-graph",
    flush: { kind: "padFeatures", frames: 61, value: Math.log(1e-10) },
  },
  units: { kind: "phoneme", tokensFile: "tokens.txt", blank: 250 },
};

/**
 * Model A, the alternative (spec §5.1). Listed so packs stay interchangeable; its feature pipeline and word
 * mapping are not built yet, so the app can download it but not run it.
 */
export const FASTCONFORMER_QURAN_STREAMING: ModelPack = {
  id: "fastconformer-quran-streaming",
  version: "enc-q8",
  label: "Word model (experimental)",
  description: "FastConformer streaming, int8. Hears whole words with harakat. Larger, and missed more words in our tests.",
  license: "NPL-1.1",
  files: [
    { name: "model_streaming_with_encoder.q8.onnx", bytes: 131_948_464, sha256: "4168c51a47cd99dea930e7c6ed2d96c8595e242b9139fb814f51645822462dac" },
    { name: "tokenizer.model", bytes: 254_806, sha256: "1fcfa104fa448c979cc2537788947c6516827f403ecdc55c4895b77d28630ba4" },
    { name: "streaming_global_cmvn.npz", bytes: 2_302, sha256: "e5083c4cdefc16d574eef9c16094b03bf8876ae70b40975a3c66caf995558d2e" },
    { name: "LICENSE", bytes: 5_852, sha256: "8ee6366f4b3ccb70dd2e9265d8a02505b402c088065a72b2251e1b89e8476b34" },
  ],
  features: { kind: "nemo-mel", bins: 80, nFft: 512, winLength: 400, hop: 160, preemph: 0.97, logGuard: 2 ** -24, cmvnFile: "streaming_global_cmvn.npz" },
  streaming: {
    featureLayout: "BFT",
    chunkInputFrames: 112,
    chunkHopFrames: 112,
    chunkOutputFrames: 13,
    frameMs: 80,
    lengthInput: "length",
    logProbsOutput: "logprobs",
    states: [
      { input: "cache_last_channel", output: "cache_last_channel_next", dtype: "float32", shape: [1, 17, 70, 512] },
      { input: "cache_last_time", output: "cache_last_time_next", dtype: "float32", shape: [1, 17, 512, 8] },
      { input: "cache_last_channel_len", output: "cache_last_channel_next_len", dtype: "int64", shape: [1] },
    ],
    flush: { kind: "shortChunk" },
  },
  units: { kind: "bpe", tokensFile: "tokenizer.model", blank: 1024 },
  runnable: false,
};

export const MODEL_PACKS: ModelPack[] = [ZIPFORMER_P_ARABIC_V3, FASTCONFORMER_QURAN_STREAMING];
export const DEFAULT_PACK = ZIPFORMER_P_ARABIC_V3;

const PACK_KEY = "voice.pack";

/** The pack chosen in voice settings (a runnable one; falls back to the default). */
export function selectedPack(): ModelPack {
  let id: string | null = null;
  try {
    id = localStorage.getItem(PACK_KEY);
  } catch {
    /* storage blocked */
  }
  return MODEL_PACKS.find((p) => p.id === id && p.runnable !== false) ?? DEFAULT_PACK;
}

export function choosePack(id: string) {
  try {
    localStorage.setItem(PACK_KEY, id);
  } catch {
    /* private mode: the choice lasts for this visit */
  }
}
