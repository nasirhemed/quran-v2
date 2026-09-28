import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryByteCache, MushafFonts, type FontHost } from "@/lib/mushaf/fontStore";
import { MUSHAF_PACK, type MushafManifest } from "@/lib/mushaf/pack";

const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);
const hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const BASE = "https://host.example/packs";

/** Serves `files` at BASE/<pack>/<version>/<name>; `html` answers like a site with nothing hosted there. */
function host(files: Record<string, Uint8Array>, opts: { html?: boolean; corrupt?: string } = {}) {
  const log: string[] = [];
  const fetchFn = (async (url: string) => {
    log.push(url);
    if (opts.html) return new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } });
    const name = url.split("/").pop()!;
    expect(url).toBe(`${BASE}/${MUSHAF_PACK.id}/${MUSHAF_PACK.version}/${name}`);
    const body = files[name];
    if (!body) return new Response("missing", { status: 404 });
    const out = body.slice();
    if (opts.corrupt === name) out[0] ^= 1;
    return new Response(out, { headers: { "Content-Type": "font/woff2" } });
  }) as typeof fetch;
  return { fetchFn, log };
}

/** Registers fonts in memory; bytes starting with 0xff "fail to parse". */
function fontHost() {
  const added: string[] = [];
  const removed: string[] = [];
  const fonts: FontHost = {
    async add(family, b) {
      if (new Uint8Array(b)[0] === 0xff) throw new Error("bad font");
      added.push(family);
    },
    remove(family) {
      removed.push(family);
    },
  };
  return { fonts, added, removed };
}

const files: Record<string, Uint8Array> = Object.fromEntries(
  Array.from({ length: 20 }, (_, i) => [`p${i + 1}.woff2`, bytes(1000 + i, i)]),
);
const manifest: MushafManifest = {
  id: MUSHAF_PACK.id,
  version: MUSHAF_PACK.version,
  files: Object.entries(files).map(([name, b]) => ({ name, bytes: b.length, sha256: hex(b) })),
};

describe("MushafFonts", () => {
  it("fetches a page font once, keeps it on the device, and draws from there afterwards", async () => {
    const cache = new MemoryByteCache();
    const { fetchFn, log } = host(files);
    const a = new MushafFonts(cache, fontHost().fonts, BASE, fetchFn);
    expect(a.isReady("qcf-p3")).toBe(false);
    expect(await a.load("p3.woff2", "qcf-p3")).toBe(true);
    expect(a.isReady("qcf-p3")).toBe(true);
    expect(await a.load("p3.woff2", "qcf-p3")).toBe(true);
    expect(log).toHaveLength(1);

    // a later visit: offline, but the font is stored
    const b = new MushafFonts(cache, fontHost().fonts, BASE, (() => Promise.reject(new TypeError("offline"))) as typeof fetch);
    expect(await b.load("p3.woff2", "qcf-p3")).toBe(true);
    expect(await b.load("p4.woff2", "qcf-p4")).toBe(false);
  });

  it("shares one fetch between simultaneous loads", async () => {
    const { fetchFn, log } = host(files);
    const s = new MushafFonts(new MemoryByteCache(), fontHost().fonts, BASE, fetchFn);
    expect(await Promise.all([s.load("p1.woff2", "qcf-p1"), s.load("p1.woff2", "qcf-p1")])).toEqual([true, true]);
    expect(log).toHaveLength(1);
  });

  it("drops a stored font that fails to parse, so the next load fetches it again", async () => {
    const cache = new MemoryByteCache();
    await cache.put("p2.woff2", Uint8Array.of(0xff, 1, 2).buffer);
    const { fetchFn, log } = host(files);
    const s = new MushafFonts(cache, fontHost().fonts, BASE, fetchFn);
    expect(await s.load("p2.woff2", "qcf-p2")).toBe(false);
    expect(await cache.get("p2.woff2")).toBeNull();
    expect(await s.load("p2.woff2", "qcf-p2")).toBe(true);
    expect(log).toHaveLength(1);
  });

  it("fails without storing anything when the site hosts no fonts", async () => {
    const cache = new MemoryByteCache();
    const s = new MushafFonts(cache, fontHost().fonts, BASE, host(files, { html: true }).fetchFn);
    expect(await s.load("p1.woff2", "qcf-p1")).toBe(false);
    expect((await cache.sizes()).size).toBe(0);
  });

  it("keeps only the latest page fonts registered, and never the pinned ones", async () => {
    const { fonts, removed } = fontHost();
    const s = new MushafFonts(new MemoryByteCache(), fonts, BASE, host(files).fetchFn);
    await s.load("p1.woff2", "qcf-p1", { pin: true });
    for (let p = 2; p <= 16; p++) await s.load(`p${p}.woff2`, `qcf-p${p}`);
    expect(removed).toEqual(["qcf-p2", "qcf-p3", "qcf-p4"]);
    expect(s.isReady("qcf-p1")).toBe(true);
    expect(s.isReady("qcf-p5")).toBe(true);
  });

  it("saves the whole pack, checking every file, and continues after a failure", async () => {
    const cache = new MemoryByteCache();
    const bad = new MushafFonts(cache, fontHost().fonts, BASE, host(files, { corrupt: "p7.woff2" }).fetchFn);
    await expect(bad.downloadAll(manifest)).rejects.toThrow("p7.woff2 did not match its checksum");
    expect(await cache.get("p7.woff2")).toBeNull();
    const partial = await bad.status(manifest);
    expect(partial.files).toBeLessThan(20);

    const { fetchFn, log } = host(files);
    const good = new MushafFonts(cache, fontHost().fonts, BASE, fetchFn);
    const seen: number[] = [];
    await good.downloadAll(manifest, (s) => seen.push(s.files));
    expect(log).toHaveLength(20 - partial.files); // only what was missing
    expect(seen[seen.length - 1]).toBe(20);
    expect(await good.status(manifest)).toEqual({
      files: 20,
      bytes: manifest.files.reduce((s, f) => s + f.bytes, 0),
      totalFiles: 20,
      totalBytes: manifest.files.reduce((s, f) => s + f.bytes, 0),
    });

    await good.removeAll();
    expect((await good.status(manifest)).files).toBe(0);
  });

  it("stops when aborted", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const s = new MushafFonts(new MemoryByteCache(), fontHost().fonts, BASE, host(files).fetchFn);
    await expect(s.downloadAll(manifest, undefined, ctl.signal)).rejects.toThrow();
    expect((await s.status(manifest)).files).toBe(0);
  });
});
