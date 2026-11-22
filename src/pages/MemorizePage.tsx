import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { fetchQuranPages, fetchSurahs } from "@/lib/data";
import { DEFAULT_RECITER, missingSurahs, recitations, RECITERS, versesInRange, type Verse } from "@/lib/memorize";
import { MemorizeSession, type MemorizeConfig } from "@/memorize/session";
import { modelAvailability, type ModelAvailability } from "@/memorize/recognizer";
import FocusView, { SPEEDS } from "@/components/memorize/FocusView";

/**
 * Memorize: pick verses and a mode (listen & recite N times, K in a row; or just listen X times), the rest tucked under
 * "Edit"; then the session runs
 * full screen (FocusView). The session itself is src/memorize/session.ts; this page is setup and the summary.
 */

interface Settings extends Omit<MemorizeConfig, "useModel" | "listen"> {
  /** "recite": the reciter, then you, each round; "listen": the reciter `listenTimes` times, then the next verse */
  mode: "recite" | "listen";
  listenTimes: number;
  from: Verse;
  to: Verse;
  reciterId: string;
  useModel: boolean;
  /** hide the verse on your turn: words appear as the speech model hears them */
  hideOnMyTurn: boolean;
}

const KEY = "memorize";

/** `lock` is in browsers (Chrome on Android, in full screen) but no longer in TypeScript's DOM types */
const orientation = () =>
  (typeof screen !== "undefined" ? screen.orientation : undefined) as
    | (ScreenOrientation & { lock?: (o: "portrait" | "landscape") => Promise<void> })
    | undefined;
const DEFAULTS: Settings = {
  from: { s: 112, a: 1 },
  to: { s: 112, a: 4 },
  reps: 3,
  inRow: 1,
  mode: "recite",
  listenTimes: 3,
  reciterId: DEFAULT_RECITER.id,
  speed: 1,
  useModel: true,
  hintAfterMs: 3000,
  giveUpMs: 20000,
  endSilenceMs: 3000,
  hideOnMyTurn: false,
  cue: true,
};

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Settings> | null;
    if (saved) return { ...DEFAULTS, ...saved };
    // the prototype's choices (/lab/memorize), if any: range and reciter
    const lab = JSON.parse(localStorage.getItem("memorizeLab") ?? "{}") as Partial<Settings>;
    return { ...DEFAULTS, ...(lab.from && lab.to ? { from: lab.from, to: lab.to } : {}), ...(lab.reciterId ? { reciterId: lab.reciterId } : {}), ...(lab.reps ? { reps: lab.reps } : {}) };
  } catch {
    return DEFAULTS;
  }
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">{label}</div>
      {children}
      {hint && <p className="text-xs text-muted mt-1.5">{hint}</p>}
    </div>
  );
}

const selectClass =
  "min-w-0 bg-ground border border-edge rounded-xl px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all";

function Segmented<T extends string | number>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-xl border border-edge bg-card2 p-1 gap-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
            value === o.value ? "bg-primary text-on-primary font-semibold shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function VersePicker({ label, value, onChange, names, ayas }: { label: string; value: Verse; onChange: (v: Verse) => void; names: string[]; ayas: number[] }) {
  const maxAyah = ayas[value.s - 1] ?? 1;
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 text-xs font-medium text-muted shrink-0">{label}</span>
      <select className={`${selectClass} flex-1`} value={value.s} onChange={(e) => onChange({ s: Number(e.target.value), a: 1 })} aria-label={`${label} surah`}>
        {names.map((n, i) => (
          <option key={i} value={i + 1}>
            {i + 1}. {n}
          </option>
        ))}
      </select>
      <div className="flex items-center bg-ground border border-edge rounded-xl px-2.5 py-1.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 transition-all shrink-0">
        <span className="text-[11px] text-faint mr-1.5">Ayah</span>
        <input
          type="number"
          min={1}
          max={maxAyah}
          value={value.a}
          onChange={(e) => onChange({ ...value, a: Number(e.target.value) })}
          className="w-11 bg-transparent text-sm text-ink text-center tabular-nums focus:outline-none"
          aria-label={`${label} verse`}
        />
        <span className="text-[11px] text-faint tabular-nums">/ {maxAyah}</span>
      </div>
    </div>
  );
}

