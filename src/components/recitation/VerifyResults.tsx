import type { WordLookup } from "@/recitation/session/words";
import type { VerifyFinding, VerifyResult } from "@/recitation/workers/engineProtocol";
import type { SurahMeta } from "@/types";

/**
 * Verify mode's results (spec §7.6): what was checked, a per-ayah summary, and each confirmed mistake. Tapping a
 * mistake opens it in the mushaf. Only mistakes the model's own scores confirmed are listed; anything
 * borderline was left out on purpose (spec §3).
 */

export const KIND_LABEL: Record<VerifyFinding["kind"], string> = {
  SKIPPED: "Skipped",
  WRONG_WORD: "Different word",
  SKIPPED_AYAH: "Skipped ayah",
  MUTASHABIH_SLIP: "Moved to a similar verse",
};

const ayahOf = (key: string) => key.split(":").slice(0, 2).join(":");

function surahName(surahs: SurahMeta[] | undefined, key: string) {
  const s = Number(key.split(":")[0]);
  return surahs?.find((x) => x.index === s)?.tname ?? `Surah ${s}`;
}

/** Which ayah a finding belongs to in the per-ayah summary: a slip counts against where the reciter should have been. */
export const findingAyah = (f: VerifyFinding) => f.ayah ?? ayahOf(f.kind === "MUTASHABIH_SLIP" && f.expected ? f.expected : f.keys[0]);

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export default function VerifyResults({
  result,
  words,
  surahs,
  onOpen,
}: {
  result: VerifyResult;
  words: WordLookup | null;
  surahs: SurahMeta[] | undefined;
  onOpen: (key: string) => void;
}) {
  if (!result.from || !result.to) {
    return <p className="text-sm text-muted">Not enough was recognised to know which passage you recited. Try reciting a little longer.</p>;
  }
  const range = result.from === result.to ? `${result.from}` : `${result.from} – ${result.to}`;
  const byAyah = new Map<string, VerifyFinding[]>();
  for (const f of result.findings) {
    const a = findingAyah(f);
    byAyah.set(a, [...(byAyah.get(a) ?? []), f]);
  }
  const text = (keys: string[]) => (words ? keys.slice(0, 6).map((k) => words.text(k)).join(" ") + (keys.length > 6 ? " …" : "") : "");

  return (
    <div className="space-y-3" data-testid="verify-results">
      <div>
        <p className="text-sm font-semibold text-ink">
          {surahName(surahs, result.from)} {range} · {result.ayat.length} {result.ayat.length === 1 ? "ayah" : "ayat"}
        </p>
        <p className="text-sm text-muted">
          {result.findings.length === 0
            ? "No mistakes found."
            : `${result.findings.length} possible ${result.findings.length === 1 ? "mistake" : "mistakes"} found.`}
        </p>
      </div>

      {result.findings.length > 0 && (
        <ul className="space-y-2">
          {result.findings.map((f, i) => {
            const target = f.keys[0];
            return (
              <li key={i}>
                <button
                  onClick={() => onOpen(target)}
                  className="w-full text-left rounded-lg border border-edge bg-card2 hover:border-edge-strong p-2.5"
                  data-testid="finding"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`px-2 py-0.5 rounded-full font-semibold ${f.kind === "MUTASHABIH_SLIP" ? "bg-purple-500/15 text-purple-500" : "bg-red-500/15 text-red-500"}`}>
                      {KIND_LABEL[f.kind]}
                    </span>
                    <span className="text-muted">{f.kind === "SKIPPED_AYAH" ? f.ayah : ayahOf(target)}</span>
                    <span className="ml-auto text-faint tabular-nums">at {mmss(f.time)}</span>
                  </div>
                  {f.kind !== "SKIPPED_AYAH" && (
                    <p dir="rtl" lang="ar" className="font-arabic text-lg leading-relaxed text-ink mt-1">
                      {text(f.keys)}
                    </p>
                  )}
                  {f.kind === "MUTASHABIH_SLIP" && f.expected && (
                    <p className="text-xs text-muted mt-0.5">
                      You were at {ayahOf(f.expected)} (<span dir="rtl" lang="ar" className="font-arabic">{words?.text(f.expected)}</span>) and moved to {ayahOf(target)}, which is similar.
                    </p>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Per ayah</summary>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {result.ayat.map((a) => {
            const n = byAyah.get(a)?.length ?? 0;
            return (
              <button
                key={a}
                onClick={() => onOpen(`${a}:1`)}
                className={`px-2 py-0.5 rounded-full border tabular-nums ${n ? "border-red-400 text-red-500" : "border-edge text-muted"}`}
              >
                {a.split(":")[1]}
                {n ? ` · ${n}` : " ✓"}
              </button>
            );
          })}
        </div>
      </details>

      <p className="text-xs text-faint">
        Only mistakes the model is confident about are shown; it can still be wrong. A study aid, not a religious ruling.
        {result.cleared > 0 && ` (${result.cleared} unclear ${result.cleared === 1 ? "spot was" : "spots were"} left out.)`}
      </p>
    </div>
  );
}
