/**
 * The live transcript (spec §8.3): final words, at most one partial word, and annotations from the engine.
 * Pure TS; the UI subscribes and re-renders at most once per model step.
 */
import type { MistakeKind } from "../engine/verify";

export type AlignStatus = "match" | "near" | "repeat" | "extra" | "opener";

export interface HeardWord {
  id: number; // increases within a session
  text: string;
  source: "asr" | "aligned"; // model A's decoded text, or the Quran word model B's phonemes aligned to
  startFrame: number;
  endFrame: number;
  final: boolean;
}

export interface TranscriptWord extends HeardWord {
  alignedTo?: number;
  status?: AlignStatus;
  mistake?: MistakeKind; // only from a confirmed finding, removed by cleared
}

export interface TranscriptSession {
  id: string;
  startedAt: number;
  words: TranscriptWord[];
  ayahBreaks: { afterWordId: number; surah: number; ayah: number }[];
}

export class TranscriptStore {
  private session: TranscriptSession;
  private listeners = new Set<(s: TranscriptSession) => void>();
  private batching = 0;
  private dirty = false;

  constructor(id = "session", startedAt = Date.now()) {
    this.session = { id, startedAt, words: [], ayahBreaks: [] };
  }

  get snapshot(): TranscriptSession {
    return this.session;
  }

  subscribe(fn: (s: TranscriptSession) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Group updates (one model step) into a single notification. */
  batch(fn: () => void) {
    this.batching++;
    try {
      fn();
    } finally {
      if (--this.batching === 0 && this.dirty) this.notify();
    }
  }

  /** Add final words; they replace the partial word if one is shown. */
  appendFinal(words: Omit<HeardWord, "final">[]) {
    const kept = this.session.words.filter((w) => w.final);
    this.update({ ...this.session, words: [...kept, ...words.map((w) => ({ ...w, final: true }))] });
  }

  /** Show (or clear, with null) the in-progress word. Final words never change text. */
  setPartial(word: Omit<HeardWord, "final"> | null) {
    const kept = this.session.words.filter((w) => w.final);
    this.update({ ...this.session, words: word ? [...kept, { ...word, final: false }] : kept });
  }

  /** On stop: the partial word becomes final (spec §8.4 flush). */
  flush() {
    this.update({ ...this.session, words: this.session.words.map((w) => (w.final ? w : { ...w, final: true })) });
  }

  annotate(id: number, patch: Pick<TranscriptWord, "alignedTo" | "status">) {
    this.patch(id, (w) => ({ ...w, ...patch }));
  }

  markMistake(id: number, kind: MistakeKind) {
    this.patch(id, (w) => ({ ...w, mistake: kind }));
  }

  clearMistake(id: number) {
    this.patch(id, ({ mistake: _drop, ...w }) => w);
  }

  ayahComplete(afterWordId: number, surah: number, ayah: number) {
    this.update({ ...this.session, ayahBreaks: [...this.session.ayahBreaks, { afterWordId, surah, ayah }] });
  }

  /** Plain text of the final words, for "Copy text". */
  text() {
    return this.session.words.filter((w) => w.final).map((w) => w.text).join(" ");
  }

  private patch(id: number, fn: (w: TranscriptWord) => TranscriptWord) {
    this.update({ ...this.session, words: this.session.words.map((w) => (w.id === id ? fn(w) : w)) });
  }

  private update(next: TranscriptSession) {
    this.session = next;
    if (this.batching) this.dirty = true;
    else this.notify();
  }

  private notify() {
    this.dirty = false;
    this.listeners.forEach((fn) => fn(this.session));
  }
}
