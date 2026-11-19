const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const toArabicDigits = (n: number) => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]);

interface VerseMarkerProps {
  ayahNumber: number;
}

export default function VerseMarker({ ayahNumber }: VerseMarkerProps) {
  return (
    <span
      className="inline-flex items-center justify-center min-w-[1.8rem] h-7 px-1 mx-1 rounded-full border border-gold/50 bg-gold-soft text-gold-text text-sm font-quran align-middle select-none leading-none"
      aria-label={`Verse ${ayahNumber}`}
    >
      {toArabicDigits(ayahNumber)}
    </span>
  );
}
