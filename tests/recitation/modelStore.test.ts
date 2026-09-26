import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ModelPack } from "@/recitation/asr/modelPack";
import { DEFAULT_PACK, MODEL_PACKS } from "@/recitation/asr/modelPack";
import { ChecksumError, MemoryFileStore, ModelStore } from "@/recitation/asr/modelStore";

const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);
const hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const big = bytes(10_000_000, 1);
const small = bytes(1234, 7);
const pack: ModelPack = {
  ...DEFAULT_PACK,
  id: "test-pack",
  version: "v1",
  files: [
    { name: "model.onnx", bytes: big.length, sha256: hex(big) },
    { name: "tokens.txt", bytes: small.length, sha256: hex(small) },
  ],
};

/** A static file server with Range support; `cutAfter` drops the connection after that many bytes. */
function server(
  content: Record<string, Uint8Array>,
  opts: { cutAfter?: number; ignoreRange?: boolean; corrupt?: boolean; hideContentRange?: boolean } = {},
) {
  const log: { url: string; range: string | null; status: number }[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const name = url.split("/").pop()!;
    let body = content[name];
    const range = new Headers(init?.headers).get("Range");
    let status = 200;
    const headers = new Headers();
    if (range && !opts.ignoreRange) {
      const from = Number(/bytes=(\d+)-/.exec(range)![1]);
      // cross-origin without Access-Control-Expose-Headers, the page cannot read Content-Range
      if (!opts.hideContentRange) headers.set("Content-Range", `bytes ${from}-${body.length - 1}/${body.length}`);
      body = body.subarray(from);
      status = 206;
    }
    if (opts.corrupt) {
      body = body.slice();
      body[body.length - 1] ^= 1;
    }
    headers.set("Content-Length", String(body.length));
    log.push({ url, range, status });
    const cut = opts.cutAfter;
    const end = cut === undefined ? body.length : Math.min(cut, body.length);
    let at = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (at < end) {
          c.enqueue(body.slice(at, Math.min(end, at + 65536)));
          at += 65536;
        } else if (end < body.length) c.error(new TypeError("network error"));
        else c.close();
      },
    });
    return new Response(stream, { status, headers });
  }) as typeof fetch;
  return { fetchFn, log };
}

const files = { "model.onnx": big, "tokens.txt": small };

