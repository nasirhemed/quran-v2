/**
 * Downloads model packs and keeps them on the device (spec §10.5): the files go to the Origin Private File System,
 * so they survive reloads, work offline, and are never sent anywhere.
 *
 * - Resumable: an interrupted download continues with an HTTP Range request. The bytes already on disk are
 *   re-hashed first, so the SHA-256 still covers the whole file.
 * - Verified: every file's SHA-256 and size must match the pack; a mismatch deletes the file.
 * - Progress is written to disk every few MB, so a closed tab loses at most that much.
 *
 * Storage sits behind `FileStore` so tests run against an in-memory copy.
 */
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import type { ModelPack, PackFile } from "./modelPack";

export interface FileStore {
  /** bytes stored for `path` (0 when absent) */
  size(path: string): Promise<number>;
  /** the stored bytes in pieces, in order */
  read(path: string): AsyncIterable<Uint8Array>;
  append(path: string, data: Uint8Array): Promise<void>;
  /** whole-file read, for loading a model into the runtime */
  blob(path: string): Promise<Blob>;
  writeText(path: string, text: string): Promise<void>;
  readText(path: string): Promise<string | null>;
  /** removes a file, or a directory with everything in it */
  remove(path: string): Promise<void>;
}

export type PackStatus =
  | { state: "absent" }
  | { state: "partial"; bytes: number; total: number }
  | { state: "ready"; total: number };

export interface Progress {
  file: string;
  /** bytes on disk across the whole pack */
  bytes: number;
  total: number;
}

export class ChecksumError extends Error {
  constructor(readonly file: string) {
    super(`${file} did not match its checksum and was deleted. Try again.`);
  }
}

const FLUSH_BYTES = 4 << 20;

/** Where packs are hosted: VITE_MODEL_BASE_URL, or `/models` (served from MODELS_DIR by the dev server). */
export function modelBaseUrl(): string {
  return (import.meta.env.VITE_MODEL_BASE_URL || "/models").replace(/\/$/, "");
}

export const fileUrl = (base: string, pack: ModelPack, file: PackFile) => `${base}/${pack.id}/${pack.version}/${file.name}`;

const packDir = (pack: ModelPack) => `${pack.id}/${pack.version}`;
const filePath = (pack: ModelPack, file: PackFile) => `${packDir(pack)}/${file.name}`;
const verifiedPath = (pack: ModelPack) => `${packDir(pack)}/verified.json`;

export class ModelStore {
  constructor(
    private store: FileStore,
    private baseUrl = modelBaseUrl(),
    private fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async verified(pack: ModelPack): Promise<Record<string, string>> {
    const text = await this.store.readText(verifiedPath(pack));
    return text ? JSON.parse(text) : {};
  }

  async status(pack: ModelPack): Promise<PackStatus> {
    const total = pack.files.reduce((s, f) => s + f.bytes, 0);
    const ok = await this.verified(pack);
    let bytes = 0;
    let ready = true;
    for (const f of pack.files) {
      const size = await this.store.size(filePath(pack, f));
      bytes += Math.min(size, f.bytes);
      if (ok[f.name] !== f.sha256 || size !== f.bytes) ready = false;
    }
    if (ready) return { state: "ready", total };
    return bytes === 0 ? { state: "absent" } : { state: "partial", bytes, total };
  }

  /** Downloads whatever is missing. Safe to call again after a failure or abort: it resumes. */
  async download(pack: ModelPack, onProgress?: (p: Progress) => void, signal?: AbortSignal): Promise<void> {
    const total = pack.files.reduce((s, f) => s + f.bytes, 0);
    const ok = await this.verified(pack);
    let done = 0;
    for (const f of pack.files) {
      const path = filePath(pack, f);
      if (ok[f.name] === f.sha256 && (await this.store.size(path)) === f.bytes) {
        done += f.bytes;
        onProgress?.({ file: f.name, bytes: done, total });
        continue;
      }
      delete ok[f.name];
      await this.fetchFile(pack, f, (n) => onProgress?.({ file: f.name, bytes: done + n, total }), signal);
      done += f.bytes;
      ok[f.name] = f.sha256;
      await this.store.writeText(verifiedPath(pack), JSON.stringify(ok));
    }
  }

  private async fetchFile(pack: ModelPack, f: PackFile, onBytes: (n: number) => void, signal?: AbortSignal) {
    const path = filePath(pack, f);
    let have = await this.store.size(path);
    if (have > f.bytes) {
      await this.store.remove(path);
      have = 0;
    }
    const hash = sha256.create();
    if (have > 0) for await (const piece of this.store.read(path)) hash.update(piece);
    onBytes(have);

    if (have < f.bytes) {
      const res = await this.fetchFn(fileUrl(this.baseUrl, pack, f), {
        headers: have > 0 ? { Range: `bytes=${have}-` } : {},
        signal,
        cache: "no-store",
      });
      if (!res.ok || !res.body) throw new Error(`Download of ${f.name} failed (HTTP ${res.status})`);
      // The app's own page instead of a model file: nothing is hosted at this address.
      if (res.headers.get("Content-Type")?.startsWith("text/html")) throw new Error("Model downloads are not set up on this site yet.");
      let hashFrom = hash;
      if (have > 0 && !(res.status === 206 && res.headers.get("Content-Range")?.startsWith(`bytes ${have}-`))) {
        // the server sent the whole file: start over
        await this.store.remove(path);
        have = 0;
        hashFrom = sha256.create();
        onBytes(0);
      }
      const reader = res.body.getReader();
      const pending: Uint8Array[] = [];
      let pendingBytes = 0;
      const flush = async () => {
        if (!pendingBytes) return;
        const buf = new Uint8Array(pendingBytes);
        let o = 0;
        for (const p of pending) {
          buf.set(p, o);
          o += p.length;
        }
        pending.length = 0;
        pendingBytes = 0;
        await this.store.append(path, buf);
      };
      let tooLong = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (have + value.length > f.bytes) {
            tooLong = true;
            await reader.cancel();
            break;
          }
          hashFrom.update(value);
          pending.push(value);
          pendingBytes += value.length;
          have += value.length;
          onBytes(have);
          if (pendingBytes >= FLUSH_BYTES) await flush();
        }
      } finally {
        // keep what arrived, so the next attempt resumes from here
        await flush();
      }
      if (tooLong) {
        await this.store.remove(path);
        throw new ChecksumError(f.name);
      }
      if (have !== f.bytes) throw new Error(`Download of ${f.name} stopped early. Try again to resume.`);
      if (bytesToHex(hashFrom.digest()) !== f.sha256) {
        await this.store.remove(path);
        throw new ChecksumError(f.name);
      }
      return;
    }
    if (bytesToHex(hash.digest()) !== f.sha256) {
      await this.store.remove(path);
      throw new ChecksumError(f.name);
    }
  }

  async remove(pack: ModelPack): Promise<void> {
    await this.store.remove(pack.id);
  }

  /** A downloaded file, for the runtime. */
  async file(pack: ModelPack, name: string): Promise<Blob> {
    const f = pack.files.find((x) => x.name === name);
    if (!f) throw new Error(`${pack.id} has no file ${name}`);
    return this.store.blob(filePath(pack, f));
  }
}

