import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { fetchSurahs } from "@/lib/data";
import { useBrowseIndex } from "@/hooks/useBrowseIndex";
import SurahName from "@/components/SurahName";
import {
  Breadcrumbs,
  BrowseLink,
  Loading,
  VerseCard,
  surahHref,
  useRestoreScroll,
} from "@/components/browse/BrowseParts";

type Filter = "all" | "phrases" | "similar";

export default function BrowseSurahPage({ surah }: { surah: number }) {
  const [location, navigate] = useLocation();
  // The filter lives in the URL, so coming back from a verse keeps it.
  const filter = (new URLSearchParams(useSearch()).get("show") ?? "all") as Filter;
  const { data: surahs } = useQuery({ queryKey: ["surahs"], queryFn: fetchSurahs });
  const { data: index } = useBrowseIndex();

  const meta = surahs?.find((s) => s.index === surah);
  useRestoreScroll(!!meta && !!index);
  if (surahs && !meta) return <div className="py-24 text-center text-muted">No such surah.</div>;
  if (!meta) return <Loading />;

  const verses = index?.bySurah.get(surah) ?? [];
  const counts = {
    all: verses.length,
    phrases: verses.filter((v) => v.phrases.length > 0).length,
    similar: verses.filter((v) => v.similar.length > 0).length,
  };
  const shown =
    filter === "phrases"
      ? verses.filter((v) => v.phrases.length > 0)
      : filter === "similar"
        ? verses.filter((v) => v.similar.length > 0)
        : verses;
  const prev = surahs!.find((s) => s.index === surah - 1);
  const next = surahs!.find((s) => s.index === surah + 1);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-24">
      <Breadcrumbs items={[{ label: "Browse", href: "/browse" }, { label: `${meta.index} · ${meta.tname}` }]} />

      <div className="bg-card border border-edge rounded-2xl shadow-card px-5 py-6 text-center mb-6">
        <div className="leading-loose">
          <SurahName surah={meta.index} name={meta.name} className="text-4xl text-ink" />
        </div>
        <div className="text-sm font-medium text-ink-soft mt-1">
          {meta.index} · {meta.tname} <span className="text-muted font-normal">· {meta.ename}</span>
        </div>
        {index && (
          <div className="text-xs text-muted mt-1.5">
            {counts.all} of {meta.ayas} verses share a phrase or have a similar verse
          </div>
        )}
        <div className="flex flex-wrap items-center justify-center gap-3 mt-4 text-sm">
          {prev && (
            <BrowseLink
              href={surahHref(prev.index)}
              className="px-3 py-1.5 rounded-full text-muted hover:text-primary hover:bg-card2 transition-colors"
            >
              ‹ {prev.tname}
            </BrowseLink>
          )}
          <Link
            href={`/read?surah=${surah}`}
            className="px-4 py-1.5 rounded-full border border-primary/30 bg-primary-soft text-primary font-semibold hover:bg-primary hover:text-on-primary transition-colors"
          >
            Read this surah
          </Link>
          {next && (
            <BrowseLink
              href={surahHref(next.index)}
              className="px-3 py-1.5 rounded-full text-muted hover:text-primary hover:bg-card2 transition-colors"
            >
              {next.tname} ›
            </BrowseLink>
          )}
        </div>
      </div>

      {!index ? (
        <Loading />
      ) : verses.length === 0 ? (
        <div className="bg-card border border-edge rounded-2xl shadow-card text-center py-12 px-4 text-muted text-sm">
          No similar phrases or verses are recorded for this surah.
        </div>
      ) : (
        <>
          <div className="flex justify-center mb-6">
            <div className="inline-flex bg-card2 border border-edge rounded-xl p-1 gap-1">
              {(
                [
                  ["all", "All"],
                  ["phrases", "Phrases"],
                  ["similar", "Similar verses"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() =>
                    navigate(value === "all" ? location : `${location}?show=${value}`, { replace: true })
                  }
                  className={`px-3.5 py-1.5 rounded-lg text-sm transition-all ${
                    filter === value ? "bg-card text-ink font-semibold shadow-sm" : "text-muted hover:text-ink"
                  }`}
                >
                  {label} <span className="text-xs text-primary font-semibold ml-0.5 tabular-nums">{counts[value]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {shown.map((v) => (
              <VerseCard key={v.key} verse={v} label={`${meta.tname} ${v.key}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
