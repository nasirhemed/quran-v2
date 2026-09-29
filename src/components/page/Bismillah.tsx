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
    <div
      className="w-full text-center font-arabic text-2xl text-slate-300 my-4 py-3 px-6 rounded-lg border border-slate-700 leading-loose"
      dir="rtl"
    >
      {BISMILLAH}
    </div>
  );
}
