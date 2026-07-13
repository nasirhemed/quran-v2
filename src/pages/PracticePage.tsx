import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { fetchMutashabihatDetails, fetchQuranPages } from "@/lib/data";
import {
  buildAyahIndex,
  generateRandomQuestions,
  generateSimilarQuestions,
  type PracticeConfig,
  type PracticeQuestion,
} from "@/lib/practice";

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
  const { data: details } = useQuery({
    queryKey: ["mutashabihat-details"],
    queryFn: fetchMutashabihatDetails,
  });

  const ayahIndex = useMemo(() => (pages ? buildAyahIndex(pages) : null), [pages]);

  const [config, setConfig] = useState<PracticeConfig>({
    juzFrom: 1,
    juzTo: 30,
    mode: "similar",
    count: 10,
    skipSameSurah: true,
  });
  const [phase, setPhase] = useState<Phase>("setup");
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [current, setCurrent] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);

  const startWith = (qs: PracticeQuestion[]) => {
    if (qs.length === 0) {
      setEmptyMessage(
        "No questions match this range and these gates. Widen the Juz range or relax the quality gates."
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
    if (!ayahIndex || !details) return;
    const normalized: PracticeConfig = {
      ...config,
      juzFrom: Math.min(config.juzFrom, config.juzTo),
      juzTo: Math.max(config.juzFrom, config.juzTo),
    };
    startWith(
      normalized.mode === "similar"
        ? generateSimilarQuestions(details, ayahIndex, normalized)
        : generateRandomQuestions(ayahIndex, normalized)
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

  if (!pages || !details) {
    return <div className="text-center py-20 text-muted">Loading…</div>;
  }

  // ── Setup ──────────────────────────────────────────────────────
  if (phase === "setup") {
    return (
      <div className="max-w-xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-sans font-bold text-slate-100 mb-2">
            Practice
          </h1>
          <p className="text-slate-400 text-sm">
            Test your recall. Similar-verse questions come from the curated
            Mutashabihat groups.
          </p>
        </div>

        <div className="bg-surface border border-edge rounded-xl p-6 space-y-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
              Range
            </div>
            <div className="flex items-center gap-2">
              <select
                value={config.juzFrom}
                onChange={(e) => setConfig({ ...config, juzFrom: Number(e.target.value) })}
                className="flex-1 bg-card2 border border-edge rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary"
              >
                {JUZ_OPTIONS.map((j) => (
                  <option key={j} value={j}>
                    Juz {j}
                  </option>
                ))}
              </select>
              <span className="text-faint text-sm">to</span>
              <select
                value={config.juzTo}
                onChange={(e) => setConfig({ ...config, juzTo: Number(e.target.value) })}
                className="flex-1 bg-card2 border border-edge rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary"
              >
                {JUZ_OPTIONS.map((j) => (
                  <option key={j} value={j}>
                    Juz {j}
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
                    Similar verses
                  </span>
                  <span className="block text-xs text-muted mt-0.5">
                    Confusable groups from the curated Mutashabihat data —
                    recite the verse, then check its twins.
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

          {config.mode === "similar" && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                Quality gates
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={config.skipSameSurah}
                  onChange={(e) =>
                    setConfig({ ...config, skipSameSurah: e.target.checked })
                  }
                  className="accent-[var(--primary)]"
                />
                <span className={config.skipSameSurah ? "text-primary font-medium" : "text-muted"}>
                  Skip same-surah refrains
                </span>
              </label>
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
              className="flex-1 bg-primary text-on-primary rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Start practice
            </button>
          </div>

          {emptyMessage && (
            <p className="text-sm text-red-400">{emptyMessage}</p>
          )}
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
        {q.twins.length > 0 && (
          <span className="whitespace-nowrap">
            {q.twins.length + 1} occurrences
          </span>
        )}
      </div>

      <div className="bg-surface border border-edge rounded-xl overflow-hidden">
        <div className="p-5 bg-card2 border-b border-edge">
          <div className="text-xs text-muted mb-2">
            {q.twins.length > 0 ? (
              <>
                This opening appears in <b className="text-ink">{q.twins.length + 1} places</b>.
                Recite what follows — then check the twins.
              </>
            ) : (
              <>Recite what follows:</>
            )}
          </div>
          <p dir="rtl" lang="ar" className="font-arabic text-2xl leading-loose text-ink">
            {q.hint} <span className="text-faint">…</span>
          </p>
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
              <p dir="rtl" lang="ar" className="font-arabic text-xl leading-loose text-ink">
                {q.fullText}
              </p>
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
                <p dir="rtl" lang="ar" className="font-arabic text-xl leading-loose text-ink-soft">
                  {t.text}
                </p>
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
