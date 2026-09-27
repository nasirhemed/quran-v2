/**
 * The light entry point to the voice session: screens import this, and the session itself (ASR and engine
 * workers, model loading) is fetched only when voice is first used. Keeps the reader's bundle unchanged.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { VoiceSession, VoiceState } from "./voice";

let loading: Promise<VoiceSession> | null = null;
let loaded: VoiceSession | null = null;

export function loadVoice(): Promise<VoiceSession> {
  return (loading ??= import("./voice").then((m) => (loaded = m.VoiceSession.get())));
}

/** The session once loaded (null before). */
export function voiceNow(): VoiceSession | null {
  return loaded;
}

const noop = () => () => undefined;

/**
 * Subscribes to the voice session. With `load`, fetches and initialises it (model, Quran index) on mount;
 * without, returns its state only if something else already started it (e.g. the reader showing an
 * in-progress Follow session).
 */
export function useVoice(load: boolean): { session: VoiceSession | null; state: VoiceState | null } {
  const [session, setSession] = useState<VoiceSession | null>(loaded);
  useEffect(() => {
    if (!load || session) return;
    let live = true;
    void loadVoice().then((s) => {
      if (!live) return;
      setSession(s);
      void s.init();
    });
    return () => {
      live = false;
    };
  }, [load, session]);
  useEffect(() => {
    if (load && session) void session.init();
  }, [load, session]);
  const state = useSyncExternalStore(session ? session.subscribe : noop, () => (session ? session.getState() : null));
  return { session, state };
}