function ModeCard({ on, onClick, title, hint }: { on: boolean; onClick: () => void; title: string; hint: string }) {
  return (
    <button
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={`text-left rounded-xl border-[1.5px] p-3.5 transition-all ${
        on ? "border-primary bg-primary-soft shadow-sm" : "border-edge bg-ground/60 hover:border-edge-strong hover:bg-card2/50"
      }`}
    >
      <span className={`block text-[15px] font-semibold ${on ? "text-primary" : "text-ink"}`}>{title}</span>
      <span className="block text-xs text-muted mt-0.5">{hint}</span>
    </button>
  );
}

function Counter({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const btn = "w-9 h-9 text-lg text-primary hover:bg-card2 rounded-lg transition-colors disabled:text-faint disabled:hover:bg-transparent";
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-[15px] text-ink">{label}</span>
      <div className="flex items-center rounded-xl border border-edge bg-ground p-0.5" role="group" aria-label={label}>
        <button className={btn} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} aria-label={`Fewer: ${label}`}>
          −
        </button>
        <span className="min-w-10 text-center text-sm font-semibold tabular-nums" aria-live="polite">
          {value}×
        </span>
        <button className={btn} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} aria-label={`More: ${label}`}>
          +
        </button>
      </div>
    </div>
  );
}

function Check({ checked, onChange, title }: { checked: boolean; onChange: (v: boolean) => void; title: string }) {
  return (
    <label className="flex items-start gap-2.5 text-sm text-ink cursor-pointer">
      <input type="checkbox" className="mt-1 accent-[var(--primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{title}</span>
    </label>
  );
}

