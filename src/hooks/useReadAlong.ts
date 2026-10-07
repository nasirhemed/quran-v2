import { useEffect, useMemo, useRef, useState } from "react";
import { useVoice } from "@/recitation/session/lazy";
import { getVoiceSupport } from "@/recitation/support";
import { readAlongProgress, type ReadAlongProgress } from "@/lib/readAlong";
import type { PracticeIndex, PracticeQuestion } from "@/lib/practice";

export interface ReadAlong {
  listening: boolean;
  /** why nothing is happening yet, or what the mic is doing: "" when there is nothing to say */
  status: string;
  needsModel: boolean;
  progress: ReadAlongProgress;
  toggle: () => void;
}

/**
 * Practice's read-along: listen with the shared voice session (the one Follow mode in the reader uses) and say
 * how much of the question's passage has been recited. The session loads only when the mic is first tapped.
 * Listening stops with the question, and once the whole passage is recited.
 */
export function useReadAlong(index: PracticeIndex, question: PracticeQuestion): ReadAlong {
  const [wanted, setWanted] = useState(false);
  const [began, setBegan] = useState(false); // tapped at least once: only then is the session's transcript this question's
  const { session, state } = useVoice(wanted);
  const phase = state?.phase;
  const listening = phase === "listening" || phase === "stopping";
  const started = useRef(false);
  const cleared = useRef(false);
  const begin = (s: NonNullable<typeof session>) => {
    started.current = true;
    if (!cleared.current) s.clear(); // a fresh transcript for this question; a restart keeps what was recited
    cleared.current = true;
    void s.start();
  };

  // First tap loads the session; start as soon as it is ready, with an empty transcript.
  useEffect(() => {
    if (wanted && session && phase === "ready" && !started.current) {
      begin(session);
    }
  }, [wanted, session, phase]);

  const progress = useMemo(
    () =>
      readAlongProgress(index, question, {
        keys: began && state ? state.paragraphs.flatMap((p) => p.items.map((it) => it.key)) : [],
        ayahEnds: began && state ? state.paragraphs.flatMap((p) => (p.ayahEnd ? [p.ayahEnd] : [])) : [],
      }),
    [index, question, began, state?.paragraphs]
  );

  const stop = () => {
    started.current = false;
    setWanted(false);
    void session?.stop();
  };
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // the next question starts from a fresh tap
  useEffect(() => {
    return () => {
      void sessionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (listening && progress.current === null) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, progress.current]);

  const loading = wanted && !listening && (phase === "checking" || phase === "loading" || !session);
  const status = (() => {
    if (phase === "no-model") return "Download the speech model first";
    if (state?.message) return state.message;
    if (loading) return "Loading…";
    if (phase === "stopping") return "Finishing…";
    if (!listening) return "";
    if (state?.behind) return "Can't keep up on this device";
    if (state?.tracking) return "Listening…";
    return "Listening… recite on from the prompt";
  })();

  const toggle = () => {
    if (listening) return stop();
    started.current = false;
    setBegan(true);
    setWanted(true);
    if (session && phase === "ready") begin(session); // already loaded: start inside this tap
  };

  return { listening, status, needsModel: phase === "no-model", progress, toggle };
}

export const readAlongSupported = (): boolean => getVoiceSupport().supported;