describe("ModelStore", () => {
  it("downloads, verifies and reports progress", async () => {
    const store = new MemoryFileStore();
    const { fetchFn, log } = server(files);
    const ms = new ModelStore(store, "https://models.example", fetchFn);
    expect(await ms.status(pack)).toEqual({ state: "absent" });
    const seen: number[] = [];
    await ms.download(pack, (p) => seen.push(p.bytes));
    expect(await ms.status(pack)).toEqual({ state: "ready", total: big.length + small.length });
    expect(seen[seen.length - 1]).toBe(big.length + small.length);
    expect(log.map((l) => l.url)).toEqual([
      "https://models.example/test-pack/v1/model.onnx",
      "https://models.example/test-pack/v1/tokens.txt",
    ]);
    const blob = await ms.file(pack, "model.onnx");
    expect(hex(new Uint8Array(await blob.arrayBuffer()))).toBe(pack.files[0].sha256);
    // a second call downloads nothing
    await ms.download(pack);
    expect(log).toHaveLength(2);
  });

  it("resumes an interrupted download with a Range request", async () => {
    const store = new MemoryFileStore();
    const cut = server(files, { cutAfter: 6_000_000 });
    const ms = new ModelStore(store, "", cut.fetchFn);
    await expect(ms.download(pack)).rejects.toThrow("network error");
    const st = await ms.status(pack);
    expect(st.state).toBe("partial");
    const kept = await store.size("test-pack/v1/model.onnx");
    expect(kept).toBe(6_000_000);

    const ok = server(files);
    await new ModelStore(store, "", ok.fetchFn).download(pack);
    expect(ok.log[0]).toMatchObject({ range: `bytes=${kept}-`, status: 206 });
    expect((await ms.status(pack)).state).toBe("ready");
  });

  it("resumes from a cross-origin host that hides Content-Range (Vercel Blob)", async () => {
    const store = new MemoryFileStore();
    await expect(new ModelStore(store, "", server(files, { cutAfter: 4_000_000 }).fetchFn).download(pack)).rejects.toThrow();
    const blob = server(files, { hideContentRange: true });
    const ms = new ModelStore(store, "", blob.fetchFn);
    await ms.download(pack);
    expect(blob.log[0]).toMatchObject({ range: "bytes=4000000-", status: 206 });
    expect(blob.log).toHaveLength(2); // no second full download
    expect((await ms.status(pack)).state).toBe("ready");
  });

  it("starts over when the server ignores Range", async () => {
    const store = new MemoryFileStore();
    await expect(new ModelStore(store, "", server(files, { cutAfter: 3_000_000 }).fetchFn).download(pack)).rejects.toThrow();
    const noRange = server(files, { ignoreRange: true });
    const ms = new ModelStore(store, "", noRange.fetchFn);
    await ms.download(pack);
    expect(noRange.log[0].status).toBe(200);
    expect((await ms.status(pack)).state).toBe("ready");
  });

  it("deletes a file whose checksum does not match", async () => {
    const store = new MemoryFileStore();
    const ms = new ModelStore(store, "", server(files, { corrupt: true }).fetchFn);
    await expect(ms.download(pack)).rejects.toBeInstanceOf(ChecksumError);
    expect(await store.size("test-pack/v1/model.onnx")).toBe(0);
    expect(await ms.status(pack)).toEqual({ state: "absent" });
  });

  it("detects bytes corrupted on disk before resuming", async () => {
    const store = new MemoryFileStore();
    await expect(new ModelStore(store, "", server(files, { cutAfter: 5_000_000 }).fetchFn).download(pack)).rejects.toThrow();
    store.files.get("test-pack/v1/model.onnx")![0][10] ^= 1;
    const ms = new ModelStore(store, "", server(files).fetchFn);
    await expect(ms.download(pack)).rejects.toBeInstanceOf(ChecksumError);
    await ms.download(pack); // the bad file was deleted; this attempt starts clean
    expect((await ms.status(pack)).state).toBe("ready");
  });

  it("aborts, keeps the bytes, and deletes a pack", async () => {
    const store = new MemoryFileStore();
    const ctl = new AbortController();
    const ms = new ModelStore(store, "", server(files).fetchFn);
    const aborting = server(files);
    const ms2 = new ModelStore(store, "", (async (url: string, init?: RequestInit) => {
      const res = await aborting.fetchFn(url, init);
      const reader = res.body!.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(c) {
          if (init?.signal?.aborted) return c.error(new DOMException("aborted", "AbortError"));
          const r = await reader.read();
          if (r.done) c.close();
          else c.enqueue(r.value);
        },
      });
      return new Response(body, { status: res.status, headers: res.headers });
    }) as typeof fetch);
    await expect(
      ms2.download(pack, (p) => {
        if (p.bytes > 1_000_000) ctl.abort();
      }, ctl.signal),
    ).rejects.toThrow("aborted");
    expect((await ms.status(pack)).state).toBe("partial");
    await ms.remove(pack);
    expect(await ms.status(pack)).toEqual({ state: "absent" });
    expect(store.files.size).toBe(0);
  });

  it("every pack has files with sizes and checksums", () => {
    for (const p of MODEL_PACKS) {
      expect(p.files.length).toBeGreaterThan(0);
      for (const f of p.files) {
        expect(f.bytes).toBeGreaterThan(0);
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
      expect(p.files.some((f) => f.name === "LICENSE")).toBe(true);
    }
  });
});
