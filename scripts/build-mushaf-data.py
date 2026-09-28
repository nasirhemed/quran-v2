"""Build the mushaf the reader draws (QCF V2: the 1421H Madinah print, as on quran.com) and its font pack.

Sources, as quran.com itself uses them: its verses API with mushaf=1 (QCF V2), which gives per page the ayahs,
each word's glyph codes and printed line, and the ayah-number ornaments; and the QCF V2 page fonts plus the
surah-name font from quran.com's font host. Both are the King Fahd Glorious Qur'an Printing Complex's work.
(The public api.quran.com v4 by_page endpoint is NOT used: it paginates by the older 1405H print and gives some
words glyphs of the wrong page's font, e.g. pages 121-123, 144, 599.)

Rewrites public/data/quran-pages.json (minified) on the 1421H pages, keeping each ayah's words and text as they
are (joined on (surah, ayah) and word position, failing loudly on any mismatch), and adds:
  word.glyph        glyph codes: draw them with the page's font (src/lib/mushaf/pack.ts)
  word.lineNumber   the word's printed line
  ayah.end          {glyph, lineNumber}: the ayah-number ornament, which can open the next line
  page.lines        one entry per printed line, top to bottom: {"kind": "surah", "surah": n} (header),
                    {"kind": "bismillah"} or {"kind": "text"}, plus "centered": true for the short lines the print
                    centres (from the fonts' own advance widths). A header can sit at the foot of the page before
                    its surah (e.g. Sad's is page 452's line 15).
Updates startPage in public/data/surahs.json and juz-metadata.json, and each page's juz, to the same pages.
Writes the font pack, laid out as it is hosted:
  <pack dir>/qcf-v2/1/p1.woff2 … p604.woff2, surah-names.woff2, manifest.json
  public/data/mushaf-fonts.json   the same manifest, shipped with the app
and prints the widest line in em, for LINE_WIDTH_EM in src/lib/mushaf/pack.ts.

Usage:  pip install fonttools brotli && python scripts/build-mushaf-data.py <pack dir> [--cache <dir>]
        then  npm run upload-models -- <pack dir>/qcf-v2/1 qcf-v2
Downloads are cached (API responses under --cache, default .mushaf-cache/; fonts in the pack dir), so a rerun
only fetches what is missing. Rerunning on its own output gives the same files.
"""
import argparse
import hashlib
import json
import os
import sys
import time
import urllib.request

from fontTools.ttLib import TTFont

DATA = "public/data"
PAGES, SURAHS, JUZS = f"{DATA}/quran-pages.json", f"{DATA}/surahs.json", f"{DATA}/juz-metadata.json"
APP_MANIFEST = f"{DATA}/mushaf-fonts.json"
PACK_ID, PACK_VERSION = "qcf-v2", "1"
PAGE_COUNT, LINES = 604, 15
API = (
    "https://api.qurancdn.com/api/qdc/verses/by_page/{page}?words=true&per_page=all&filter_page_words=true"
    "&mushaf=1&word_fields=verse_key,position,char_type_name,code_v2,line_number,v2_page,page_number,text_uthmani"
)
FONT_HOST = "https://verses.quran.foundation/fonts/quran"
PAGE_FONT = FONT_HOST + "/hafs/v2/woff2/p{page}.woff2"
SURAH_NAMES_FONT = FONT_HOST + "/surah-names/v1/sura_names.woff2"
BISMILLAH = "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ"
NO_BISMILLAH = {1, 9}  # al-Fatiha's bismillah is its first ayah; at-Tawba has none
# Pages 1-2 (al-Fatiha, the opening of al-Baqara) are ornamental: 8 short lines, all centred. The source numbers
# them 8-15; they are stored as 1-8.
ORNAMENTAL = {1: 8, 2: 8}
LINE_OFFSET = {1: 7, 2: 7}
# A line narrower than this share of a full line is centred, as the print does (full lines are 97-100%).
CENTER_BELOW = 0.8
# No printed line is wider than this share of a full line; wider means the source misplaced a word.
WIDEST = 1.04
# Source errors, found by the width check: (surah, ayah, word position) -> printed line.
LINE_FIXES = {
    # page 27: the source has it on line 14, 1.1 full lines wide, leaving line 15 short by exactly this word
    (2, 181, 5): 15,
}


def fetch(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "itqan-build-mushaf-data"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            tmp = dest + ".tmp"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, dest)
            return
        except Exception as e:  # network hiccup: back off and retry
            if attempt == 5:
                raise RuntimeError(f"{url}: {e}")
            time.sleep(2**attempt)


def key_of(w):
    s, a = map(int, w["verse_key"].split(":"))
    return s, a, w["position"]


