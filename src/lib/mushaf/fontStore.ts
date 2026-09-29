/**
 * Loads the mushaf's fonts (pack.ts) and keeps them on the device.
 *
 * - A page's font is fetched the first time the page is shown, stored in Cache Storage, and read from there ever
 *   after, so every page once seen also works offline. `downloadAll` stores the whole mushaf up front.
 * - Fonts are handed to the browser as FontFace objects built from the bytes, so no CSS @font-face per page is
 *   needed and the bytes never depend on the HTTP cache. Only the most recent page fonts stay registered.
 * - A file that fails to parse is dropped from the cache, so a bad download never sticks.
 *
 * Storage and font registration sit behind small interfaces so tests run in Node.
 */
import { MUSHAF_PACK, packBaseUrl, packFileUrl, type MushafFile, type MushafManifest } from "./pack";

/** Pack files kept on the device. */
export interface ByteCache {
  get(name: string): Promise<ArrayBuffer | null>;
  put(name: string, bytes: ArrayBuffer): Promise<void>;
  delete(name: string): Promise<void>;
  /** every stored file and its size */
  sizes(): Promise<Map<string, number>>;
  clear(): Promise<void>;
}

/** Where fonts are registered for drawing: document.fonts in the browser. */
export interface FontHost {
  add(family: string, bytes: ArrayBuffer): Promise<void>;
  remove(family: string): void;
}

export interface OfflineStatus {
  files: number;
  bytes: number;
  totalFiles: number;
  totalBytes: number;
}

export class HostNotSetUpError extends Error {
  constructor() {
    super("Mushaf fonts are not hosted on this site yet.");
  }
}

/** Page fonts kept registered at once (a few pages each way); header and bismillah fonts stay pinned. */
const MAX_LOADED = 12;
const DOWNLOAD_CONCURRENCY = 4;

export class MushafFonts {
  private loaded = new Set<string>(); // families, oldest first
  private pinned = new Set<string>();
  private pending = new Map<string, Promise<boolean>>();

  constructor(
    private cache: ByteCache,
    private fonts: FontHost,
    private baseUrl = packBaseUrl(),
    private fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  /** True when the family can draw right now (no loading state, no flash). */
  isReady(family: string): boolean {
    return this.loaded.has(family);
  }

  /** Registers `file` as `family`, from the device if stored, else from the host. False when it can't. */
  load(file: string, family: string, opts: { pin?: boolean } = {}): Promise<boolean> {
    if (opts.pin) this.pinned.add(family);
    if (this.loaded.has(family)) {
      this.loaded.delete(family); // most recent last
      this.loaded.add(family);
      return Promise.resolve(true);
    }
    let p = this.pending.get(family);
    if (!p) {
      p = this.register(file, family).finally(() => this.pending.delete(family));
      this.pending.set(family, p);
    }
    return p;
  }

  private async register(file: string, family: string): Promise<boolean> {
    let bytes = await this.cache.get(file).catch(() => null);
    const stored = !!bytes;
    try {
      if (!bytes) {
        bytes = await this.fetchFile(file);
        await this.cache.put(file, bytes).catch(() => undefined); // storage full or blocked: still draw it
      }
      await this.fonts.add(family, bytes);
    } catch {
      if (stored) await this.cache.delete(file).catch(() => undefined);
      return false;
    }
    this.loaded.add(family);
    this.evict();
    return true;
  }

  private evict() {
    const pages = [...this.loaded].filter((f) => !this.pinned.has(f));
    for (const family of pages.slice(0, Math.max(0, pages.length - MAX_LOADED))) {
      this.fonts.remove(family);
      this.loaded.delete(family);
    }
  }

  private async fetchFile(name: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    const res = await this.fetchFn(packFileUrl(this.baseUrl, name), { signal });
    // The app's own page instead of a font: nothing is hosted at this address.
    if (res.headers.get("Content-Type")?.startsWith("text/html")) throw new HostNotSetUpError();
    if (!res.ok) throw new Error(`Download of ${name} failed (HTTP ${res.status})`);
    return res.arrayBuffer();
  }

  async status(manifest: MushafManifest): Promise<OfflineStatus> {
    const have = await this.cache.sizes();
    let files = 0;
    let bytes = 0;
    for (const f of manifest.files) {
      if (have.get(f.name) === f.bytes) {
        files++;
        bytes += f.bytes;
      }
    }
    return { files, bytes, totalFiles: manifest.files.length, totalBytes: manifest.files.reduce((s, f) => s + f.bytes, 0) };
  }

  /**
   * Stores every file of the pack that isn't stored yet, checking each one's size and SHA-256. Safe to call again
   * after a failure or abort: it continues with what is missing.
   */
  async downloadAll(manifest: MushafManifest, onProgress?: (s: OfflineStatus) => void, signal?: AbortSignal): Promise<void> {
    if (manifest.id !== MUSHAF_PACK.id || manifest.version !== MUSHAF_PACK.version) {
      throw new Error(`Manifest is for ${manifest.id}/${manifest.version}, not ${MUSHAF_PACK.id}/${MUSHAF_PACK.version}`);
    }
    const have = await this.cache.sizes();
    const status = await this.status(manifest);
    onProgress?.({ ...status });
    const todo = manifest.files.filter((f) => have.get(f.name) !== f.bytes);
    let failure: Error | null = null;

    const next = async (): Promise<void> => {
      for (let f = todo.shift(); f && !failure; f = todo.shift()) {
        try {
          signal?.throwIfAborted();
          await this.cache.put(f.name, await this.fetchVerified(f, signal));
          status.files++;
          status.bytes += f.bytes;
          onProgress?.({ ...status });
        } catch (e) {
          failure ??= e as Error;
        }
      }
    };
    await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, next));
    if (failure) throw failure;
  }

  private async fetchVerified(f: MushafFile, signal?: AbortSignal): Promise<ArrayBuffer> {
    const bytes = await this.fetchFile(f.name, signal);
    if (bytes.byteLength !== f.bytes || (await sha256Hex(bytes)) !== f.sha256) {
      throw new Error(`${f.name} did not match its checksum. Try again.`);
    }
    return bytes;
  }

  /** Forgets every stored file (the fonts in use stay drawn until the page changes). */
  async removeAll(): Promise<void> {
    await this.cache.clear();
  }
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cache Storage, one cache per pack version. Keys are pack paths, not host URLs, so moving hosts keeps them. */
export class CacheStorageByteCache implements ByteCache {
  private readonly name = `mushaf-${MUSHAF_PACK.id}-${MUSHAF_PACK.version}`;
  private key = (name: string) => `/__mushaf/${MUSHAF_PACK.id}/${MUSHAF_PACK.version}/${name}`;
  private open = () => caches.open(this.name);

