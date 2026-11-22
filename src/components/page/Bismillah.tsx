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
    <div className="w-full my-1.5 flex items-center justify-center gap-3" dir="rtl">
      <span className="h-px flex-1 max-w-[3.5rem] bg-gold/45" aria-hidden />
      <span className="font-quran text-xl sm:text-2xl text-ink leading-snug">{BISMILLAH}</span>
      <span className="h-px flex-1 max-w-[3.5rem] bg-gold/45" aria-hidden />
    </div>
  );
}
