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
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Breadcrumbs items={[{ label: "Browse", href: "/browse" }, { label: `${meta.index} · ${meta.tname}` }]} />

      <div className="text-center mb-6">
        <div className="leading-loose">
          <SurahName surah={meta.index} name={meta.name} className="text-4xl text-ink" />
        </div>
        <div className="text-sm text-muted">
          {meta.index} · {meta.tname} · {meta.ename}
        </div>
        {index && (
          <div className="text-xs text-faint mt-1">
            {counts.all} of {meta.ayas} verses share a phrase or have a similar verse
          </div>
        )}
        <div className="flex items-center justify-center gap-3 mt-3 text-sm">
          {prev && (
            <BrowseLink href={surahHref(prev.index)} className="text-muted hover:text-primary">
              ‹ {prev.tname}
            </BrowseLink>
          )}
          <Link
            href={`/read?surah=${surah}`}
            className="px-3 py-1 rounded-full border border-edge text-muted hover:text-primary hover:border-primary transition-colors"
          >
            Read this surah
          </Link>
          {next && (
            <BrowseLink href={surahHref(next.index)} className="text-muted hover:text-primary">
              {next.tname} ›
            </BrowseLink>
          )}
        </div>
      </div>

      {!index ? (
        <Loading />
      ) : verses.length === 0 ? (
        <div className="text-center py-16 text-muted text-sm">
          No similar phrases or verses are recorded for this surah.
        </div>
      ) : (
        <>
          <div className="flex justify-center mb-6">
            <div className="inline-flex bg-card2 border border-edge rounded-lg p-1 gap-1">
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
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                    filter === value ? "bg-card text-ink font-semibold shadow-sm" : "text-muted hover:text-ink"
                  }`}
                >
                  {label} <span className="text-xs text-primary font-semibold">{counts[value]}</span>
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
