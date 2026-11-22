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
      type="button"
      onClick={() => onSelect(surah.index)}
      className="bg-card border border-edge/80 rounded-xl px-3.5 py-3 hover:border-edge-strong hover:bg-card2/35 transition-colors text-left group"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-8 h-8 shrink-0 rounded-lg bg-card2/80 text-muted font-sans text-xs font-semibold tabular-nums flex items-center justify-center group-hover:bg-primary-soft group-hover:text-primary transition-colors">
            {surah.index}
          </span>
          <div className="min-w-0">
            <h3 className="font-sans text-sm font-semibold text-ink truncate group-hover:text-primary transition-colors">
              {surah.tname}
            </h3>
            <p className="text-xs text-muted font-sans truncate">
              {surah.ename} · {surah.ayas} {surah.ayas === 1 ? "ayah" : "ayat"}
            </p>
          </div>
        </div>
        <div className="shrink-0 pl-1" dir="rtl">
          <SurahName surah={surah.index} name={surah.name} className="text-xl text-ink-soft group-hover:text-ink transition-colors" />
        </div>
      </div>
    </button>
  );
}

function JuzCard({ juz, surah }: { juz: JuzMeta; surah?: SurahMeta }) {
  return (
    <Link
      href={`/read?juz=${juz.index}`}
      className="flex items-center justify-between gap-3 bg-card border border-edge/80 rounded-xl px-3.5 py-3 hover:border-edge-strong hover:bg-card2/35 transition-colors group"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="w-8 h-8 shrink-0 rounded-lg bg-card2/80 text-muted font-sans text-xs font-semibold tabular-nums flex items-center justify-center group-hover:bg-primary-soft group-hover:text-primary transition-colors">
          {juz.index}
        </span>
        <div className="min-w-0">
          <div className="font-sans text-sm font-semibold text-ink group-hover:text-primary transition-colors">
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
        <div className="text-[11px] text-faint font-sans tabular-nums">p. {juz.startPage}</div>
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
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="max-w-md mx-auto h-10 rounded-xl bg-card2 animate-pulse mb-8" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="h-16 rounded-xl bg-card border border-edge/80 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto w-full px-4 pt-6 sm:pt-8 pb-24">
      {/* Compact Header & Controls */}
      <div className="max-w-xl mx-auto mb-6 space-y-3">
        <div className="text-center mb-4">
          <h1 className="text-2xl sm:text-3xl font-sans font-semibold tracking-tight text-ink">
            Read
          </h1>
          <p className="text-muted font-sans text-xs sm:text-sm mt-1">
            Madinah Mushaf with Mutashabihat highlights — tap any colored phrase to compare.
          </p>
        </div>

        {/* Continue reading bar */}
        {lastRead && (
          <Link
            href={`/read?page=${lastRead.page}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-edge/80 bg-card px-3.5 py-2.5 hover:border-primary/50 transition-colors group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-2 h-2 rounded-full bg-gold shrink-0" aria-hidden />
              <div className="min-w-0">
                <div className="text-xs text-muted">Continue reading</div>
                <div className="text-sm font-semibold text-ink truncate">
                  {lastRead.tname} · Page {lastRead.page}
                  <span className="font-normal text-muted"> · Juz {lastRead.juz}</span>
                </div>
              </div>
            </div>
            <span className="shrink-0 px-3 py-1 rounded-lg bg-primary text-on-primary text-xs font-semibold group-hover:opacity-90 transition-opacity">
              Resume
            </span>
          </Link>
        )}

        {/* Search + Surahs/Juz toggle */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint pointer-events-none"
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
              placeholder="Search surah or page (1–604)…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-card border border-edge/80 rounded-xl pl-9 pr-8 py-2 text-sm text-ink placeholder-faint font-sans focus:outline-none focus:border-primary transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md text-muted hover:text-ink hover:bg-card2 flex items-center justify-center transition-colors"
              >
                ×
              </button>
            )}
          </div>

          <div
            className="inline-flex shrink-0 rounded-xl border border-edge/80 bg-card2/70 p-0.5 gap-0.5"
            role="tablist"
            aria-label="Browse by"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === "surahs"}
              onClick={() => setTab("surahs")}
              className={`px-3 py-1.5 rounded-[10px] text-xs font-medium transition-colors ${
                tab === "surahs"
                  ? "bg-card text-ink font-semibold shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              Surahs
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "juz"}
              onClick={() => setTab("juz")}
              className={`px-3 py-1.5 rounded-[10px] text-xs font-medium transition-colors ${
                tab === "juz"
                  ? "bg-card text-ink font-semibold shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              Juz
            </button>
          </div>
        </div>

        {pageJump && (
          <Link
            href={`/read?page=${pageJump}`}
            className="flex items-center justify-between rounded-xl border border-primary/35 bg-primary-soft/60 px-3.5 py-2 text-xs font-semibold text-primary hover:bg-primary-soft transition-colors"
          >
            <span>Open Mushaf Page {pageJump}</span>
            <span aria-hidden>→</span>
          </Link>
        )}

        {!offlineDismissed && <OfflineMushaf onDismiss={dismissOffline} className="mt-1" />}
      </div>

      {/* Grid */}
      {tab === "surahs" ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
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
  );
}
