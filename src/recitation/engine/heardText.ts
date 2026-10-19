/**
 * Model A hears words, written in imlaei spelling with harakat (اللَّهُ لَا إِلَهَ إِلَّا هُوَ); the tracker
 * matches on the consonant skeleton of what is pronounced (skeleton.ts, from model B's phonemes). This turns the
 * one into the other, so Follow mode, voice search and Memorize work unchanged with either model:
 * - hamza on any seat is ء; alef, alef maqsura and dagger alef are dropped (vowels);
 * - the article's lam is dropped before a sun letter (it carries no sukun and the next letter has a shadda);
 * - و after a damma and ي after a kasra, with no mark of their own, are long vowels and dropped;
 * - tanween is a ن, dropped at a stop; a noon with no vowel becomes م before ب (iqlab) and is merged into a
 *   following word that starts with ي ر م ل و ن (idgham);
 * - ة is ت, or ه at a stop; the disjoined letters (الم, حم, يس…) are spelled as recited (ءلف لم م).
 * Measured on Quran-Lab's text→phoneme table (9,112 verse texts): 0.1% of skeleton letters differ.
 *
 * Without harakat (the model sometimes drops them) the long vowels stay, which the tracker's fuzzy match absorbs.
 */
const HARAKA = new Set(["َ", "ُ", "ِ"]); // fatha damma kasra
const TANWEEN = new Set(["ً", "ٌ", "ٍ"]);
const SUKUN = "ْ";
const SHADDA = "ّ";
const MARKS = new Set([...HARAKA, ...TANWEEN, SUKUN, SHADDA, "ٰ", "ـ"]); // + dagger alef, tatweel
const IDGHAM = new Set([..."يرملون"]);
const DISJOINED: Record<string, string> = { ا: "ءلف", ل: "لم", م: "م", ص: "صد", ر: "ر", ك: "كف", ه: "ه", ي: "ي", ع: "عين", س: "سن", ق: "قف", ن: "ن", ح: "ح", ط: "ط" };
const DISJOINED_WORDS = new Set(["الم", "المص", "الر", "المر", "كهيعص", "طه", "طسم", "طس", "يس", "ص", "حم", "عسق", "ق", "ن"]);

const normalize = (w: string) => w.replace(/آ/g, "ءَا").replace(/[أإؤئ]/g, "ء").replace(/ى/g, "ا");

/** First consonant of a word as it would be read after a pause in the previous word (for idgham and iqlab). */
function firstLetter(w: string): string {
  for (const c of normalize(w)) if (!MARKS.has(c) && c !== "ا") return c;
  return "";
}

/** One word's skeleton letters; `next` is the following word's first letter, `stop` whether it ends at a pause. */
function wordLetters(word: string, next: string | null, stop: boolean): string {
  if (DISJOINED_WORDS.has(word)) return [...word].map((c) => DISJOINED[c]).join("").replace(/نم/g, "م");
  const toks: { c: string; m: string }[] = [];
  for (const c of normalize(word)) {
    if (MARKS.has(c)) {
      if (toks.length) toks[toks.length - 1].m += c;
    } else toks.push({ c, m: "" });
  }
  const has = (m: string, set: Set<string>) => [...m].some((x) => set.has(x));
  const vowelled = (m: string) => has(m, HARAKA) || has(m, TANWEEN) || m.includes(SUKUN) || m.includes(SHADDA);
  let out = "";
  toks.forEach(({ c: letter, m }, i) => {
    let c = letter;
    const prev = toks[i - 1];
    const nx = toks[i + 1];
    const last = i === toks.length - 1;
    if (c === "ا") return;
    // ta marbuta: ت, or ه at a stop (not with fathatan, which is read تَا)
    if (c === "ة") c = stop && last && !m.includes("\u064B") ? "ه" : "ت";
    if (c === "ل" && !vowelled(m) && nx?.m.includes(SHADDA) && prev?.c === "ا") return; // sun letter
    if (c === "و" && !vowelled(m) && prev?.m.includes("ُ")) return; // long u
    if (c === "ي" && !vowelled(m) && prev?.m.includes("ِ")) return; // long i
    if (c === "ن" && !has(m, HARAKA) && !has(m, TANWEEN) && !m.includes(SHADDA)) {
      if (nx?.c === "ب" || (last && next === "ب")) {
        out += "م";
        return;
      }
      if (last && next && IDGHAM.has(next)) return;
    }
    out += c;
    if (has(m, TANWEEN) && !stop) {
      if (next === "ب") out += "م";
      else if (!next || !IDGHAM.has(next)) out += "ن";
    }
  });
  return out;
}

const collapse = (s: string) => s.replace(/(.)\1+/gu, "$1");

/** The skeleton of a whole text, its last word at a stop. */
export function textSkeleton(text: string): string {
  const ws = text.split(/\s+/).filter(Boolean);
  return collapse(ws.map((w, i) => wordLetters(w, i + 1 < ws.length ? firstLetter(ws[i + 1]) : null, i === ws.length - 1)).join(""));
}

/**
 * The streaming form: model A's pieces (a leading space starts a word) in, skeleton letters out. A word is
 * released once the next one starts, since how it ends depends on what follows; a step that brings nothing new
 * (a pause: model A steps are 1.12 s) releases the held word as ending at a stop.
 */
export class HeardText {
  private held = "";

  push(pieces: string[]): string {
    const added = pieces.join("");
    if (!added) return this.flush();
    const words = (this.held + added).split(" ");
    this.held = words.pop()!;
    // a word that ended where a new one starts in `held` is complete; empty strings are the spaces themselves
    const complete = words.filter(Boolean);
    const next = this.held ? firstLetter(this.held) : null;
    return complete.map((w, i) => wordLetters(w, i + 1 < complete.length ? firstLetter(complete[i + 1]) : next, false)).join("");
  }

  /** Releases the held word as ending at a stop. */
  flush(): string {
    const w = this.held;
    this.held = "";
    return w ? wordLetters(w, null, true) : "";
  }

  reset() {
    this.held = "";
  }
}
