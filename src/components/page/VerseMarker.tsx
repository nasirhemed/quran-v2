const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const toArabicDigits = (n: number) => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]);

interface VerseMarkerProps {
  ayahNumber: number;
}

export default function VerseMarker({ ayahNumber }: VerseMarkerProps) {
  return (
    <span
      className="inline-flex items-center justify-center min-w-[1.85rem] h-7 px-1 mx-1 rounded-full border border-gold/75 bg-gold/20 text-gold-text text-sm font-quran font-semibold align-middle select-none leading-none"
      aria-label={`Verse ${ayahNumber}`}
    >
      {toArabicDigits(ayahNumber)}
    </span>
  );
}
