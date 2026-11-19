import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { fetchJuzMetadata, fetchSurahs } from "@/lib/data";
import { loadLastRead } from "@/lib/lastRead";
import type { JuzMeta, SurahMeta } from "@/types";
import OfflineMushaf from "@/components/mushaf/OfflineMushaf";
import SurahName from "@/components/SurahName";

const OFFLINE_DISMISSED_KEY = "offlineMushafDismissed";

type BrowseTab = "surahs" | "juz";

interface SurahCardProps {
  surah: SurahMeta;
  onSelect: (surahIndex: number) => void;
}

function SurahCard({ surah, onSelect }: SurahCardProps) {
  return (
    <button
      onClick={() => onSelect(surah.index)}
      className="bg-card border border-edge rounded-2xl p-4 shadow-card hover:shadow-card-hover hover:border-primary/45 hover:-translate-y-0.5 transition-all text-left group"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 shrink-0 rounded-xl bg-card2 text-ink-soft font-sans text-sm font-semibold tabular-nums flex items-center justify-center group-hover:bg-primary-soft group-hover:text-primary transition-colors">
            {surah.index}
          </div>
          <div className="min-w-0">
            <h3 className="font-sans text-[15px] font-semibold text-ink truncate group-hover:text-primary transition-colors">
              {surah.tname}
            </h3>
            <p className="text-xs text-muted font-sans truncate">{surah.ename}</p>
            <p className="text-[11px] text-faint font-sans mt-0.5">
              {surah.ayas} {surah.ayas === 1 ? "verse" : "verses"}
            </p>
          </div>
        </div>
        <div className="shrink-0 pl-1" dir="rtl">
          <SurahName surah={surah.index} name={surah.name} className="text-2xl text-ink-soft group-hover:text-ink transition-colors" />
        </div>
      </div>
    </button>
  );
}

function JuzCard({ juz, surah }: { juz: JuzMeta; surah?: SurahMeta }) {
  return (
    <Link
      href={`/read?juz=${juz.index}`}
      className="flex items-center justify-between gap-3 bg-card border border-edge rounded-2xl p-4 shadow-card hover:shadow-card-hover hover:border-primary/45 hover:-translate-y-0.5 transition-all group"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 shrink-0 rounded-xl bg-card2 text-ink-soft font-sans text-sm font-semibold tabular-nums flex items-center justify-center group-hover:bg-primary-soft group-hover:text-primary transition-colors">
          {juz.index}
        </div>
        <div className="min-w-0">
          <div className="font-sans text-[15px] font-semibold text-ink group-hover:text-primary transition-colors">
            Juz {juz.index}
          </div>
          <div className="text-xs text-muted truncate">
            {surah ? `${surah.tname} ${juz.sura}:${juz.aya}` : `${juz.sura}:${juz.aya}`}
          </div>
        </div>
      </div>
      <div className="shrink-0 text-right">
        {surah && (
          <div dir="rtl">
            <SurahName surah={surah.index} name={surah.name} className="text-lg text-ink-soft" />
          </div>
        )}
        <div className="text-[11px] text-faint font-sans">Page {juz.startPage}</div>
      </div>
    </Link>
  );
}

interface HomePageProps {
  onNavigateToSurah: (surahIndex: number) => void;
}

