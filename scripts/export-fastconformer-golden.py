#!/usr/bin/env python3
"""Golden parity files for model A, the FastConformer word model (spec §5.4).

    python3 scripts/export-fastconformer-golden.py <fastconformer-quran-streaming dir>

Reads the EveryAyah clips already in tests/golden/zipformer-p-arabic-v3 (the 44.1 / 48 kHz ones through their
`resample_poly` reference) and writes tests/golden/fastconformer-quran-streaming:
  <name>.json     mel frame count, greedy units [id, output frame], output frames per step, decoded text
  <name>.mel.f32  log-mel features before CMVN (frames × 80, float32), for the clips listed in MEL

Features are NeMo's FilterbankFeatures as the model was trained with them (nemo_toolkit 3.0
nemo/collections/asr/parts/preprocessing/features.py, inference: no dither, no per-feature normalization):
pre-emphasis 0.97, zero-padded centred STFT (n_fft 512, symmetric Hann 400, hop 160), power, librosa Slaney mel
(80 bins, 0–8000 Hz), ln(x + 2^-24), frames = samples // 160; then the pack's fixed global CMVN (tlog profile).
The model card's script uses torchaudio instead (periodic Hann, reflect padding, one more frame); both give the
same tokens on these clips, and the mean difference is 0.004.

Inference follows streaming_inference_example.py: 112-frame chunks, zero caches, greedy CTC with the previous
token carried across chunks, the last chunk shorter. Needs numpy, torch, librosa, onnxruntime, sentencepiece.
"""
import json
import sys
from pathlib import Path

import librosa
import numpy as np
import onnxruntime as ort
import sentencepiece as spm
import torch

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tests/golden/zipformer-p-arabic-v3"
OUT = ROOT / "tests/golden/fastconformer-quran-streaming"
CLIPS = ["husary-1-1", "husary-2-255-12s", "husary-112-1", "husary-2-255-44k", "husary-1-1-48k"]
MEL = {"husary-1-1", "husary-112-1"}
CHUNK = 112
BLANK = 1024

FB = torch.tensor(librosa.filters.mel(sr=16000, n_fft=512, n_mels=80, fmin=0, fmax=8000, norm="slaney"), dtype=torch.float)
WINDOW = torch.hann_window(400, periodic=False)


def nemo_mel(wav: np.ndarray) -> np.ndarray:
    x = torch.tensor(wav, dtype=torch.float)[None]
    x = torch.cat((x[:, :1], x[:, 1:] - 0.97 * x[:, :-1]), dim=1)
    s = torch.stft(x, n_fft=512, hop_length=160, win_length=400, center=True, window=WINDOW, return_complex=True, pad_mode="constant")
    power = torch.view_as_real(s).pow(2).sum(-1)
    mel = torch.log(torch.matmul(FB, power) + 2**-24)[0].numpy()
    return mel[:, : len(wav) // 160]


def main(model_dir: Path):
    sess = ort.InferenceSession(str(model_dir / "model_streaming_with_encoder.q8.onnx"), providers=["CPUExecutionProvider"])
    sp = spm.SentencePieceProcessor(model_file=str(model_dir / "tokenizer.model"))
    cmvn = np.load(model_dir / "streaming_global_cmvn.npz")
    mean, std = cmvn["tlog_mean"][:, None], cmvn["tlog_std"][:, None]
    names = [o.name for o in sess.get_outputs()]
    OUT.mkdir(exist_ok=True)
    for name in CLIPS:
        src = json.loads((SRC / f"{name}.json").read_text())
        if src["sampleRate"] == 16000:
            wav = np.fromfile(SRC / f"{name}.s16", np.int16).astype(np.float32) / 32768
        else:
            wav = np.fromfile(SRC / f"{name}.ref16.f32", np.float32)
        mel = nemo_mel(wav)
        feats = ((mel - mean) / (std + 1e-5)).astype(np.float32)
        clc = np.zeros((1, 17, 70, 512), np.float32)
        clt = np.zeros((1, 17, 512, 8), np.float32)
        cll = np.zeros((1,), np.int64)
        units, per_step, prev, frame = [], [], -1, 0
        for s in range(0, feats.shape[1], CHUNK):
            chunk = np.ascontiguousarray(feats[:, s : s + CHUNK][None])
            o = dict(zip(names, sess.run(None, {"audio_signal": chunk, "length": np.array([chunk.shape[2]], np.int64), "cache_last_channel": clc, "cache_last_time": clt, "cache_last_channel_len": cll})))
            clc, clt, cll = o["cache_last_channel_next"], o["cache_last_time_next"], o["cache_last_channel_next_len"]
            lp = o["logprobs"][0]
            per_step.append(int(lp.shape[0]))
            for t in lp.argmax(-1):
                t = int(t)
                if t != prev and t != BLANK:
                    units.append([t, frame])
                prev = t
                frame += 1
        meta = {
            "name": name,
            "note": src["note"],
            "sampleRate": src["sampleRate"],
            "samples": src["samples"],
            "samples16": len(wav),
            "frames": int(feats.shape[1]),
            "units": units,
            "outputFramesPerStep": per_step,
            "blank": BLANK,
            "text": sp.decode([u for u, _ in units]),
        }
        (OUT / f"{name}.json").write_text(json.dumps(meta, ensure_ascii=False))
        if name in MEL:
            np.ascontiguousarray(mel.T.astype(np.float32)).tofile(OUT / f"{name}.mel.f32")
        print(name, meta["frames"], "frames:", meta["text"])


if __name__ == "__main__":
    main(Path(sys.argv[1]))
