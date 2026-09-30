import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSurahs } from "@/lib/data";
import type { SurahMeta } from "@/types";
import OfflineMushaf from "@/components/mushaf/OfflineMushaf";

const OFFLINE_DISMISSED_KEY = "offlineMushafDismissed";

interface SurahCardProps {
  surah: SurahMeta;
  onSelect: (surahIndex: number) => void;
}

function SurahCard({ surah, onSelect }: SurahCardProps) {
  return (
    <button
      onClick={() => onSelect(surah.index)}
      className="bg-surface border border-slate-700 rounded-lg p-4 hover:bg-surface-light hover:border-slate-600 transition-all text-left group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-shrink-0">
          <div className="w-10 h-10 rounded-lg bg-surface-light border border-slate-600 flex items-center justify-center text-slate-300 font-sans text-sm font-medium group-hover:border-amber-500/50 group-hover:text-amber-400 transition-colors">
            {surah.index}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-sans text-base font-medium text-slate-200 mb-0.5">
            {surah.ename}
          </h3>
          <p className="text-xs text-slate-400 font-sans">{surah.tname}</p>
          <p className="text-xs text-slate-500 font-sans mt-1">
            {surah.ayas} Ayahs
          </p>
        </div>
        <div className="flex-shrink-0" dir="rtl">
          <div className="font-arabic text-xl text-slate-200">{surah.name}</div>
        </div>
      </div>
    </button>
  );
}

interface HomePageProps {
  onNavigateToSurah: (surahIndex: number) => void;
}

export default function HomePage({ onNavigateToSurah }: HomePageProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [offlineDismissed, setOfflineDismissed] = useState(() => {
    try {
      return localStorage.getItem(OFFLINE_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const dismissOffline = () => {
    setOfflineDismissed(true);
    try {
      localStorage.setItem(OFFLINE_DISMISSED_KEY, "1");
    } catch {
      /* storage unavailable: hidden for this visit only */
    }
  };

  const { data: surahs, isLoading } = useQuery({
    queryKey: ["surahs"],
    queryFn: fetchSurahs,
  });

  const filteredSurahs = surahs?.filter((surah) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      surah.ename.toLowerCase().includes(query) ||
      surah.tname.toLowerCase().includes(query) ||
      surah.name.includes(searchQuery) ||
      surah.index.toString().includes(query)
    );
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-400 text-lg font-sans">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-sans font-bold text-slate-100 mb-2">
            Read
          </h1>
          <p className="text-slate-400 font-sans text-sm mb-6">
            Pick a surah to open the mushaf, with Mutashabihat (similar
            verses) highlighted.
          </p>

          {/* Search bar */}
          <div className="max-w-md mx-auto">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                placeholder="Search Surah..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-surface border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 font-sans focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              />
            </div>
          </div>

          {!offlineDismissed && <OfflineMushaf onDismiss={dismissOffline} />}
        </div>

        {/* Surah grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredSurahs?.map((surah) => (
            <SurahCard
              key={surah.index}
              surah={surah}
              onSelect={onNavigateToSurah}
            />
          ))}
        </div>

        {filteredSurahs?.length === 0 && (
          <div className="text-center py-12 text-slate-500 font-sans">
            No surahs found matching "{searchQuery}"
          </div>
        )}
      </div>
    </div>
  );
}
