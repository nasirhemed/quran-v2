"""Build public/data/recitation-words.json: the Hafs phonemes of every mushaf word (voice features, spec §6).

Source: quran-transcript (MIT, https://github.com/obadx/quran-transcript), the Quranic phonetizer whose output
model B (Quran-Lab/zipformer_p-arabic-v3) was trained on. Its character mapping gives each word's exact span
in the ayah's phonemes, including words joined by idgham ("هُدًى لِّلْمُتَّقِينَ" → "هُدَ" + "للِلمُتتَقِۦۦۦۦن").

Joins on quran-pages.json's word list and fails loudly on any mismatch (spec §6.2): Itqan sometimes keeps two
written words as one ("بَعْدَ مَا", "إِلْ يَاسِينَ"); those phonetizer words are merged.

Model-specific unit ids are NOT stored here: the app derives them at runtime from the downloaded model pack's
own token list, so this file carries no model-licensed data.

Output (minified): {"v": 1, "source": ..., "ayat": {"s:a": [first word idx, word count]}, "ph": [phonemes per word]}
Word idx is the global mushaf order 0..77428 (QWord.idx, spec §6.1).

Usage:  pip install quran-transcript==0.6.4 && python scripts/build-recitation-data.py   (≈10 min)
"""
import json
import os
import re
import sys

from quran_transcript import Aya, MoshafAttributes, quran_phonetizer

PAGES = "public/data/quran-pages.json"
OUT = "public/data/recitation-words.json"
# Madd lengths fixed at 4 harakat, as in model B's training labels.
MOSHAF = MoshafAttributes(rewaya="hafs", madd_monfasel_len=4, madd_mottasel_len=4, madd_mottasel_waqf=4, madd_aared_len=4)
LETTER = re.compile(r"[ء-ي]")


def word_pieces(uthmani, out):
    """Each Uthmani word's phonemes (spaces removed), from the phonetizer's character mappings."""
    word, owner = 0, []
    for ch in uthmani:
        owner.append(-1 if ch == " " else word)
        word += ch == " "
    lo, hi = [None] * (word + 1), [None] * (word + 1)
    for i, mp in enumerate(out.mappings):
        w = owner[i]
        if w < 0 or mp is None:
            continue
        lo[w] = mp.pos[0] if lo[w] is None else min(lo[w], mp.pos[0])
        hi[w] = mp.pos[1] if hi[w] is None else max(hi[w], mp.pos[1])
    return ["" if a is None else out.phonemes[a:b].replace(" ", "") for a, b in zip(lo, hi)]


def main():
    pages = json.load(open(PAGES, encoding="utf-8"))
    itqan = {}
    for p in pages:
        for g in p["surahGroups"]:
            for a in g["ayahs"]:
                itqan[(a["surah"], a["ayah"])] = [w["text"] for w in a["words"]]
    problems, ayat, ph = [], {}, []
    for n, (s, a) in enumerate(sorted(itqan)):
        out = quran_phonetizer(Aya(s, a).get().uthmani, MOSHAF, sura_idx=s)
        pieces = word_pieces(Aya(s, a).get().uthmani, out)
        # A written word needs 2+ letters to count: Itqan's 5:52 has a stray space in "دَآئِرَ ةٌ".
        sizes = [max(1, len([t for t in w.split() if len(LETTER.findall(t)) >= 2])) for w in itqan[(s, a)]]
        if sum(sizes) != len(pieces):
            problems.append(f"{s}:{a}: quran-transcript has {len(pieces)} words, Itqan {len(itqan[(s, a)])}")
            continue
        merged, k = [], 0
        for size in sizes:
            merged.append("".join(pieces[k:k + size]))
            k += size
        for i, m in enumerate(merged):
            if not m:
                problems.append(f"{s}:{a} word {i + 1} has no phonemes")
        ayat[f"{s}:{a}"] = [len(ph), len(merged)]
        ph += merged
        if n % 1000 == 0:
            print(f"  {n}/{len(itqan)} ayat", flush=True)
    if problems:
        print("\n".join(problems))
        sys.exit(f"{len(problems)} problems; nothing written")
    total = sum(map(len, itqan.values()))
    assert len(ph) == total, (len(ph), total)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"v": 1, "source": "quran-transcript 0.6.4 (MIT), Hafs, madd 4/4/4/4", "ayat": ayat, "ph": ph},
                  f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {OUT}: {len(ph)} words, {len(ayat)} ayat, {os.path.getsize(OUT) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
