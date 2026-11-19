const BISMILLAH = "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ";

interface BismillahProps {
  /** page 1's glyphs for 1:1, drawn with `fontFamily` in one printed line */
  glyphs?: string[];
  fontFamily?: string;
}

export default function Bismillah({ glyphs, fontFamily }: BismillahProps) {
  if (glyphs && fontFamily) {
    return (
      <div className="mushaf-line justify-center gap-[0.3em]" style={{ fontFamily: `"${fontFamily}"` }} data-copy={BISMILLAH}>
        {glyphs.map((g, i) => (
          <span key={i} aria-hidden="true">
            {g}
          </span>
        ))}
        <span className="sr-only">{BISMILLAH}</span>
      </div>
    );
  }
  return (
    <div className="w-full my-4 flex items-center justify-center gap-4" dir="rtl">
      <span className="h-px flex-1 max-w-[4.5rem] bg-gold/40" aria-hidden />
      <span className="font-quran text-2xl sm:text-[1.75rem] text-ink-soft leading-loose">{BISMILLAH}</span>
      <span className="h-px flex-1 max-w-[4.5rem] bg-gold/40" aria-hidden />
    </div>
  );
}
