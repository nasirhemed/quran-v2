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

export interface ModelPack {
  id: string;
  version: string;
  license: string;
  /** model file, token list and LICENSE; hosted by us (spec §10.5), downloaded on first use */
  files: { name: string; url: string; bytes: number; sha256: string }[];
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
}

/** Model B, the default (docs: M0b). URLs are filled in when hosting is decided (M2). */
export const ZIPFORMER_P_ARABIC_V3: ModelPack = {
  id: "zipformer-p-arabic-v3",
  version: "v3-int8",
  license: "NPL-1.2",
  files: [],
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
