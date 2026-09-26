/**
 * Consonant skeleton of a phoneme string (model B's Quranic phonetic script).
 *
 * Drops short vowels, sukun and shadda marks, long-vowel letters (ا ۥ ۦ), qalqala and other marks, and spaces;
 * maps the ghunna nun (ں) and iqlab meem (۾) to ن and م; collapses repeated letters. What remains is stable
 * across madd length, gemination, harakat and waqf endings, which is what the tracker and checker match on.
 */
const DROP = /[َُؙِّْـ۪ۜٲاۥۦچڇ ]/gu;

export function skeleton(phonemes: string): string {
  const s = phonemes.replace(/ں/gu, "ن").replace(/۾/gu, "م").replace(DROP, "");
  return s.replace(/(.)\1+/gu, "$1");
}