export default function MemorizePage() {
  const [session] = useState(() => new MemorizeSession());
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const { data: surahs } = useQuery({ queryKey: ["surahs"], queryFn: fetchSurahs });
  const { data: pages } = useQuery({ queryKey: ["quran-pages"], queryFn: fetchQuranPages });
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [availability, setAvailability] = useState<ModelAvailability | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return () => session.dispose();
  }, [session]);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* private mode */
    }
  }, [settings]);
  useEffect(() => {
    void modelAvailability()
      .then(setAvailability)
      .catch(() => setAvailability({ state: "unsupported", missing: ["on-device file storage"] }));
  }, []);
  useEffect(() => {
    if (typeof location !== "undefined" && new URLSearchParams(location.search).has("debug")) (window as unknown as Record<string, unknown>).__memorize = session;
  }, [session]);

  /** each verse's words, "s:a" → [{ key "s:a:w", text }], the text in the QPC Hafs script (`font-quran`) */
  const verseWords = useMemo(() => {
    const m = new Map<string, { key: string; text: string }[]>();
    for (const p of pages ?? []) for (const g of p.surahGroups) for (const a of g.ayahs) m.set(`${a.surah}:${a.ayah}`, a.words.map((w) => ({ key: `${a.surah}:${a.ayah}:${w.position}`, text: w.hafs })));
    return m;
  }, [pages]);
  // read when needed, so a session started before the pages arrived still gets them
  const verseWordsRef = useRef(verseWords);
  verseWordsRef.current = verseWords;
  const words = useCallback((ayah: string) => verseWords.get(ayah) ?? [], [verseWords]);

  const names = useMemo(() => surahs?.map((s) => s.tname) ?? [], [surahs]);
  const ayas = useMemo(() => surahs?.map((s) => s.ayas) ?? [], [surahs]);
  const verses = useMemo(() => (ayas.length ? versesInRange(ayas, settings.from, settings.to) : []), [ayas, settings.from, settings.to]);
  const reciter = RECITERS.find((r) => r.id === settings.reciterId) ?? DEFAULT_RECITER;
  const missing = missingSurahs(reciter, verses);
  const set = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  // still checking counts as available: the session falls back to quiet by itself if the model can't load
  const useModel = settings.useModel && availability?.state !== "no-model" && availability?.state !== "unsupported";
  const justListen = settings.mode === "listen";
  // you always listen first (listen ×1, then you, then reciter → you: the same order as before the redesign)
  const plan = justListen ? { listen: settings.listenTimes, reps: 0, inRow: 1 } : { listen: 1, reps: settings.reps, inRow: settings.inRow };
  const summary = [
    `Speed ${settings.speed}×`,
    ...(justListen ? [] : useModel ? [settings.hintAfterMs ? `hints after ${settings.hintAfterMs / 1000} s` : "no hints"] : [`ends after ${settings.endSilenceMs / 1000} s quiet`]),
    ...(!justListen && settings.hideOnMyTurn ? ["hidden"] : []),
  ].join(" · ");
  const active = state.phase === "running" || state.phase === "paused" || state.phase === "starting";

  // full screen while a session runs, where the browser allows it (not on iPhone: there the view fills the page)
  useEffect(() => {
    if (!active) {
      orientation()?.unlock?.();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    }
  }, [active]);

  const start = () => {
    // In full screen (Chrome on Android) the screen keeps the way it was held at Start: a phone in a car mount that
    // auto-rotates on every bump swaps the whole layout, and the verse with it, back and forth.
    void document.documentElement
      .requestFullscreen?.({ navigationUI: "hide" })
      .then(() => {
        const o = orientation();
        return o?.lock?.(o.type.startsWith("portrait") ? "portrait" : "landscape");
      })
      .catch(() => undefined);
    const modelNote = `${useModel ? "on" : "off"} (setting ${settings.useModel ? "on" : "off"}, on this device: ${availability ? availability.state + ("missing" in availability ? ` – ${availability.missing.join(", ")}` : "") : "still checking"})`;
    void session.start({ ...settings, ...plan, useModel, modelNote }, verses, reciter, (ayah) => verseWordsRef.current.get(ayah)?.length ?? NaN);
  };

  const copyLog = async () => {
    try {
      await navigator.clipboard.writeText(session.report());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* no clipboard */
    }
  };

  const fromSurahMax = ayas[settings.from.s - 1] ?? 1;
  const isWholeSurah =
    settings.from.a === 1 && settings.to.s === settings.from.s && settings.to.a === fromSurahMax;

  return (
    <>
      <div className="max-w-xl mx-auto px-4 py-8 pb-24 space-y-4">
        <div className="text-center mb-6">
          <h1 className="text-3xl sm:text-4xl font-sans font-bold tracking-tight text-ink mb-2">Memorize</h1>
          <p className="text-muted text-sm max-w-md mx-auto">
            Listen to a reciter, recite back verse by verse, and build steady recall at your own pace.
          </p>
        </div>

        {(state.phase === "done" || (state.phase === "idle" && state.turns > 0)) && (
          <div className="bg-card border border-edge rounded-2xl shadow-card p-5 text-center space-y-2">
            <div className="inline-flex items-center px-3 py-0.5 rounded-full bg-primary-soft text-primary text-xs font-semibold uppercase tracking-wider">
              {state.phase === "done" ? "Session complete" : "Session stopped"}
            </div>
            <div className="text-ink font-medium">
              {state.turns} turn{state.turns === 1 ? "" : "s"}
              {state.modelTurns > 0 && ` · ${state.completed} of ${state.modelTurns} recited to the end`}
              {state.hints > 0 && ` · ${state.hints} hint${state.hints === 1 ? "" : "s"}`}
            </div>
            <button onClick={() => void copyLog()} className="text-xs text-muted underline hover:text-ink">
              {copied ? "Copied" : "Copy the session log"}
            </button>
          </div>
        )}
        {state.phase === "error" && (
          <div className="bg-card border border-[rgb(var(--danger-rgb)/0.4)] rounded-2xl shadow-card p-5 text-sm text-[rgb(var(--danger-rgb))] space-y-2">
            <p>{state.message}</p>
            <button onClick={() => void copyLog()} className="text-xs text-muted underline hover:text-ink">
              {copied ? "Copied" : "Copy the session log"}
            </button>
          </div>
        )}

        <div className="bg-card border border-edge rounded-2xl shadow-card p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">Verses</div>
            {ayas.length > 0 && (
              <button
                type="button"
                onClick={() => set({ from: { s: settings.from.s, a: 1 }, to: { s: settings.from.s, a: fromSurahMax } })}
                disabled={isWholeSurah}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  isWholeSurah
                    ? "border-primary/30 bg-primary-soft text-primary"
                    : "border-edge bg-ground text-muted hover:text-primary hover:border-primary/40"
                }`}
              >
                {isWholeSurah ? "Whole surah selected" : "Whole surah"}
              </button>
            )}
          </div>
          <VersePicker
            label="From"
            value={settings.from}
            onChange={(from) =>
              set({ from, to: from.s > settings.to.s ? { s: from.s, a: ayas[from.s - 1] ?? 1 } : settings.to })
            }
            names={names}
            ayas={ayas}
          />
          <VersePicker label="To" value={settings.to} onChange={(to) => set({ to })} names={names} ayas={ayas} />
          {!verses.length && ayas.length > 0 && (
            <p className="text-xs text-[rgb(var(--danger-rgb))]">Pick a range that ends after it starts.</p>
          )}
        </div>

        <div className="bg-card border border-edge rounded-2xl shadow-card p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Mode">
            <ModeCard on={!justListen} onClick={() => set({ mode: "recite" })} title="Listen & recite" hint="Hear it, say it back" />
            <ModeCard on={justListen} onClick={() => set({ mode: "listen" })} title="Just listen" hint="Hear it, then move on" />
          </div>
          <div className="mt-3 divide-y divide-edge">
            {justListen ? (
              <Counter label="Listen to each verse" value={settings.listenTimes} min={1} max={20} onChange={(listenTimes) => set({ listenTimes })} />
            ) : (
              <>
                <Counter label={settings.inRow > 1 ? "Rounds" : "Recite each verse"} value={settings.reps} min={1} max={20} onChange={(reps) => set({ reps })} />
                <Counter label="In a row" value={settings.inRow} min={1} max={5} onChange={(inRow) => set({ inRow })} />
              </>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 py-2.5 border-t border-edge">
            <span className="text-[15px] text-ink">Reciter</span>
            <select className={`${selectClass} max-w-[65%]`} value={settings.reciterId} onChange={(e) => set({ reciterId: e.target.value })} aria-label="Reciter">
              {RECITERS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          {reciter.hosted && !missing.length && (
            <p className="text-xs text-muted -mt-1 pb-1">Only {reciter.hosted.surahs.map((s) => names[s - 1] ?? s).join(", ")} so far.</p>
          )}
          {!justListen && availability && !useModel && (
            <div className="flex items-start gap-2.5 text-xs text-ink-soft bg-ground border border-edge rounded-xl px-3.5 py-2.5 mt-2">
              <svg className="w-4 h-4 text-gold shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="leading-relaxed">
                {availability.state === "no-model" ? (
                  <>
                    No speech model downloaded yet — your turn will advance after a quiet pause instead of following word by word.{" "}
                    <Link href="/voice" className="font-semibold text-primary hover:underline">
                      Download model →
                    </Link>
                  </>
                ) : availability.state === "unsupported" ? (
                  "This browser can't run the on-device speech model, so your turn advances after a quiet pause."
                ) : (
                  <>
                    Speech model is turned off, so words won't appear as you recite.{" "}
                    <button className="font-semibold text-primary hover:underline" onClick={() => set({ useModel: true })}>
                      Turn it on
                    </button>
                  </>
                )}
              </p>
            </div>
          )}
          {!justListen && settings.inRow > 1 && (
            <p className="text-xs text-muted mt-2">
              Listen, then recite {settings.inRow}× · {recitations(settings)} recitations of each verse
            </p>
          )}
        </div>

        {reciter.hosted && missing.length > 0 && (
          <p className="text-sm text-muted px-1">
            {reciter.name} is only here for {reciter.hosted.surahs.map((s) => names[s - 1] ?? s).join(", ")} so far. Pick a range in it, or another reciter.
          </p>
        )}

        <details className="group">
          <summary className="flex items-center gap-2 bg-card border border-edge rounded-2xl shadow-card px-4 py-3 text-sm text-muted hover:border-primary/40 cursor-pointer transition-colors list-none [&::-webkit-details-marker]:hidden">
            <span className="flex-1 min-w-0 truncate">{summary}</span>
            <span className="text-xs font-semibold text-primary group-open:hidden">Adjust ›</span>
            <span className="text-xs font-semibold text-primary hidden group-open:inline">Done</span>
          </summary>
          <div className="bg-card border border-edge rounded-2xl shadow-card p-4 sm:p-5 mt-2 space-y-4">
            <Field label="Speed">
              <Segmented label="Speed" value={settings.speed} onChange={(speed) => set({ speed })} options={SPEEDS.map((v) => ({ value: v, label: `${v}×` }))} />
            </Field>
            {!justListen && (
              <>
                <Field label="Your turn">
                  {availability?.state === "ready" && (
                    <div className="mb-3">
                      <Check checked={settings.useModel} onChange={(v) => set({ useModel: v })} title="Use the speech model (shows your words, moves on when you finish)" />
                    </div>
                  )}
                  {availability?.state === "no-model" && (
                    <p className="text-xs text-muted mb-3">
                      Get the speech model in{" "}
                      <Link href="/voice" className="text-primary font-medium hover:underline">
                        voice settings
                      </Link>{" "}
                      to move on when you finish and get hints. Until then your turn ends when you stop.
                    </p>
                  )}
                  {availability?.state === "unsupported" && <p className="text-xs text-muted mb-3">This browser can't run the speech model, so your turn ends when you stop.</p>}
                  {useModel ? (
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs text-muted mb-1.5">Show the next words after a pause of</div>
                        <Segmented label="Hints" value={settings.hintAfterMs} onChange={(hintAfterMs) => set({ hintAfterMs })} options={[{ value: 0, label: "Off" }, ...[2000, 3000, 5000, 8000].map((v) => ({ value: v, label: `${v / 1000} s` }))]} />
                      </div>
                      <div>
                        <div className="text-xs text-muted mb-1.5">Move on if I stop for</div>
                        <Segmented label="Give up" value={settings.giveUpMs} onChange={(giveUpMs) => set({ giveUpMs })} options={[...[10000, 20000, 30000].map((v) => ({ value: v, label: `${v / 1000} s` })), { value: 0, label: "Never" }]} />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-xs text-muted mb-1.5">End my turn after quiet of</div>
                      <Segmented label="Quiet that ends your turn" value={settings.endSilenceMs} onChange={(endSilenceMs) => set({ endSilenceMs })} options={[2000, 3000, 4000, 6000, 8000].map((v) => ({ value: v, label: `${v / 1000} s` }))} />
                    </div>
                  )}
                </Field>
                <Check checked={settings.hideOnMyTurn} onChange={(v) => set({ hideOnMyTurn: v })} title="Hide the verse on my turn" />
                <Check checked={settings.cue} onChange={(v) => set({ cue: v })} title="Beep when it's my turn" />
              </>
            )}
          </div>
        </details>

        <button
          disabled={!verses.length || missing.length > 0 || active}
          onClick={start}
          className="w-full bg-primary text-on-primary rounded-2xl px-4 py-3.5 text-base font-semibold shadow-card hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {verses.length ? `Start · ${verses.length} verse${verses.length > 1 ? "s" : ""}` : "Start"}
        </button>
      </div>

      {/* outside the spaced column: its margins would shift a fixed overlay */}
      {active && (
        <FocusView
          session={session}
          state={state}
          verses={verses}
          surahName={(s) => names[s - 1] ?? `Surah ${s}`}
          words={words}
          reps={plan.reps}
          inRow={plan.inRow}
          listen={plan.listen}
          hide={settings.hideOnMyTurn}
        />
      )}
    </>
  );
}
