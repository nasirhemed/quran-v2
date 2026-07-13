interface SurahHeaderProps {
  surahName: string;
  tname: string;
  surahIndex: number;
}

export default function SurahHeader({ surahName, tname, surahIndex }: SurahHeaderProps) {
  return (
    <div className="w-full my-6 text-center">
      <div className="font-arabic text-3xl text-amber-200 mb-2">{surahName}</div>
      <div className="text-base text-slate-300 font-sans">{tname}</div>
    </div>
  );
}
