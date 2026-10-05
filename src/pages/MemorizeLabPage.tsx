import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { fetchQuranPages, fetchSurahs } from "@/lib/data";
import { RECITERS, versesInRange, type Verse } from "@/lab/memorize";
import { MemorizeLab, type LabConfig, type Mic, type MicMode } from "@/lab/MemorizeLab";
import { modelAvailability, type ModelAvailability } from "@/lab/LabRecognizer";

/**
 * `/lab/memorize`: a prototype of the memorisation loop (the reciter recites a verse, you recite it back, N times,
 * then the next verse), built to try the microphone setups in a car on Bluetooth before designing the feature.
 * Not linked from the app. Everything it does is logged; "Copy log" gives a text report to paste into a chat.
 */

interface Settings extends LabConfig {
  from: Verse;
  to: Verse;
  reciterId: string;
  /** hide the verse on your turn; its words appear as the model hears them */
  hideOnMyTurn: boolean;
}

const KEY = "memorizeLab";
const DEFAULTS: Settings = {
  from: { s: 112, a: 1 },
  to: { s: 112, a: 4 },
  reps: 3,
  reciterId: RECITERS[0].id,
  micMode: "always",
  deviceId: "",
  voiceProcessing: false,
  endSilenceMs: 3000,
  thresholdDb: 10,
  cue: true,
  gapMs: 0,
  audioSessionHints: true,
  useModel: true,
  giveUpQuietMs: 6000,
  hideOnMyTurn: false,
};

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    // saved before turns could end on the speech model: the old 2 s default cut people off mid-breath
    if (saved.giveUpQuietMs === undefined) delete saved.endSilenceMs;
    return { ...DEFAULTS, ...saved };
  } catch {
    return DEFAULTS;
  }
}

const hasAudioSession = typeof navigator !== "undefined" && "audioSession" in navigator;

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
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

function VersePicker({ value, onChange, names, ayas }: { value: Verse; onChange: (v: Verse) => void; names: string[]; ayas: number[] }) {
  return (
    <div className="flex gap-2">
      <select className={`${selectClass} flex-1`} value={value.s} onChange={(e) => onChange({ s: Number(e.target.value), a: 1 })} aria-label="Surah">
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
        aria-label="Verse"
      />
    </div>
  );
}

/**
 * The verse being memorised. On your turn the words the speech model has heard are marked; with "hide", the
 * others are blank until heard (tap to see them all).
 */
function VerseView({ words, heard, hide, onPeek }: { words: { key: string; text: string }[]; heard: Set<string>; hide: boolean; onPeek: () => void }) {
  if (!words.length) return null;
  return (
    <p dir="rtl" lang="ar" onClick={onPeek} className="font-arabic text-2xl leading-[2.2] text-ink text-center max-h-64 overflow-auto cursor-pointer select-none">
      {words.map((w) => {
        const got = heard.has(w.key);
        return (
          <span key={w.key} className={`transition-colors ${got ? "text-primary" : hide ? "text-transparent border-b border-edge-strong" : ""}`}>
            {w.text}{" "}
          </span>
        );
      })}
    </p>
  );
}

const ACTIVITY: Record<string, string> = {
  loading: "Loading…",
  gap: "…",
  playing: "Listen",
  "mic-opening": "Opening the mic…",
  listening: "Your turn",
};