/** Test and fallback storage. */
export class MemoryFileStore implements FileStore {
  files = new Map<string, Uint8Array[]>();
  async size(path: string) {
    return (this.files.get(path) ?? []).reduce((s, p) => s + p.length, 0);
  }
  async *read(path: string) {
    for (const p of this.files.get(path) ?? []) yield p;
  }
  async append(path: string, data: Uint8Array) {
    const list = this.files.get(path) ?? [];
    list.push(data.slice());
    this.files.set(path, list);
  }
  async blob(path: string) {
    return new Blob((this.files.get(path) ?? []) as BlobPart[]);
  }
  async writeText(path: string, text: string) {
    this.files.set(path, [new TextEncoder().encode(text)]);
  }
  async readText(path: string) {
    const parts = this.files.get(path);
    return parts ? new TextDecoder().decode(await new Blob(parts as BlobPart[]).arrayBuffer()) : null;
  }
  async remove(path: string) {
    for (const k of [...this.files.keys()]) if (k === path || k.startsWith(`${path}/`)) this.files.delete(k);
  }
}

/** Origin Private File System storage, under `models/`. */
export class OpfsFileStore implements FileStore {
  private async dir(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let d = await navigator.storage.getDirectory();
    for (const name of ["models", ...parts]) {
      try {
        d = await d.getDirectoryHandle(name, { create });
      } catch {
        return null;
      }
    }
    return d;
  }
  private async handle(path: string, create: boolean): Promise<FileSystemFileHandle | null> {
    const parts = path.split("/");
    const name = parts.pop()!;
    const d = await this.dir(parts, create);
    if (!d) return null;
    try {
      return await d.getFileHandle(name, { create });
    } catch {
      return null;
    }
  }
  async size(path: string) {
    const h = await this.handle(path, false);
    return h ? (await h.getFile()).size : 0;
  }
  async *read(path: string) {
    const h = await this.handle(path, false);
    if (!h) return;
    const reader = (await h.getFile()).stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  }
  async append(path: string, data: Uint8Array) {
    const h = (await this.handle(path, true))!;
    const size = (await h.getFile()).size;
    const w = await h.createWritable({ keepExistingData: true });
    await w.seek(size);
    await w.write(data as BufferSource);
    await w.close();
  }
  async blob(path: string) {
    const h = await this.handle(path, false);
    if (!h) throw new Error(`${path} is not downloaded`);
    return h.getFile();
  }
  async writeText(path: string, text: string) {
    const h = (await this.handle(path, true))!;
    const w = await h.createWritable();
    await w.write(text);
    await w.close();
  }
  async readText(path: string) {
    const h = await this.handle(path, false);
    return h ? (await h.getFile()).text() : null;
  }
  async remove(path: string) {
    const parts = path.split("/");
    const name = parts.pop()!;
    const d = await this.dir(parts, false);
    await d?.removeEntry(name, { recursive: true }).catch(() => undefined);
  }
}
