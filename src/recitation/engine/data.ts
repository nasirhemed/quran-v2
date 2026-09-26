/**
 * The Quran data the engine works on: every mushaf word's phonemes (public/data/recitation-words.json,
 * built by scripts/build-recitation-data.py), and a model pack's symbol table for turning phonemes into the
 * model's unit ids.
 */
export interface RecitationWords {
  v: number;
  source: string;
  /** "surah:ayah" → [global idx of the ayah's first word, word count], in mushaf order */
  ayat: Record<string, [number, number]>;
  /** phonemes of each word, by global word idx (0..77428) */
  ph: string[];
}

/** A model's output symbols: `symbols[id]` is the phoneme string of unit `id`. */
export interface UnitTable {
  symbols: string[];
  blank: number;
}

export async function loadRecitationWords(): Promise<RecitationWords> {
  const res = await fetch("/data/recitation-words.json");
  if (!res.ok) throw new Error(`Failed to fetch recitation words: ${res.status}`);
  return res.json();
}

/** Word keys "s:a:w" by global idx, and the ayah key of each word. */
export function wordIndex(words: RecitationWords) {
  const key: string[] = new Array(words.ph.length);
  const ayah: string[] = new Array(words.ph.length);
  for (const [k, [first, n]] of Object.entries(words.ayat)) {
    for (let i = 0; i < n; i++) {
      key[first + i] = `${k}:${i + 1}`;
      ayah[first + i] = k;
    }
  }
  return { key, ayah };
}

/** Global idx of every word from ayah `from` to ayah `to` (inclusive, mushaf order). */
export function passageWords(words: RecitationWords, from: string, to: string): number[] {
  const first = words.ayat[from]?.[0];
  const last = words.ayat[to] ? words.ayat[to][0] + words.ayat[to][1] - 1 : undefined;
  if (first === undefined || last === undefined || last < first) throw new Error(`Bad passage ${from}–${to}`);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

/**
 * Unit ids of each word, as the model hears them: the whole ayah's phonemes split by greedy longest match
 * over the symbol table, each unit given to the word holding its first letter (a unit can straddle two words
 * joined in recitation). Same as the M0b prototype's build_units_b.py.
 */
export function wordUnits(words: RecitationWords, table: UnitTable, ayahKey: string): number[][] {
  const [first, n] = words.ayat[ayahKey];
  const byLength = table.symbols
    .map((sym, id) => ({ sym, id }))
    .filter((u) => u.id !== table.blank && u.sym.length > 0)
    .sort((a, b) => b.sym.length - a.sym.length);
  let text = "";
  const owner: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = words.ph[first + i];
    text += p;
    for (let c = 0; c < p.length; c++) owner.push(i);
  }
  const out: number[][] = Array.from({ length: n }, () => []);
  let pos = 0;
  while (pos < text.length) {
    const u = byLength.find((x) => text.startsWith(x.sym, pos));
    if (!u) throw new Error(`${ayahKey}: no unit matches at "${text.slice(pos, pos + 6)}"`);
    out[owner[pos]].push(u.id);
    pos += u.sym.length;
  }
  return out;
}