export default function MemorizeLabPage() {
  const [lab] = useState(() => new MemorizeLab());
  const state = useSyncExternalStore(lab.subscribe, lab.getState);
  const { data: surahs } = useQuery({ queryKey: ["surahs"], queryFn: fetchSurahs });
  const { data: pages } = useQuery({ queryKey: ["quran-pages"], queryFn: fetchQuranPages });
  const [availability, setAvailability] = useState<ModelAvailability | null>(null);
  const [peek, setPeek] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [mics, setMics] = useState<Mic[]>([]);
  const [micError, setMicError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const logRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    return () => lab.dispose();
  }, [lab]);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* private mode */
    }
  }, [settings]);
  useEffect(() => {
    if (typeof location !== "undefined" && new URLSearchParams(location.search).has("debug")) (window as unknown as Record<string, unknown>).__memorizeLab = lab;
  }, [lab]);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.logCount]);
  // the names of microphones already allowed, without asking
  useEffect(() => {
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => setMics(d.filter((x) => x.kind === "audioinput" && x.label).map((x) => ({ id: x.deviceId, label: x.label }))))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void modelAvailability()
      .then(setAvailability)
      .catch(() => setAvailability({ state: "unsupported", missing: ["on-device file storage"] }));
  }, []);
  /** each verse's words, "s:a" → [{ key "s:a:w", text }] */
  const verseWords = useMemo(() => {
    const m = new Map<string, { key: string; text: string }[]>();
    for (const p of pages ?? [])
      for (const g of p.surahGroups)
        for (const a of g.ayahs) m.set(`${a.surah}:${a.ayah}`, a.words.map((w) => ({ key: `${a.surah}:${a.ayah}:${w.position}`, text: w.text })));
    return m;
  }, [pages]);
  // read at each turn, so the log's word totals work even if the pages arrive after Start
  const verseWordsRef = useRef(verseWords);
  verseWordsRef.current = verseWords;
  const names = useMemo(() => surahs?.map((s) => s.tname) ?? [], [surahs]);
  const ayas = useMemo(() => surahs?.map((s) => s.ayas) ?? [], [surahs]);
  const verses = useMemo(() => (ayas.length ? versesInRange(ayas, settings.from, settings.to) : []), [ayas, settings.from, settings.to]);
  const reciter = RECITERS.find((r) => r.id === settings.reciterId) ?? RECITERS[0];
  const savedMicMissing = settings.deviceId !== "" && !mics.some((m) => m.id === settings.deviceId);
  const deviceLabel = mics.find((m) => m.id === settings.deviceId)?.label ?? (settings.deviceId ? "a saved mic" : "");
  const set = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  // still checking counts as available: the session falls back to quiet by itself if the model can't load
  const useModel = settings.useModel && availability?.state !== "no-model" && availability?.state !== "unsupported";

  const findMics = async () => {
    setMicError(null);
    try {
      setMics(await MemorizeLab.listMics());
    } catch (e) {
      setMicError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Every run kept so far, plus the one in progress: one paste covers a whole test. */
  const fullLog = () => [lab.allReports(), active ? lab.report() : ""].filter(Boolean).join("\n\n════════════════════════════════════════\n\n");
  const copyLog = async () => {
    try {
      await navigator.clipboard.writeText(fullLog());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      downloadLog();
    }
  };
  const downloadLog = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([fullLog()], { type: "text/plain" }));
    a.download = `memorize-lab-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const active = state.phase === "running" || state.phase === "paused" || state.phase === "starting";
  const step = state.step;
  const verse = step ? verses[step.verse] : null;
  const yourTurn = step?.turn === "you";
  const shownWords = verse ? (verseWords.get(`${verse.s}:${verse.a}`) ?? []) : [];
  const heardSet = useMemo(() => new Set(yourTurn ? state.heard : []), [yourTurn, state.heard]);
  // a new verse or turn hides it again
  useEffect(() => {
    setPeek(false);
  }, [step?.verse, step?.rep, step?.turn]);
  const levelPct = Math.max(0, Math.min(100, ((state.level + 70) / 70) * 100));

  return (
    <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Memorize · prototype</h1>
        <p className="text-sm text-muted mt-1">
          The reciter recites a verse, then you recite it, {settings.reps} times, then the next verse. For trying the microphone setups (for example in
          the car); not part of the app yet.
        </p>
      </div>

      {!active && (
        <div className="bg-card border border-edge rounded-xl p-5 space-y-5">
          <Field label="From">
            <VersePicker value={settings.from} onChange={(from) => set({ from, to: from.s > settings.to.s ? { s: from.s, a: ayas[from.s - 1] ?? 1 } : settings.to })} names={names} ayas={ayas} />
          </Field>
          <Field label="To" hint={verses.length ? `${verses.length} verse${verses.length > 1 ? "s" : ""}` : "Pick a range that ends after it starts"}>
            <VersePicker value={settings.to} onChange={(to) => set({ to })} names={names} ayas={ayas} />
          </Field>
          <Field label="Repetitions">
            <Segmented label="Repetitions" value={settings.reps} onChange={(reps) => set({ reps })} options={[1, 2, 3, 5, 7, 10].map((n) => ({ value: n, label: String(n) }))} />
          </Field>
          <Field label="Reciter">
            <select className={`${selectClass} w-full`} value={settings.reciterId} onChange={(e) => set({ reciterId: e.target.value })}>
              {RECITERS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Microphone"
            hint={
              settings.micMode === "always"
                ? "Opens once at Start and stays open; what it hears while the reciter plays is ignored."
                : "Opens when it's your turn and is released while the reciter plays."
            }
          >
            <Segmented<MicMode>
              label="Microphone"
              value={settings.micMode}
              onChange={(micMode) => set({ micMode })}
              options={[
                { value: "always", label: "On the whole time" },
                { value: "turn", label: "Only on my turn" },
              ]}
            />
          </Field>
          <Field
            label="Which microphone"
            hint="Tap Find mics, then try both. The phone's own mic is 'Speakerphone' on Android and 'iPhone Microphone' on iPhone; System default is usually the car's mic, which puts the car in call mode."
          >
            <div className="flex gap-2">
              <select className={`${selectClass} flex-1`} value={settings.deviceId} onChange={(e) => set({ deviceId: e.target.value })}>
                <option value="">System default</option>
                {savedMicMissing && <option value={settings.deviceId}>Saved mic (tap Find mics to see its name)</option>}
                {mics.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <button onClick={() => void findMics()} className="border border-edge-strong text-ink rounded-lg px-3 py-2 text-sm hover:bg-card2">
                Find mics
              </button>
            </div>
            {micError && <p className="text-xs text-red-400 mt-1">{micError}</p>}
          </Field>
          <Field label="When my turn ends">
            {availability?.state === "ready" && (
              <label className="flex items-start gap-2 text-sm text-ink mb-3">
                <input type="checkbox" className="mt-1" checked={settings.useModel} onChange={(e) => set({ useModel: e.target.checked })} />
                <span>
                  When I finish the verse (speech model)
                  <span className="block text-xs text-muted">It listens on your turn and moves on once you reach the verse's last word, so a breath never ends your turn.</span>
                </span>
              </label>
            )}
            {availability?.state === "no-model" && (
              <p className="text-xs text-muted mb-3">
                To move on when you finish the verse, download the speech model (73 MB) in{" "}
                <Link href="/voice" className="underline hover:text-ink">
                  voice settings
                </Link>
                . Until then, your turn ends on quiet.
              </p>
            )}
            {availability?.state === "unsupported" && (
              <p className="text-xs text-muted mb-3">This browser can't run the speech model (it needs {availability.missing.join(", ")}), so your turn ends on quiet.</p>
            )}
            {useModel ? (
              <>
                <div className="text-xs text-muted mb-1.5">…or if I stop for</div>
                <Segmented
                  label="Quiet that moves on"
                  value={settings.giveUpQuietMs}
                  onChange={(giveUpQuietMs) => set({ giveUpQuietMs })}
                  options={[4000, 6000, 8000, 10000].map((v) => ({ value: v, label: `${v / 1000} s` }))}
                />
              </>
            ) : (
              <>
                <div className="text-xs text-muted mb-1.5">After this much quiet (longer early in the verse, for a breath)</div>
                <Segmented
                  label="Quiet that ends your turn"
                  value={settings.endSilenceMs}
                  onChange={(endSilenceMs) => set({ endSilenceMs })}
                  options={[2000, 3000, 4000, 5000, 6000].map((v) => ({ value: v, label: `${v / 1000} s` }))}
                />
              </>
            )}
          </Field>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" className="mt-1" checked={settings.hideOnMyTurn} onChange={(e) => set({ hideOnMyTurn: e.target.checked })} />
            <span>
              Hide the verse on my turn
              <span className="block text-xs text-muted">{useModel ? "Its words appear as you recite them. Tap the verse to see it all." : "Tap the verse to see it."}</span>
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={settings.cue} onChange={(e) => set({ cue: e.target.checked })} />
            Beep when it's my turn
          </label>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">More settings</summary>
            <div className="space-y-4 mt-4">
              <label className="flex items-start gap-2 text-ink">
                <input type="checkbox" className="mt-1" checked={settings.voiceProcessing} onChange={(e) => set({ voiceProcessing: e.target.checked })} />
                <span>
                  Voice processing (echo cancellation, noise suppression)
                  <span className="block text-xs text-muted">The app's speech recognition turns these off. On some phones they also switch Bluetooth into call mode.</span>
                </span>
              </label>
              <Field label="Pause before the reciter starts again" hint="If the start of the verse gets cut off in 'only on my turn' mode, try a longer pause.">
                <Segmented label="Pause before reciter" value={settings.gapMs} onChange={(gapMs) => set({ gapMs })} options={[0, 500, 1000, 1500, 2500].map((v) => ({ value: v, label: `${v / 1000} s` }))} />
              </Field>
              <Field label="Speech threshold above the noise" hint="Higher if road noise ends your turn too late; lower if it ends while you are still reciting.">
                <Segmented label="Speech threshold" value={settings.thresholdDb} onChange={(thresholdDb) => set({ thresholdDb })} options={[6, 8, 10, 12, 15].map((v) => ({ value: v, label: `${v} dB` }))} />
              </Field>
              {hasAudioSession && (
                <label className="flex items-start gap-2 text-ink">
                  <input type="checkbox" className="mt-1" checked={settings.audioSessionHints} onChange={(e) => set({ audioSessionHints: e.target.checked })} />
                  <span>
                    Tell Safari which turn it is (audio session)
                    <span className="block text-xs text-muted">"Playback" while the reciter plays, "play and record" for your turn.</span>
                  </span>
                </label>
              )}
            </div>
          </details>
          <button
            disabled={!verses.length}
            onClick={() => void lab.start({ ...settings, deviceLabel, useModel }, verses, reciter, (ayah) => verseWordsRef.current.get(ayah)?.length ?? NaN)}
            className="w-full bg-primary text-on-primary rounded-lg px-4 py-3 text-base font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Start
          </button>
          {state.phase === "error" && <p className="text-sm text-red-400">{state.message}</p>}
          {state.phase === "done" && <p className="text-sm text-muted">Done. Copy the log below and paste it into the chat.</p>}
        </div>
      )}

      {active && (
        <div className="bg-card border border-edge rounded-xl p-5 space-y-5">
          <div className="text-center">
            <div className="text-sm text-muted">
              {verse ? `${names[verse.s - 1] ?? ""} ${verse.s}:${verse.a}` : ""}
              {step ? ` · ${step.verse + 1} of ${verses.length}` : ""}
            </div>
            <div className={`text-5xl font-bold mt-3 ${yourTurn && state.activity === "listening" ? "text-primary" : "text-ink"}`}>
              {state.phase === "paused" ? "Paused" : state.phase === "starting" ? "Starting…" : ACTIVITY[state.activity ?? ""] ?? "…"}
            </div>
            {step && (
              <div className="flex justify-center gap-1.5 mt-4" aria-label={`Repetition ${step.rep} of ${settings.reps}`}>
                {Array.from({ length: settings.reps }, (_, i) => (
                  <span key={i} className={`h-2.5 w-2.5 rounded-full ${i + 1 < step.rep || (i + 1 === step.rep && yourTurn) ? "bg-primary" : i + 1 === step.rep ? "bg-gold" : "bg-card2 border border-edge"}`} />
                ))}
              </div>
            )}
          </div>

          <VerseView words={shownWords} heard={heardSet} hide={settings.hideOnMyTurn && yourTurn && !peek} onPeek={() => setPeek(true)} />

          <div>
            <div className="h-2 rounded-full bg-card2 overflow-hidden">
              <div className={`h-full transition-[width] duration-75 ${state.speaking ? "bg-primary" : "bg-muted"}`} style={{ width: `${levelPct}%` }} />
            </div>
            <div className="flex justify-between text-xs text-muted mt-1">
              <span>{state.micLabel ? `Mic: ${state.micLabel}` : "Mic off"}</span>
              <span>{state.activity === "listening" ? (state.speaking ? "hearing you" : `quiet · floor ${state.floorDb.toFixed(0)} dB`) : ""}</span>
            </div>
            <div className="text-xs text-muted mt-1 text-center">
              {state.model === "ready" && (state.verseDone && yourTurn ? "✓ verse complete" : "Speech model: moves on when you finish the verse")}
              {state.model === "loading" && "Speech model loading… (ends on quiet until it's ready)"}
              {state.model === "failed" && "Speech model unavailable: ends on quiet"}
              {state.model === "off" && "Ends on quiet"}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {state.phase === "paused" ? (
              <button onClick={() => lab.resume()} className="col-span-2 bg-primary text-on-primary rounded-xl py-6 text-2xl font-bold">
                Resume
              </button>
            ) : (
              <button onClick={() => lab.pause()} disabled={state.phase !== "running"} className="col-span-2 bg-primary text-on-primary rounded-xl py-6 text-2xl font-bold disabled:opacity-50">
                Pause
              </button>
            )}
            <button
              onClick={() => lab.done()}
              disabled={state.activity !== "listening"}
              className="col-span-2 border-2 border-primary text-primary rounded-xl py-4 text-lg font-semibold disabled:opacity-30"
            >
              I'm done
            </button>
            <button onClick={() => lab.again()} className="border border-edge-strong text-ink rounded-lg py-3 text-sm font-medium hover:bg-card2">
              Again
            </button>
            <button onClick={() => lab.skip()} className="border border-edge-strong text-ink rounded-lg py-3 text-sm font-medium hover:bg-card2">
              Next verse
            </button>
            <button onClick={() => lab.stop()} className="col-span-2 text-muted text-sm py-2 hover:text-ink">
              Stop
            </button>
          </div>
          <p className="text-xs text-muted text-center">
            The car's play/pause (pause/resume), next (next verse) and previous (again) buttons may work too: every press is logged. On Android
            they only reach the page for verses longer than 5 s.
          </p>
        </div>
      )}

      {(state.logCount > 0 || state.runs > 0) && (
        <div className="bg-card border border-edge rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-ink">Log</h2>
              {state.runs > 0 && (
                <p className="text-xs text-muted">
                  {state.runs} run{state.runs > 1 ? "s" : ""} kept · Copy includes them all ·{" "}
                  <button onClick={() => lab.clearRuns()} className="underline hover:text-ink">
                    clear
                  </button>
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => void copyLog()} className="bg-primary text-on-primary rounded-lg px-3 py-1.5 text-xs font-semibold">
                {copied ? "Copied" : "Copy log"}
              </button>
              <button onClick={downloadLog} className="border border-edge-strong text-ink rounded-lg px-3 py-1.5 text-xs">
                Download
              </button>
            </div>
          </div>
          <pre ref={logRef} className="text-[11px] leading-snug text-ink-soft bg-card2 rounded-lg p-3 max-h-72 overflow-auto whitespace-pre-wrap">
            {lab.log.slice(-200).map((l) => `${l.t.toFixed(2).padStart(7)}  ${l.text}`).join("\n")}
          </pre>
        </div>
      )}

      {state.recordings.length > 0 && (
        <div className="bg-card border border-edge rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-ink">What the mic heard on your turns</h2>
          <p className="text-xs text-muted">Listen for how clear it is: the car's mic over Bluetooth often sounds like a phone call.</p>
          <ul className="space-y-2">
            {[...state.recordings].reverse().map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <span className="text-xs text-muted w-28 shrink-0">{r.label}</span>
                <audio controls src={r.url} className="h-8 flex-1 min-w-0" />
                <a href={r.url} download={`turn-${r.label.replace(/[^\w]+/g, "-")}.${r.mime.includes("mp4") ? "m4a" : "webm"}`} className="text-xs text-muted underline">
                  Save
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