def arabic_number(n):
    return "".join(chr(0x660 + int(d)) for d in str(n))


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def line_widths(font_path, placed):
    """Each text line's width in em: the sum of its glyphs' advances (what the browser lays out)."""
    font = TTFont(font_path)
    cmap, hmtx, upm = font.getBestCmap(), font["hmtx"], font["head"].unitsPerEm
    missing = {c for glyph, _ in placed for c in glyph if ord(c) not in cmap and c != " "}
    if missing:
        raise ValueError(f"{font_path} has no glyph for {sorted(hex(ord(c)) for c in missing)}")
    # The space between a rub' al-hizb mark (۞) and its word has no glyph here: the browser takes it from a
    # fallback font, about a quarter em.
    advance = lambda c: hmtx[cmap[ord(c)]][0] / upm if ord(c) in cmap else 0.25
    widths = {}
    for glyph, line in placed:
        widths[line] = widths.get(line, 0) + sum(advance(c) for c in glyph)
    return widths


def dump(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pack_dir")
    ap.add_argument("--cache", default=".mushaf-cache")
    args = ap.parse_args()
    pack = os.path.join(args.pack_dir, PACK_ID, PACK_VERSION)
    os.makedirs(pack, exist_ok=True)
    os.makedirs(args.cache, exist_ok=True)

    old_pages = json.load(open(PAGES, encoding="utf-8"))
    surahs = json.load(open(SURAHS, encoding="utf-8"))
    juzs = json.load(open(JUZS, encoding="utf-8"))
    order = [(a["surah"], a["ayah"]) for p in old_pages for g in p["surahGroups"] for a in g["ayahs"]]
    words_of = {(a["surah"], a["ayah"]): a["words"] for p in old_pages for g in p["surahGroups"] for a in g["ayahs"]}
    old_page_of = {(a["surah"], a["ayah"]): p["pageNumber"] for p in old_pages for g in p["surahGroups"] for a in g["ayahs"]}
    meta = {s["index"]: s for s in surahs}

    api = {}
    for n in range(1, PAGE_COUNT + 1):
        dest = os.path.join(args.cache, f"qdc-page-{n}.json")
        fetch(API.format(page=n), dest)
        data = json.load(open(dest, encoding="utf-8"))
        if data["pagination"]["total_pages"] != 1:
            sys.exit(f"page {n}: more verses than one API page holds")
        api[n] = data["verses"]
        fetch(PAGE_FONT.format(page=n), os.path.join(pack, f"p{n}.woff2"))
        if n % 100 == 0 or n == PAGE_COUNT:
            print(f"fetched {n}/{PAGE_COUNT} pages")
    fetch(SURAH_NAMES_FONT, os.path.join(pack, "surah-names.woff2"))

    problems, text_diffs = [], 0
    pages, page_of = [], {}
    extra = {}  # (page, line) -> header or bismillah line; it may fall on the previous page
    widths = {}
    for n in range(1, PAGE_COUNT + 1):
        groups, placed = [], []
        line_of = lambda w: LINE_FIXES.get(key_of(w), w["line_number"]) - LINE_OFFSET.get(n, 0)
        for v in api[n]:
            s, a = map(int, v["verse_key"].split(":"))
            ours = words_of.get((s, a))
            items = v["words"]
            # The source labels a few ornaments as words (2:181's "١٨١"): the ayah's number in Arabic-Indic digits.
            if items and items[-1]["char_type_name"] == "word" and items[-1]["text_uthmani"] == arabic_number(a):
                items = items[:-1] + [{**items[-1], "char_type_name": "end"}]
            words = [w for w in items if w["char_type_name"] == "word"]
            ends = [w for w in items if w["char_type_name"] == "end"]
            other = [w for w in items if w["char_type_name"] not in ("word", "end")]
            if ours is None or len(words) != len(ours) or len(ends) != 1 or other:
                problems.append(f"{s}:{a}: {len(ours or [])} words here, API has {len(words)} (+{len(ends)} end, {len(other)} other)")
                continue
            if any(w["page_number"] != n or w["v2_page"] != n for w in items):
                problems.append(f"{s}:{a}: words on another page than {n}")
            out = []
            for o, w in zip(ours, words):
                if w["position"] != o["position"]:
                    problems.append(f"{s}:{a}:{o['position']}: position mismatch")
                text_diffs += w["text_uthmani"] != o["text"]
                out.append({"text": o["text"], "glyph": w["code_v2"], "lineNumber": line_of(w), "position": o["position"]})
                placed.append((w["code_v2"], line_of(w)))
            end = ends[0]
            placed.append((end["code_v2"], line_of(end)))
            ayah = {"surah": s, "ayah": a, "words": out, "end": {"glyph": end["code_v2"], "lineNumber": line_of(end)}}
            page_of[(s, a)] = n
            if not groups or groups[-1]["surahIndex"] != s:
                start = a == 1
                groups.append({
                    "surahIndex": s,
                    "surahName": meta[s]["name"],
                    "tname": meta[s]["tname"],
                    "isSurahStart": start,
                    "bismillah": BISMILLAH if start and s not in NO_BISMILLAH else None,
                    "ayahs": [],
                })
            groups[-1]["ayahs"].append(ayah)
            if a == 1:
                first = line_of(words[0])
                above = [("bismillah", None)] if s not in NO_BISMILLAH else []
                above.append(("surah", s))
                for i, (kind, surah) in enumerate(above, start=1):
                    line, on = first - i, n
                    if line < 1:  # the print puts it at the foot of the previous page
                        on, line = n - 1, line + LINES
                    extra[(on, line)] = {"kind": kind, **({"surah": surah} if surah else {})}
        try:
            widths[n] = line_widths(os.path.join(pack, f"p{n}.woff2"), placed)
        except ValueError as e:
            problems.append(str(e))
        pages.append({"pageNumber": n, "juz": 0, "surahGroups": groups})

    if [k for p in pages for g in p["surahGroups"] for k in ((a["surah"], a["ayah"]) for a in g["ayahs"])] != order:
        problems.append("the pages do not hold every ayah exactly once, in order")
    if problems:
        sys.exit("Mismatches with the API:\n  " + "\n  ".join(problems[:40]))

    # Page numbers of surah and juz starts, and each page's juz, as the legacy build defined them.
    for s in surahs:
        s["startPage"] = page_of[(s["index"], 1)]
    for j in juzs:
        j["startPage"] = page_of[(j["sura"], j["aya"])]
    for p in pages:
        p["juz"] = max(j["index"] for j in juzs if j["startPage"] <= p["pageNumber"])

    # A full line's width: the median of each page's widest line (pages 3+, where lines are justified).
    justified = {n: w for n, w in widths.items() if n not in ORNAMENTAL}
    full = sorted(max(w.values()) for w in justified.values())[len(justified) // 2]
    widest = max(x for w in justified.values() for x in w.values())
    too_wide = [f"page {n} line {line}: {x / full:.2f} of a full line" for n, w in justified.items() for line, x in w.items() if x > WIDEST * full]
    if too_wide:
        sys.exit("Lines wider than the print allows (a word on the wrong line? add it to LINE_FIXES):\n  " + "\n  ".join(too_wide))
    centered = 0
    for p in pages:
        n = p["pageNumber"]
        count = ORNAMENTAL.get(n, LINES)
        lines = []
        for line in range(1, count + 1):
            if (n, line) in extra:
                if line in widths[n]:
                    sys.exit(f"page {n} line {line}: both text and a {extra[(n, line)]['kind']} line")
                lines.append(extra[(n, line)])
            elif line in widths[n]:
                entry = {"kind": "text"}
                if n in ORNAMENTAL or widths[n][line] < CENTER_BELOW * full:
                    entry["centered"] = True
                    centered += n not in ORNAMENTAL
                lines.append(entry)
            else:
                sys.exit(f"page {n} line {line}: nothing is printed on it")
        if max(widths[n]) > count or any(line > count for (q, line) in extra if q == n):
            sys.exit(f"page {n}: lines past {count}")
        p["lines"] = lines

    dump(PAGES, pages)
    dump(SURAHS, surahs)
    dump(JUZS, juzs)

    names = [f"p{n}.woff2" for n in range(1, PAGE_COUNT + 1)] + ["surah-names.woff2"]
    manifest = {
        "id": PACK_ID,
        "version": PACK_VERSION,
        "source": "QCF V2 page fonts and surah-name font, King Fahd Glorious Qur'an Printing Complex, via quran.com",
        "files": [
            {"name": name, "bytes": os.path.getsize(os.path.join(pack, name)), "sha256": sha256(os.path.join(pack, name))}
            for name in names
        ],
    }
    for dest in (os.path.join(pack, "manifest.json"), APP_MANIFEST):
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(manifest, f, separators=(",", ":"))
            f.write("\n")

    moved = sum(page_of[k] != old_page_of[k] for k in order)
    total = sum(f["bytes"] for f in manifest["files"])
    print(f"quran-pages.json: {os.path.getsize(PAGES) / 1e6:.2f} MB; {moved} ayahs moved page; "
          f"{text_diffs} words whose API text differs (kept ours)")
    print(f"{centered} centred lines outside pages 1-2; full line {full:.2f} em, widest {widest:.2f} em (LINE_WIDTH_EM)")
    print(f"pack: {len(names)} fonts, {total / 1e6:.1f} MB in {pack}")


if __name__ == "__main__":
    main()