  async get(name: string) {
    const res = await (await this.open()).match(this.key(name));
    return res ? res.arrayBuffer() : null;
  }
  async put(name: string, bytes: ArrayBuffer) {
    const headers = { "Content-Type": "font/woff2", "X-Bytes": String(bytes.byteLength) };
    await (await this.open()).put(this.key(name), new Response(bytes, { headers }));
  }
  async delete(name: string) {
    await (await this.open()).delete(this.key(name));
  }
  async sizes() {
    const cache = await this.open();
    const out = new Map<string, number>();
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      const name = new URL(req.url).pathname.split("/").pop()!;
      if (res) out.set(name, Number(res.headers.get("X-Bytes")));
    }
    return out;
  }
  async clear() {
    await caches.delete(this.name);
  }
}

/** Tests, and browsers without Cache Storage (plain-http dev hosts): fonts work, but only for this visit. */
export class MemoryByteCache implements ByteCache {
  files = new Map<string, ArrayBuffer>();
  async get(name: string) {
    return this.files.get(name) ?? null;
  }
  async put(name: string, bytes: ArrayBuffer) {
    this.files.set(name, bytes);
  }
  async delete(name: string) {
    this.files.delete(name);
  }
  async sizes() {
    return new Map([...this.files].map(([k, v]) => [k, v.byteLength]));
  }
  async clear() {
    this.files.clear();
  }
}

export class DocumentFontHost implements FontHost {
  private faces = new Map<string, FontFace>();
  async add(family: string, bytes: ArrayBuffer) {
    const face = new FontFace(family, bytes, { display: "block" });
    await face.load();
    document.fonts.add(face);
    this.faces.set(family, face);
  }
  remove(family: string) {
    const face = this.faces.get(family);
    if (face) document.fonts.delete(face);
    this.faces.delete(family);
  }
}

let instance: MushafFonts | null = null;

/** The app's one font store. */
export function mushafFonts(): MushafFonts {
  instance ??= new MushafFonts(
    typeof caches === "undefined" ? new MemoryByteCache() : new CacheStorageByteCache(),
    new DocumentFontHost(),
  );
  return instance;
}
