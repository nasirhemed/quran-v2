import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { fetchQuranPages, fetchSurahs } from "@/lib/data";
import { DEFAULT_RECITER, RECITERS, versesInRange, type Verse } from "@/lib/memorize";
import { MemorizeSession, type MemorizeConfig } from "@/memorize/session";
import { modelAvailability, type ModelAvailability } from "@/memorize/recognizer";
import FocusView, { SPEEDS } from "@/components/memorize/FocusView";

/**
 * Memorize: pick verses, how many times to listen first and to recite each, and a reciter; then the session runs
 * full screen (FocusView). The session itself is src/memorize/session.ts; this page is setup and the summary.
 */

interface Settings extends Omit<MemorizeConfig, "useModel"> {
  from: Verse;
  to: Verse;
  reciterId: string;
  useModel: boolean;
  /** hide the verse on your turn: words appear as the speech model hears them */
  hideOnMyTurn: boolean;
}

const KEY = "memorize";
const DEFAULTS: Settings = {
  from: { s: 112, a: 1 },
  to: { s: 112, a: 4 },
  reps: 3,
  listen: 0,
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

const selectClass = "min-w-0 bg-card2 border border-edge rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary";

function Segmented<T extends string | number>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-edge bg-card2 p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-md text-sm transition-colors ${value === o.value ? "bg-primary text-on-primary font-semibold" : "text-muted hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function VersePicker({ label, value, onChange, names, ayas }: { label: string; value: Verse; onChange: (v: Verse) => void; names: string[]; ayas: number[] }) {
  return (
    <div className="flex gap-2">
      <select className={`${selectClass} flex-1`} value={value.s} onChange={(e) => onChange({ s: Number(e.target.value), a: 1 })} aria-label={`${label} surah`}>
        {names.map((n, i) => (
          <option key={i} value={i + 1}>
            {i + 1}. {n}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={1}
        max={ayas[value.s - 1] ?? 1}
        value={value.a}
        onChange={(e) => onChange({ ...value, a: Number(e.target.value) })}
        className={`${selectClass} w-20`}
        aria-label={`${label} verse`}
      />
    </div>
  );
}

function Check({ checked, onChange, title, hint }: { checked: boolean; onChange: (v: boolean) => void; title: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {title}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
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

  /** each verse's words, "s:a" → [{ key "s:a:w", text }] */
  const verseWords = useMemo(() => {
    const m = new Map<string, { key: string; text: string }[]>();
    for (const p of pages ?? []) for (const g of p.surahGroups) for (const a of g.ayahs) m.set(`${a.surah}:${a.ayah}`, a.words.map((w) => ({ key: `${a.surah}:${a.ayah}:${w.position}`, text: w.text })));
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
  const set = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  // still checking counts as available: the session falls back to quiet by itself if the model can't load
  const useModel = settings.useModel && availability?.state !== "no-model" && availability?.state !== "unsupported";
  const active = state.phase === "running" || state.phase === "paused" || state.phase === "starting";

  // full screen while a session runs, where the browser allows it (not on iPhone: there the view fills the page)
  useEffect(() => {
    if (!active) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    }
  }, [active]);

  const start = () => {
    void document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => undefined);
    void session.start({ ...settings, useModel }, verses, reciter, (ayah) => verseWordsRef.current.get(ayah)?.length ?? NaN);
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

  return (
    <>
      <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-ink mb-2">Memorize</h1>
          <p className="text-muted text-sm">Listen to a verse, recite it, and repeat, verse by verse. The speech model knows when you have finished, and helps when you get stuck.</p>
        </div>

        {(state.phase === "done" || (state.phase === "idle" && state.turns > 0)) && (
          <div className="bg-card border border-edge rounded-xl p-5 text-center space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">{state.phase === "done" ? "Session complete" : "Session stopped"}</div>
            <div className="text-ink">
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
          <div className="bg-card border border-edge rounded-xl p-5 text-sm text-red-400 space-y-2">
            <p>{state.message}</p>
            <button onClick={() => void copyLog()} className="text-xs text-muted underline hover:text-ink">
              {copied ? "Copied" : "Copy the session log"}
            </button>
          </div>
        )}

        <div className="bg-card border border-edge rounded-xl p-5 space-y-5">
          <Field label="From">
            <VersePicker label="From" value={settings.from} onChange={(from) => set({ from, to: from.s > settings.to.s ? { s: from.s, a: ayas[from.s - 1] ?? 1 } : settings.to })} names={names} ayas={ayas} />
          </Field>
          <Field label="To" hint={verses.length ? `${verses.length} verse${verses.length > 1 ? "s" : ""}` : "Pick a range that ends after it starts"}>
            <VersePicker label="To" value={settings.to} onChange={(to) => set({ to })} names={names} ayas={ayas} />
          </Field>
          <Field label="Listen first" hint={settings.listen ? `The reciter recites each verse ${settings.listen} time${settings.listen > 1 ? "s" : ""} before your first turn.` : "Straight into listen, recite, listen, recite."}>
            <Segmented label="Listen first" value={settings.listen} onChange={(listen) => set({ listen })} options={[0, 1, 2, 3, 5].map((n) => ({ value: n, label: n ? `${n}×` : "No" }))} />
          </Field>
          <Field label="Recite each verse">
            <Segmented label="Recite each verse" value={settings.reps} onChange={(reps) => set({ reps })} options={[1, 2, 3, 5, 7, 10].map((n) => ({ value: n, label: `${n}×` }))} />
          </Field>
          <Field label="Reciter">
            <div className="flex gap-2">
              <select className={`${selectClass} flex-1`} value={settings.reciterId} onChange={(e) => set({ reciterId: e.target.value })}>
                {RECITERS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="Speed" hint="Change it during the session too: tap the speed at the top.">
            <Segmented label="Speed" value={settings.speed} onChange={(speed) => set({ speed })} options={SPEEDS.map((v) => ({ value: v, label: `${v}×` }))} />
          </Field>

          <Field label="Your turn">
            {availability?.state === "ready" && (
              <div className="mb-3">
                <Check
                  checked={settings.useModel}
                  onChange={(v) => set({ useModel: v })}
                  title="Move on when I finish the verse (speech model)"
                  hint="It listens on your turn: pauses to breathe or think never end it."
                />
              </div>
            )}
            {availability?.state === "no-model" && (
              <p className="text-xs text-muted mb-3">
                For your turn to end when you finish the verse, with hints when you get stuck, download the speech model (73 MB) in{" "}
                <Link href="/voice" className="underline hover:text-ink">
                  voice settings
                </Link>
                . Until then, your turn ends when you stop.
              </p>
            )}
            {availability?.state === "unsupported" && <p className="text-xs text-muted mb-3">This browser can't run the speech model ({availability.missing.join(", ")}), so your turn ends when you stop.</p>}
            {useModel ? (
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-muted mb-1.5">When I pause, show the next words after</div>
                  <Segmented label="Hints" value={settings.hintAfterMs} onChange={(hintAfterMs) => set({ hintAfterMs })} options={[{ value: 0, label: "No hints" }, ...[2000, 3000, 5000, 8000].map((v) => ({ value: v, label: `${v / 1000} s` }))]} />
                </div>
                <div>
                  <div className="text-xs text-muted mb-1.5">Move on if I stop for</div>
                  <Segmented label="Give up" value={settings.giveUpMs} onChange={(giveUpMs) => set({ giveUpMs })} options={[...[10000, 20000, 30000].map((v) => ({ value: v, label: `${v / 1000} s` })), { value: 0, label: "Never" }]} />
                </div>
              </div>
            ) : (
              <div>
                <div className="text-xs text-muted mb-1.5">Ends after this much quiet (longer early in the verse, for a breath)</div>
                <Segmented label="Quiet that ends your turn" value={settings.endSilenceMs} onChange={(endSilenceMs) => set({ endSilenceMs })} options={[2000, 3000, 4000, 6000, 8000].map((v) => ({ value: v, label: `${v / 1000} s` }))} />
              </div>
            )}
          </Field>
          <Check
            checked={settings.hideOnMyTurn}
            onChange={(v) => set({ hideOnMyTurn: v })}
            title="Hide the verse on my turn"
            hint={useModel ? "Its words appear as you recite them (and as hints). Tap the verse to see it all." : "Tap the verse to see it."}
          />
          <Check checked={settings.cue} onChange={(v) => set({ cue: v })} title="Beep when it's my turn" />

          <button
            disabled={!verses.length || active}
            onClick={start}
            className="w-full bg-primary text-on-primary rounded-lg px-4 py-3 text-base font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Start
          </button>
        </div>
      </div>

      {/* outside the spaced column: its margins would shift a fixed overlay */}
      {active && (
        <FocusView
          session={session}
          state={state}
          verses={verses}
          surahName={(s) => names[s - 1] ?? `Surah ${s}`}
          words={words}
          reps={settings.reps}
          listen={settings.listen}
          hide={settings.hideOnMyTurn}
        />
      )}
    </>
  );
}
