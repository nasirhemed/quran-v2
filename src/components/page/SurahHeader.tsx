import { SURAH_NAMES_FAMILY, surahNameLigature } from "@/lib/mushaf/pack";

interface SurahHeaderProps {
  surahName: string;
  tname: string;
  surahIndex: number;
  /** draw the name from the mushaf's surah-name font, in one printed line */
  glyphs?: boolean;
}

export default function SurahHeader({ surahName, tname, surahIndex, glyphs }: SurahHeaderProps) {
  if (glyphs) {
    return (
      <div className="mushaf-line justify-center">
        <div className="surah-frame" title={tname}>
          <span aria-hidden="true" className="select-none" style={{ fontFamily: `"${SURAH_NAMES_FAMILY}"` }}>
            {surahNameLigature(surahIndex)}
          </span>
          <span className="sr-only">سورة {surahName}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="w-full my-6 text-center">
      <div className="font-arabic text-3xl text-amber-200 mb-2">{surahName}</div>
      <div className="text-base text-slate-300 font-sans">{tname}</div>
    </div>
  );
}
