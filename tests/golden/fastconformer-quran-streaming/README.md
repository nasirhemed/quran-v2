# ASR golden files (model A)

Expected output of the FastConformer word model (`Muno459/fastconformer-quran-streaming`, int8, cache-aware) for
`tests/recitation/asr-fastconformer.test.ts` (spec §5.4). Exported by `scripts/export-fastconformer-golden.py`
(NeMo's FilterbankFeatures, the pack's tlog CMVN, native ONNX Runtime). The input audio is model B's: the `.s16`
files in `../zipformer-p-arabic-v3` (44.1 / 48 kHz clips through their `resample_poly` reference).

| File | Content |
|---|---|
| `<name>.mel.f32` | log-mel features before CMVN, float32 (frames × 80) — husary-1-1 and husary-112-1 |
| `<name>.json` | mel frame count, greedy tokens `[id, output frame]`, output frames per step, decoded text |

No model files or log-probs are stored here.

**Audio:** recitation by Mahmoud Khalil Al-Husary, from [EveryAyah](https://everyayah.com), licensed
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) (see `../zipformer-p-arabic-v3/README.md`).
