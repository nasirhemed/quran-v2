import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  fetchMutashabihatDetails,
  fetchQuranPages,
  fetchSimilarAyahDetails,
  fetchSurahs,
} from "@/lib/data";
import {
  buildAyahIndex,
  buildPracticeGroups,
  generateGroupDrillQuestions,
  generateRandomQuestions,
  generateTwinsQuestions,
  HUGE_GROUP_LIMIT,
  type PracticeConfig,
  type PracticeQuestion,
} from "@/lib/practice";
import HighlightedAyah from "@/components/HighlightedAyah";

type Phase = "setup" | "play" | "done";

interface Result {
  question: PracticeQuestion;
  correct: boolean;
}

const JUZ_OPTIONS = Array.from({ length: 30 }, (_, i) => i + 1);
const COUNT_OPTIONS = [5, 10, 15, 20];

export default function PracticePage() {
  const { data: pages } = useQuery({
    queryKey: ["quran-pages"],
    queryFn: fetchQuranPages,
  });
  const { data: phraseDetails } = useQuery({
    queryKey: ["mutashabihat-details"],
    queryFn: fetchMutashabihatDetails,
  });
  const { data: similarDetails } = useQuery({
    queryKey: ["similar-ayah-details"],
    queryFn: fetchSimilarAyahDetails,
  });
  const { data: surahs } = useQuery({ queryKey: ["surahs"], queryFn: fetchSurahs });

  const ayahIndex = useMemo(() => (pages ? buildAyahIndex(pages) : null), [pages]);

  const [config, setConfig] = useState<PracticeConfig>({
    range: { type: "juz", from: 1, to: 30 },
    mode: "drill",
    count: 10,
    skipSameSurah: true,
    skipHugeGroups: true,
    usePhrases: true,
    useSimilarAyahs: true,
  });
  const [phase, setPhase] = useState<Phase>("setup");
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [current, setCurrent] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);

  const setRange = (patch: Partial<PracticeConfig["range"]>) =>
    setConfig((c) => ({ ...c, range: { ...c.range, ...patch } }));

  const startWith = (qs: PracticeQuestion[]) => {
    if (qs.length === 0) {
      setEmptyMessage(
        "No questions match this range and these gates. Widen the range or relax the gates."
      );
      return;
    }
    setEmptyMessage(null);
    setQuestions(qs);
    setCurrent(0);
    setRevealed(false);
    setResults([]);
    setPhase("play");
  };

  const start = () => {
    if (!ayahIndex || !phraseDetails || !similarDetails) return;
    if (config.mode !== "random" && !config.usePhrases && !config.useSimilarAyahs) {
      setEmptyMessage("Pick at least one source: Mutashabihat phrases or similar ayahs.");
      return;
    }
    const normalized: PracticeConfig = {
      ...config,
      range: {
        ...config.range,
        from: Math.min(config.range.from, config.range.to),
        to: Math.max(config.range.from, config.range.to),
      },
    };
    if (normalized.mode === "random") {
      startWith(generateRandomQuestions(ayahIndex, normalized));
      return;
    }
    const groups = buildPracticeGroups(phraseDetails, similarDetails, normalized);
    startWith(
      normalized.mode === "drill"
        ? generateGroupDrillQuestions(groups, ayahIndex, normalized)
        : generateTwinsQuestions(groups, ayahIndex, normalized)
    );
  };

  const answer = (correct: boolean) => {
    const next = [...results, { question: questions[current], correct }];
    setResults(next);
    if (current + 1 < questions.length) {
      setCurrent(current + 1);
      setRevealed(false);
    } else {
      setPhase("done");
    }
  };

  const retryMissed = () => {
    const missed = results.filter((r) => !r.correct).map((r) => r.question);
    startWith(missed);
  };

  const dataReady = !!pages && !!phraseDetails && !!similarDetails && !!surahs;

  // ── Setup ──────────────────────────────────────────────────────
  if (phase === "setup") {
    const rangeOptions =
      config.range.type === "juz"
        ? JUZ_OPTIONS.map((j) => ({ value: j, label: `Juz ${j}` }))
        : (surahs ?? []).map((s) => ({ value: s.index, label: `${s.index}. ${s.tname}` }));

    return (
      <div className="max-w-xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-sans font-bold text-slate-100 mb-2">
            Practice
          </h1>
          <p className="text-slate-400 text-sm">
            Test your recall. Similar-verse questions come from the curated
            Mutashabihat and similar-ayah data.
          </p>
        </div>

        <div className="bg-surface border border-edge rounded-xl p-6 space-y-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
              Range
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={config.range.type}
                onChange={(e) => {
                  const type = e.target.value as "juz" | "surah";
                  setConfig((c) => ({
                    ...c,
                    range: { type, from: 1, to: type === "juz" ? 30 : 114 },
                  }));
                }}
                className="bg-card2 border border-edge rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary"
              >
                <option value="juz">By Juz</option>
                <option value="surah">By Surah</option>
              </select>
              <select
                value={config.range.from}
                onChange={(e) => setRange({ from: Number(e.target.value) })}
                className="flex-1 min-w-32 bg-card2 border border-edge rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary"
              >
                {rangeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span className="text-faint text-sm">to</span>
              <select
                value={config.range.to}
                onChange={(e) => setRange({ to: Number(e.target.value) })}
                className="flex-1 min-w-32 bg-card2 border border-edge rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary"
              >
                {rangeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
              Mode
            </div>
            <div className="space-y-2">
              <label
                className={`flex items-start gap-3 border rounded-lg p-3 cursor-pointer transition-colors ${
                  config.mode === "drill"
                    ? "border-primary bg-primary-soft"
                    : "border-edge hover:border-edge-strong"
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  checked={config.mode === "drill"}
                  onChange={() => setConfig({ ...config, mode: "drill" })}
                  className="mt-1 accent-[var(--primary)]"
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    Similar verses — full group
                  </span>
                  <span className="block text-xs text-muted mt-0.5">
                    Every occurrence of a confusable group, back to back —
                    recite what follows each one.
                  </span>
                </span>
              </label>
              <label
                className={`flex items-start gap-3 border rounded-lg p-3 cursor-pointer transition-colors ${
                  config.mode === "similar"
                    ? "border-primary bg-primary-soft"
                    : "border-edge hover:border-edge-strong"
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  checked={config.mode === "similar"}
                  onChange={() => setConfig({ ...config, mode: "similar" })}
                  className="mt-1 accent-[var(--primary)]"
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    Similar verses — spot the twins
                  </span>
                  <span className="block text-xs text-muted mt-0.5">
                    One verse per group — recite it, then reveal all its
                    look-alikes at once.
                  </span>
                </span>
              </label>
              <label
                className={`flex items-start gap-3 border rounded-lg p-3 cursor-pointer transition-colors ${
                  config.mode === "random"
                    ? "border-primary bg-primary-soft"
                    : "border-edge hover:border-edge-strong"
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  checked={config.mode === "random"}
                  onChange={() => setConfig({ ...config, mode: "random" })}
                  className="mt-1 accent-[var(--primary)]"
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    Random verses
                  </span>
                  <span className="block text-xs text-muted mt-0.5">
                    Spread across your range — recall what follows the opening
                    words.
                  </span>
                </span>
              </label>
            </div>
          </div>

          {config.mode !== "random" && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                Sources
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={config.usePhrases}
                    onChange={(e) =>
                      setConfig({ ...config, usePhrases: e.target.checked })
                    }
                    className="accent-[var(--primary)]"
                  />
                  <span className={config.usePhrases ? "text-ink" : "text-muted"}>
                    Mutashabihat phrases
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={config.useSimilarAyahs}
                    onChange={(e) =>
                      setConfig({ ...config, useSimilarAyahs: e.target.checked })
                    }
                    className="accent-[var(--primary)]"
                  />
                  <span className={config.useSimilarAyahs ? "text-ink" : "text-muted"}>
                    Similar ayahs
                  </span>
                </label>
              </div>
            </div>
          )}

          {config.mode !== "random" && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                Quality gates
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={config.skipSameSurah}
                    onChange={(e) =>
                      setConfig({ ...config, skipSameSurah: e.target.checked })
                    }
                    className="accent-[var(--primary)]"
                  />
                  <span
                    className={config.skipSameSurah ? "text-primary font-medium" : "text-muted"}
                  >
                    Skip same-surah refrains
                  </span>
                </label>
                {config.mode === "drill" && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={config.skipHugeGroups}
                      onChange={(e) =>
                        setConfig({ ...config, skipHugeGroups: e.target.checked })
                      }
                      className="accent-[var(--primary)]"
                    />
                    <span
                      className={
                        config.skipHugeGroups ? "text-primary font-medium" : "text-muted"
                      }
                    >
                      Skip huge groups ({HUGE_GROUP_LIMIT}+ verses)
                    </span>
                  </label>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <select
              value={config.count}
              onChange={(e) => setConfig({ ...config, count: Number(e.target.value) })}
              className="bg-card2 border border-edge rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary"
            >
              {COUNT_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c} questions
                </option>
              ))}
            </select>
            <button
              onClick={start}
              disabled={!dataReady}
              className="flex-1 bg-primary text-on-primary rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-wait"
            >
              {dataReady ? "Start practice" : "Loading data…"}
            </button>
          </div>

          {emptyMessage && <p className="text-sm text-red-400">{emptyMessage}</p>}
        </div>
      </div>
    );
  }

  // ── Results ────────────────────────────────────────────────────
  if (phase === "done") {
    const score = results.filter((r) => r.correct).length;
    const missed = results.filter((r) => !r.correct);
    return (
      <div className="max-w-xl mx-auto px-4 py-8">
        <div className="bg-surface border border-edge rounded-xl p-6 text-center">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
            Session complete
          </div>
          <div className="text-4xl font-bold text-ink mb-1">
            {score} / {results.length}
          </div>
          <p className="text-sm text-muted mb-6">
            {missed.length === 0
              ? "Everything recalled — ما شاء الله."
              : `${missed.length} to review.`}
          </p>

          {missed.length > 0 && (
            <div className="text-left space-y-2 mb-6">
              {missed.map((r) => (
                <div
                  key={r.question.key}
                  className="border border-edge rounded-lg p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-primary">
                      {r.question.key} · {r.question.tname}
                    </div>
                    <div
                      dir="rtl"
                      lang="ar"
                      className="font-arabic text-base text-ink truncate"
                    >
                      {r.question.hint} …
                    </div>
                  </div>
                  <Link
                    href={`/read?surah=${r.question.surah}&ayah=${r.question.ayah}`}
                    className="shrink-0 text-xs text-muted hover:text-primary underline"
                  >
                    Reader
                  </Link>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3 justify-center">
            {missed.length > 0 && (
              <button
                onClick={retryMissed}
                className="bg-primary text-on-primary rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Retry missed
              </button>
            )}
            <button
              onClick={() => setPhase("setup")}
              className="border border-edge-strong text-ink rounded-lg px-4 py-2 text-sm font-medium hover:bg-card2 transition-colors"
            >
              New session
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Play ───────────────────────────────────────────────────────
  const q = questions[current];
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-4 text-xs text-muted">
        <span className="whitespace-nowrap">
          Question {current + 1} / {questions.length}
        </span>
        <div className="flex-1 h-1 rounded-full bg-card2 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${(current / questions.length) * 100}%` }}
          />
        </div>
        {q.groupSize ? (
          <span className="whitespace-nowrap">
            Group {q.groupNumber} · verse {q.groupPosition} of {q.groupSize}
          </span>
        ) : q.twins.length > 0 ? (
          <span className="whitespace-nowrap">
            {q.twins.length + 1} occurrences
          </span>
        ) : null}
      </div>

      <div className="bg-surface border border-edge rounded-xl overflow-hidden">
        <div className="p-5 bg-card2 border-b border-edge">
          <div className="text-xs text-muted mb-2">
            {q.groupSize ? (
              <>
                One of <b className="text-ink">{q.groupSize} confusable verses</b> in
                this group — recite what follows:
              </>
            ) : q.twins.length > 0 ? (
              <>
                This verse has <b className="text-ink">{q.twins.length} look-alikes</b>.
                Recite what follows — then check the twins.
              </>
            ) : (
              <>Recite what follows:</>
            )}
          </div>
          <p dir="rtl" lang="ar" className="font-arabic text-2xl leading-loose text-ink">
            {q.hint} <span className="text-faint">…</span>
          </p>
          {q.phraseText && (
            <div className="flex items-baseline gap-2 flex-wrap mt-2">
              <span className="text-xs text-faint">Watch for</span>
              <span
                dir="rtl"
                lang="ar"
                className="font-arabic text-base px-2 py-0.5 rounded bg-primary-soft text-primary"
              >
                {q.phraseText}
              </span>
            </div>
          )}
          <div className="text-xs text-faint mt-2">
            {q.key} · {q.tname}
          </div>
        </div>

        {!revealed ? (
          <div className="p-5">
            <button
              onClick={() => setRevealed(true)}
              className="w-full bg-primary text-on-primary rounded-lg px-4 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Reveal
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div>
              <div className="text-xs font-semibold text-primary mb-1">
                {q.key} · {q.tname}
              </div>
              <HighlightedAyah text={q.fullText} ranges={q.promptRanges} />
            </div>

            {q.twins.map((t) => (
              <div key={t.key} className="border-t border-edge pt-3">
                <div className="text-xs font-semibold text-primary mb-1 flex items-center justify-between">
                  <span>
                    {t.key} · {t.tname}
                  </span>
                  <Link
                    href={`/read?surah=${t.key.split(":")[0]}&ayah=${t.key.split(":")[1]}`}
                    className="text-muted hover:text-primary underline font-normal"
                  >
                    Reader
                  </Link>
                </div>
                <HighlightedAyah
                  text={t.text}
                  ranges={t.ranges}
                  className="font-arabic text-xl leading-loose text-ink-soft"
                />
              </div>
            ))}

            {q.nextAyahText && (
              <div className="border-t border-edge pt-3">
                <div className="text-xs text-faint mb-1">Next ayah</div>
                <p dir="rtl" lang="ar" className="font-arabic text-xl leading-loose text-ink-soft">
                  {q.nextAyahText}
                </p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => answer(true)}
                className="flex-1 bg-primary text-on-primary rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                ✓ Got it
              </button>
              <button
                onClick={() => answer(false)}
                className="flex-1 border border-red-400/40 text-red-400 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-red-500/10 transition-colors"
              >
                ✗ Missed
              </button>
              <Link
                href={`/read?surah=${q.surah}&ayah=${q.ayah}`}
                className="border border-edge-strong text-muted rounded-lg px-4 py-2 text-sm font-medium hover:bg-card2 transition-colors"
              >
                Show in Reader
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
