import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { fetchSurahs } from "@/lib/data";
import { usePracticeIndex } from "@/hooks/usePracticeIndex";
import {
  compareVerses,
  generateQuestions,
  shownLookAlikes,
  type PracticeIndex,
  type PracticeQuestion,
  type PracticeRange,
  type WordMark,
} from "@/lib/practice";

type Phase = "setup" | "play" | "done";

interface Settings {
  range: PracticeRange;
  count: number;
}

const COUNT_OPTIONS = [3, 5, 10];
const STORAGE_KEY = "practice";
const DEFAULTS: Settings = { range: { type: "juz", from: 1, to: 30 }, count: 5 };
/** Where a verse parts from its look-alike. */
const DIFF_BG = "rgb(var(--gold-rgb) / 0.28)";

function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    const type = s?.range?.type;
    const max = type === "juz" ? 30 : 114;
    const ok = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= max;
    if ((type === "juz" || type === "surah") && ok(s.range.from) && ok(s.range.to) && COUNT_OPTIONS.includes(s.count)) {
      return { range: { type, from: s.range.from, to: s.range.to }, count: s.count };
    }
  } catch {
    // private mode or a bad value: the defaults
  }
  return DEFAULTS;
}

const readerHref = (key: string) => {
  const [surah, ayah] = key.split(":");
  return `/read?surah=${surah}&ayah=${ayah}`;
};

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const arabicNumber = (n: number) => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]);

