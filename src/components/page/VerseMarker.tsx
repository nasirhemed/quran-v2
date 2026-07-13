interface VerseMarkerProps {
  ayahNumber: number;
}

export default function VerseMarker({ ayahNumber }: VerseMarkerProps) {
  return (
    <span
      className="inline-flex items-center justify-center w-8 h-8 mx-1 rounded-full border border-slate-500 text-slate-400 text-xs font-sans align-middle select-none"
      dir="ltr"
    >
      {ayahNumber}
    </span>
  );
}