export default function HomePage({ onNavigateToSurah }: HomePageProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState<BrowseTab>("surahs");
  const [lastRead] = useState(() => loadLastRead());
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
  const { data: juzs } = useQuery({
    queryKey: ["juz-metadata"],
    queryFn: fetchJuzMetadata,
  });

  const surahByIndex = useMemo(() => {
    const map = new Map<number, SurahMeta>();
    for (const s of surahs ?? []) map.set(s.index, s);
    return map;
  }, [surahs]);

  const trimmed = searchQuery.trim();
  const pageJump = /^\d+$/.test(trimmed) && Number(trimmed) >= 1 && Number(trimmed) <= 604 ? Number(trimmed) : null;

  const filteredSurahs = surahs?.filter((surah) => {
    if (!trimmed) return true;
    const query = trimmed.toLowerCase();
    return (
      surah.ename.toLowerCase().includes(query) ||
      surah.tname.toLowerCase().includes(query) ||
      surah.name.includes(trimmed) ||
      surah.index.toString().includes(query)
    );
  });

  const filteredJuzs = juzs?.filter((juz) => {
    if (!trimmed) return true;
    const query = trimmed.toLowerCase();
    const s = surahByIndex.get(juz.sura);
    return (
      juz.index.toString().includes(query) ||
      `juz ${juz.index}`.includes(query) ||
      (s?.tname.toLowerCase().includes(query) ?? false) ||
      (s?.ename.toLowerCase().includes(query) ?? false) ||
      (s?.name.includes(trimmed) ?? false)
    );
  });

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="max-w-md mx-auto h-12 rounded-2xl bg-card2 animate-pulse mb-8" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-card border border-edge animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 pt-8 pb-24">
        {/* Header */}
        <div className="text-center mb-7">
          <h1 className="text-3xl sm:text-4xl font-sans font-bold tracking-tight text-ink mb-2">
            Read
          </h1>
          <p className="text-muted font-sans text-sm sm:text-[15px] max-w-lg mx-auto">
            Open the mushaf with Mutashabihat highlighted — tap any colored phrase to compare similar verses.
          </p>
        </div>

        {/* Continue reading card */}
        {lastRead && (
          <div className="max-w-xl mx-auto mb-5">
            <Link
              href={`/read?page=${lastRead.page}`}
              className="flex items-center justify-between gap-4 rounded-2xl border border-primary/30 bg-card px-4 py-3.5 shadow-card hover:shadow-card-hover hover:border-primary/60 transition-all group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                    />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                    Continue reading
                  </div>
                  <div className="text-sm sm:text-[15px] font-semibold text-ink truncate">
                    {lastRead.tname} · Page {lastRead.page}
                    <span className="font-normal text-muted"> · Juz {lastRead.juz}</span>
                  </div>
                </div>
              </div>
              <span className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary text-on-primary text-xs font-semibold group-hover:opacity-90 transition-opacity">
                Resume
                <span aria-hidden>→</span>
              </span>
            </Link>
          </div>
        )}

        {/* Search + Surahs/Juz toggle */}
        <div className="max-w-xl mx-auto mb-6 space-y-3">
          <div className="relative">
            <svg
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-faint pointer-events-none"
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
              dir="auto"
              placeholder="Search surah, number, or page (1–604)…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-card border border-edge rounded-2xl shadow-card pl-10 pr-10 py-3 text-sm sm:text-[15px] text-ink placeholder-faint font-sans focus:outline-none focus:border-primary transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full text-muted hover:text-ink hover:bg-card2 flex items-center justify-center transition-colors"
              >
                ×
              </button>
            )}
          </div>

          {pageJump && (
            <Link
              href={`/read?page=${pageJump}`}
              className="flex items-center justify-between rounded-xl border border-primary/35 bg-primary-soft/70 px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary-soft transition-colors"
            >
              <span>Open Mushaf Page {pageJump}</span>
              <span aria-hidden>→</span>
            </Link>
          )}

          <div className="flex items-center justify-center">
            <div
              className="inline-flex rounded-full border border-edge bg-card2/80 p-1 gap-1"
              role="tablist"
              aria-label="Browse by"
            >
              <button
                role="tab"
                aria-selected={tab === "surahs"}
                onClick={() => setTab("surahs")}
                className={`px-4 py-1.5 rounded-full text-sm transition-all ${
                  tab === "surahs"
                    ? "bg-card text-ink font-semibold shadow-sm"
                    : "text-muted hover:text-ink font-medium"
                }`}
              >
                Surahs <span className="text-xs text-faint font-normal ml-0.5">114</span>
              </button>
              <button
                role="tab"
                aria-selected={tab === "juz"}
                onClick={() => setTab("juz")}
                className={`px-4 py-1.5 rounded-full text-sm transition-all ${
                  tab === "juz"
                    ? "bg-card text-ink font-semibold shadow-sm"
                    : "text-muted hover:text-ink font-medium"
                }`}
              >
                Juz <span className="text-xs text-faint font-normal ml-0.5">30</span>
              </button>
            </div>
          </div>

          {!offlineDismissed && <OfflineMushaf onDismiss={dismissOffline} className="mt-2" />}
        </div>

        {/* Grid */}
        {tab === "surahs" ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filteredSurahs?.map((surah) => (
                <SurahCard key={surah.index} surah={surah} onSelect={onNavigateToSurah} />
              ))}
            </div>
            {filteredSurahs?.length === 0 && (
              <div className="text-center py-14 text-muted font-sans text-sm">
                No surahs found matching &ldquo;{searchQuery}&rdquo;
              </div>
            )}
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filteredJuzs?.map((juz) => (
                <JuzCard key={juz.index} juz={juz} surah={surahByIndex.get(juz.sura)} />
              ))}
            </div>
            {filteredJuzs?.length === 0 && (
              <div className="text-center py-14 text-muted font-sans text-sm">
                No Juz found matching &ldquo;{searchQuery}&rdquo;
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
