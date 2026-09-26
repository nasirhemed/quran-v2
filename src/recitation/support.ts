/**
 * Can this browser run voice features (spec §4)? Everything else in the app works without them, so voice UI is
 * shown only when this says yes. Kept free of imports: the app shell calls it on every page.
 */
export interface VoiceSupport {
  supported: boolean;
  /** what is missing, in words a user can act on */
  missing: string[];
}

export function getVoiceSupport(): VoiceSupport {
  const missing: string[] = [];
  if (typeof window === "undefined") return { supported: false, missing: ["a browser"] };
  if (!window.isSecureContext) missing.push("a secure (https) connection");
  if (typeof WebAssembly === "undefined") missing.push("WebAssembly");
  // Threads need SharedArrayBuffer, which browsers only allow on cross-origin isolated pages.
  if (!window.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") missing.push("cross-origin isolation");
  if (!navigator.mediaDevices?.getUserMedia) missing.push("microphone access");
  if (typeof AudioWorkletNode === "undefined") missing.push("AudioWorklet");
  if (!opfsAvailable()) missing.push("on-device file storage");
  return { supported: missing.length === 0, missing };
}

/** OPFS with writable streams, where model packs are stored (asr/modelStore.ts). */
export const opfsAvailable = () =>
  typeof navigator !== "undefined" &&
  !!navigator.storage?.getDirectory &&
  typeof FileSystemFileHandle !== "undefined" &&
  "createWritable" in FileSystemFileHandle.prototype;