export default function PracticePage() {
  const { data: index } = usePracticeIndex();
  const { data: surahs } = useQuery({ queryKey: ["surahs"], queryFn: fetchSurahs });

  const [settings, setSettings] = useState(loadSettings);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // private mode: not remembered
    }
  }, [settings]);

  const [phase, setPhase] = useState<Phase>("setup");
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [current, setCurrent] = useState(0);
  const [checking, setChecking] = useState(false);
  const [slipped, setSlipped] = useState<boolean[]>([]);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);

  useEffect(() => window.scrollTo(0, 0), [phase, current]);

  const startWith = (qs: PracticeQuestion[]) => {
    if (qs.length === 0) {
      setEmptyMessage("No questions fit this range.");
      return;
    }
    setEmptyMessage(null);
    setQuestions(qs);
    setCurrent(0);
    setChecking(false);
    setSlipped([]);
    setPhase("play");
  };

  const answer = (didSlip: boolean) => {
    setSlipped([...slipped, didSlip]);
    if (current + 1 < questions.length) {
      setCurrent(current + 1);
      setChecking(false);
    } else {
      setPhase("done");
    }
  };

  if (phase === "setup" || !index) {
    return (
      <Setup
        settings={settings}
        onChange={setSettings}
        surahs={surahs}
        ready={!!index}
        emptyMessage={emptyMessage}
        onStart={() => index && startWith(generateQuestions(index, settings.range, settings.count))}
      />
    );
  }

  if (phase === "done") {
    const missed = questions.filter((_, i) => slipped[i]);
    return (
      <div className="max-w-xl mx-auto px-4 py-8">
        <div className="bg-card border border-edge rounded-xl p-6 text-center">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Session complete</div>
          <div className="text-4xl font-bold text-ink mb-1">
            {questions.length - missed.length} / {questions.length}
          </div>
          <p className="text-sm text-muted mb-6">
            {missed.length === 0
              ? "Every passage recited cleanly — ما شاء الله."
              : `recited cleanly. Go over ${missed.length === 1 ? "this one" : `these ${missed.length}`} again:`}
          </p>

          {missed.length > 0 && (
            <div className="text-left space-y-2 mb-6">
              {missed.map((q) => {
                const v = index.verses[q.start];
                return (
                  <div key={q.key} className="border border-edge rounded-lg p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-primary">
                        {v.tname} {v.key} · page {v.page}
                      </div>
                      <div dir="rtl" lang="ar" className="font-arabic text-base text-ink truncate">
                        {v.words.slice(0, q.promptWords).join(" ")} …
                      </div>
                    </div>
                    <Link href={readerHref(v.key)} className="shrink-0 text-xs text-muted hover:text-primary underline">
                      Reader
                    </Link>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex gap-3 justify-center">
            {missed.length > 0 && (
              <button
                onClick={() => startWith(missed)}
                className="bg-primary text-on-primary rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Retry the slips
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

  const q = questions[current];
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-4 text-xs text-muted">
        <span className="whitespace-nowrap">
          Question {current + 1} of {questions.length}
        </span>
        <div className="flex-1 h-1 rounded-full bg-card2 overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(current / questions.length) * 100}%` }} />
        </div>
        <button onClick={() => setPhase("setup")} className="hover:text-ink transition-colors">
          End
        </button>
      </div>

      <Question key={`${q.key}-${current}`} index={index} question={q} checking={checking} onCheck={() => setChecking(true)} onAnswer={answer} />
    </div>
  );
}

// ─── Setup ──────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">{label}</div>
      {children}
    </div>
  );
}

const selectClass =
  "flex-1 min-w-0 bg-card2 border border-edge rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary";

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-edge bg-card2 p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-4 py-1.5 rounded-md text-sm transition-colors ${
            value === o.value ? "bg-primary text-on-primary font-semibold" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Setup({
  settings,
  onChange,
  surahs,
  ready,
  emptyMessage,
  onStart,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  surahs: { index: number; tname: string }[] | undefined;
  ready: boolean;
  emptyMessage: string | null;
  onStart: () => void;
}) {
  const { range, count } = settings;
  const options =
    range.type === "juz"
      ? Array.from({ length: 30 }, (_, i) => ({ value: i + 1, label: `Juz ${i + 1}` }))
      : (surahs ?? []).map((s) => ({ value: s.index, label: `${s.index}. ${s.tname}` }));
  const setRange = (patch: Partial<PracticeRange>) => onChange({ ...settings, range: { ...range, ...patch } });

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-sans font-bold text-ink mb-2">Practice</h1>
        <p className="text-muted text-sm">
          You get the opening words of a verse; recite on from memory to the end of the next page, as competition judges
          test. Questions start where verses have look-alikes elsewhere, on the pages where they crowd together.
        </p>
      </div>

      <div className="bg-card border border-edge rounded-xl p-6 space-y-6">
        <Field label="What you're tested on">
          <div className="space-y-2">
            <Segmented
              label="Range by"
              options={[
                { value: "juz", label: "Juz" },
                { value: "surah", label: "Surah" },
              ]}
              value={range.type}
              onChange={(type) => onChange({ ...settings, range: { type, from: 1, to: type === "juz" ? 30 : 114 } })}
            />
            <div className="flex items-center gap-2">
              <select
                aria-label="From"
                value={range.from}
                onChange={(e) => setRange({ from: Number(e.target.value) })}
                className={selectClass}
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span className="text-faint text-sm">to</span>
              <select
                aria-label="To"
                value={range.to}
                onChange={(e) => setRange({ to: Number(e.target.value) })}
                className={selectClass}
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Field>

        <Field label="Questions">
          <Segmented
            label="Questions"
            options={COUNT_OPTIONS.map((n) => ({ value: n, label: String(n) }))}
            value={count}
            onChange={(n) => onChange({ ...settings, count: n })}
          />
        </Field>

        <button
          onClick={onStart}
          disabled={!ready}
          className="w-full bg-primary text-on-primary rounded-lg px-4 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-wait"
        >
          {ready ? "Start" : "Preparing…"}
        </button>

        {emptyMessage && <p className="text-sm text-red-400">{emptyMessage}</p>}
      </div>
    </div>
  );
}

// ─── A question ─────────────────────────────────────────────────

function Question({
  index,
  question: q,
  checking,
  onCheck,
  onAnswer,
}: {
  index: PracticeIndex;
  question: PracticeQuestion;
  checking: boolean;
  onCheck: () => void;
  onAnswer: (slipped: boolean) => void;
}) {
  const start = index.verses[q.start];
  const end = index.verses[q.end];
  const endsPage = q.end + 1 >= index.verses.length || index.verses[q.end + 1].page !== end.page;
  const to = endsPage ? `the end of page ${end.page}` : `the end of ${end.key}, where your range ends`;

  return (
    <div className="bg-card border border-edge rounded-xl">
      <div className="p-5 border-b border-edge">
        <div className="text-xs text-muted mb-3">
          {start.tname} {start.key} · page {start.page}
        </div>
        <p dir="rtl" lang="ar" className="font-arabic text-3xl leading-loose text-ink">
          {start.words.slice(0, q.promptWords).join(" ")} <span className="text-faint">…</span>
        </p>
        <div className="text-sm text-ink-soft mt-3">Recite on to {to}.</div>
      </div>

      {!checking ? (
        <div className="p-5">
          <button
            onClick={onCheck}
            className="w-full bg-primary text-on-primary rounded-lg px-4 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Check
          </button>
        </div>
      ) : (
        <>
          <div className="px-5 pt-4 text-xs text-muted">
            {start.key} – {end.key} ·{" "}
            {q.traps === 0
              ? "no look-alikes on these pages"
              : `${q.traps} ${q.traps === 1 ? "verse has a look-alike" : "verses have look-alikes"} — the marked words are where they part`}
          </div>
          <Passage index={index} question={q} />
          <div className="sticky bottom-0 p-4 bg-card border-t border-edge rounded-b-xl flex gap-2">
            <button
              onClick={() => onAnswer(false)}
              className="flex-1 bg-primary text-on-primary rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              ✓ Clean
            </button>
            <button
              onClick={() => onAnswer(true)}
              className="flex-1 border border-red-400/40 text-red-400 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-red-500/10 transition-colors"
            >
              ✗ Slipped
            </button>
            <Link
              href={readerHref(start.key)}
              className="border border-edge-strong text-muted rounded-lg px-3 py-2 text-sm font-medium hover:bg-card2 transition-colors"
            >
              Reader
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The passage, as running text; a verse with a look-alike stands out on its own, with the look-alike beneath
 * it and, in both, the words where they part marked.
 */
function Passage({ index, question: q }: { index: PracticeIndex; question: PracticeQuestion }) {
  const blocks = useMemo(() => {
    const out: { surahStart: boolean; verses: number[]; trap: boolean }[] = [];
    for (let i = q.start; i <= q.end; i++) {
      const trap = shownLookAlikes(index, i, 1).length > 0;
      const surahStart = i > q.start && index.verses[i].ayah === 1;
      const last = out[out.length - 1];
      if (last && !trap && !last.trap && !surahStart) last.verses.push(i);
      else out.push({ surahStart, verses: [i], trap });
    }
    return out;
  }, [index, q]);

  return (
    <div className="px-5 py-3 space-y-2">
      {blocks.map((block) => {
        const first = index.verses[block.verses[0]];
        return (
          <Fragment key={first.key}>
            {block.surahStart && <div className="text-center text-xs text-muted pt-2">{first.tname}</div>}
            {block.trap ? (
              <TrapVerse index={index} i={block.verses[0]} />
            ) : (
              <p dir="rtl" lang="ar" className="font-arabic text-xl leading-loose text-ink">
                {block.verses.map((i) => (
                  <Fragment key={i}>
                    {index.verses[i].words.join(" ")} <AyahNumber n={index.verses[i].ayah} />{" "}
                  </Fragment>
                ))}
              </p>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

function AyahNumber({ n }: { n: number }) {
  return <span className="text-faint text-lg">﴿{arabicNumber(n)}﴾</span>;
}

function TrapVerse({ index, i }: { index: PracticeIndex; i: number }) {
  const v = index.verses[i];
  const lookAlikes = shownLookAlikes(index, i);
  const closest = lookAlikes[0].other;
  const own = useMemo(() => compareVerses(index, i, closest).a, [index, i, closest]);
  return (
    <div className="rounded-lg bg-card2 px-3 py-2">
      <p dir="rtl" lang="ar" className="font-arabic text-xl leading-loose text-ink">
        <MarkedWords words={v.words} marks={own} /> <AyahNumber n={v.ayah} />
      </p>
      {lookAlikes.map((l) => (
        <LookAlikeNote key={l.other} index={index} i={i} other={l.other} />
      ))}
    </div>
  );
}

function LookAlikeNote({ index, i, other }: { index: PracticeIndex; i: number; other: number }) {
  const o = index.verses[other];
  const marks = useMemo(() => compareVerses(index, i, other), [index, i, other]);
  const identical = marks.a.every((m) => m === "same") && marks.b.every((m) => m === "same");
  const next = other + 1 < index.verses.length && index.verses[other + 1].surah === o.surah ? index.verses[other + 1] : null;

  return (
    <div className="mt-1 mb-1 border-t border-edge pt-2">
      <div className="text-xs text-muted">
        <Link href={readerHref(o.key)} className="font-semibold text-gold-text hover:underline">
          {o.tname} {o.key}
        </Link>
        {identical ? (next ? " says the same; there it goes on:" : " says the same, and ends the surah.") : " is like it:"}
      </div>
      {identical ? (
        next && (
          <p dir="rtl" lang="ar" className="font-arabic text-lg leading-loose text-ink-soft">
            {next.words.slice(0, 8).join(" ")}
            {next.words.length > 8 && " …"}
          </p>
        )
      ) : (
        <p dir="rtl" lang="ar" className="font-arabic text-lg leading-loose text-ink-soft">
          <MarkedWords words={o.words} marks={marks.b} trim />
        </p>
      )}
    </div>
  );
}

/**
 * Words with the "diff" ones (where the verse parts from its look-alike) highlighted. With `trim`, a long verse
 * shows only its stretch alongside the look-alike, two words either side, and the words outside the stretch fade.
 */
function MarkedWords({ words, marks, trim = false }: { words: string[]; marks: WordMark[]; trim?: boolean }) {
  let from = 0;
  let to = words.length - 1;
  if (trim && words.length > 20) {
    const marked = marks.flatMap((m, k) => (m ? [k] : []));
    if (marked.length) {
      from = Math.max(0, marked[0] - 2);
      to = Math.min(words.length - 1, marked[marked.length - 1] + 2);
    }
  }
  const runs: { words: string[]; mark: WordMark }[] = [];
  for (let k = from; k <= to; k++) {
    const last = runs[runs.length - 1];
    if (last && last.mark === marks[k]) last.words.push(words[k]);
    else runs.push({ words: [words[k]], mark: marks[k] });
  }
  return (
    <>
      {from > 0 && "… "}
      {runs.map((run, k) => (
        <Fragment key={k}>
          {k > 0 && " "}
          {run.mark === "diff" ? (
            <span className="rounded-sm [box-decoration-break:clone]" style={{ background: DIFF_BG }}>
              {run.words.join(" ")}
            </span>
          ) : run.mark === undefined && trim ? (
            <span className="text-faint">{run.words.join(" ")}</span>
          ) : (
            run.words.join(" ")
          )}
        </Fragment>
      ))}
      {to < words.length - 1 && " …"}
    </>
  );
}
