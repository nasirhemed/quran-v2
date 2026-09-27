# ASR golden files (model B)

Parity inputs and expected outputs for `tests/recitation/asr-frontend.test.ts` and `asr-parity.test.ts`
(spec §5.4). Exported by `spike/recitation/export_golden.py` in the private `quran-audio-c` repo, from the Python
reference pipeline (kaldi-native-fbank, scipy `resample_poly`, native ONNX Runtime 1.30).

| File | Content |
|---|---|
| `<name>.s16` | input audio, 16-bit little-endian mono, at the JSON's `sampleRate` |
| `<name>.fbank.f32` | Kaldi fbank of the 16 kHz audio, float32 (frames × 80) — 16 kHz clips |
| `<name>.ref16.f32` | `resample_poly` of the input to 16 kHz, float32 — 44.1 / 48 kHz clips |
| `<name>.json` | frame count, greedy units `[id, output frame]`, output frames per step |

No model output files (log-probs) or model files are stored here.

**Audio:** recitation by Mahmoud Khalil Al-Husary, from [EveryAyah](https://everyayah.com), licensed
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). Clips: 1:1, 2:255 (first 12 s and first 4 s), 112:1,
and 1:1 resampled to 48 kHz (first 3 s). Changes: cut, resampled, quantized to 16 bits.
