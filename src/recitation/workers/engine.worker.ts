/**
 * The engine worker (spec §4): the Quran index and the follow-mode tracker, off the main thread so locating
 * over the whole Quran never delays the UI or the ASR worker. A thin host around ../engine/session.ts.
 */
import { loadRecitationWords, passageWords, wordIndex } from "../engine/data";
import { Reference } from "../engine/reference";
import { FollowSession } from "../engine/session";
import { verify, type HeardUnit } from "../engine/verify";
import type { FromEngine, KeyedEvent, ToEngine } from "./engineProtocol";

const scope = self as unknown as { postMessage(m: FromEngine): void; onmessage: ((e: MessageEvent<ToEngine>) => void) | null };
const post = (m: FromEngine) => scope.postMessage(m);

let ready: Promise<{ ref: Reference; words: Awaited<ReturnType<typeof loadRecitationWords>>; key: string[] }> | null = null;
let symbols: string[] = [];
let session: FollowSession | null = null;
/** every unit heard this session, for verify mode */
let heard: HeardUnit[] = [];

function withKeys(e: KeyedEvent, key: string[]): KeyedEvent {
  switch (e.type) {
    case "heard":
      return { ...e, keys: e.words.map((w) => key[w.idx]) };
    case "candidates":
      return { ...e, keys: e.places.map((p) => key[p.word]) };
    case "located":
    case "cursor":
    case "lost":
      return { ...e, keys: [key[e.word] ?? ""] };
    case "ayahComplete":
      return { ...e, keys: [key[e.afterWord]] };
    default:
      return e;
  }
}

scope.onmessage = async (ev: MessageEvent<ToEngine>) => {
  const m = ev.data;
  try {
    if (m.type === "init") {
      symbols = m.symbols;
      const t0 = performance.now();
      ready ??= loadRecitationWords().then((words) => ({ words, ref: new Reference(words), key: wordIndex(words).key }));
      const { words, ref } = await ready;
      session = new FollowSession(ref, words, symbols);
      heard = [];
      post({ type: "ready", ms: performance.now() - t0, words: ref.wordCount });
    } else if (m.type === "reset") {
      if (!ready) return;
      const { words, ref } = await ready;
      session = new FollowSession(ref, words, symbols);
      heard = [];
    } else if (m.type === "step") {
      if (!ready) return;
      const { key } = await ready; // steps sent while the index is still building wait here, in order
      if (!session) return;
      const t0 = performance.now();
      m.units.forEach((unit, i) => heard.push({ unit, time: m.frames[i] * 0.04 }));
      const events = session.push(m.units, m.step, m.time).map((e) => withKeys(e, key));
      post({ type: "events", step: m.step, events, ms: performance.now() - t0 });
    } else if (m.type === "verify") {
      if (!ready || !session) return;
      const { words, ref, key } = await ready;
      const t0 = performance.now();
      const range = session.passage();
      if (!range) {
        post({ type: "verified", result: { from: null, to: null, ayat: [], findings: [], cleared: 0, ms: performance.now() - t0 } });
        return;
      }
      const table = { symbols, blank: m.blank };
      const { findings, candidates } = verify(heard, { data: m.logprobs, vocab: m.vocab, blank: m.blank }, words, table, ref, range.from, range.to);
      const ayat = [...new Set(passageWords(words, range.from, range.to).map((w) => key[w].split(":").slice(0, 2).join(":")))];
      post({
        type: "verified",
        result: {
          from: range.from,
          to: range.to,
          ayat,
          findings: findings.map((f) => ({
            kind: f.kind,
            keys: f.words.map((w) => key[w]),
            time: f.time,
            ...(f.ayah ? { ayah: f.ayah } : {}),
            ...(f.expected !== undefined ? { expected: key[f.expected] } : {}),
          })),
          cleared: candidates.filter((c) => c.verdict !== "confirmed").length,
          ms: performance.now() - t0,
        },
      });
    }
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
