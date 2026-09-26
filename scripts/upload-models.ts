/**
 * Upload a model pack to Vercel Blob, laid out the way the app downloads it:
 *   <base url>/<pack id>/<version>/<file>          (src/recitation/asr/modelStore.ts)
 *
 *   npm run upload-models -- <folder with the pack's files> [pack id]
 *
 * The token comes from BLOB_READ_WRITE_TOKEN, or from `.env.local` (gitignored) in this folder: paste the line
 * from Vercel → Storage → your Blob store → .env.local, or run `vercel env pull .env.local`.
 *
 * Every file is checked against the pack's size and SHA-256 before upload, so a wrong model (e.g. v3.1 instead
 * of v3) never reaches users. Files already uploaded with the right size are skipped. Afterwards the script
 * fetches each public URL back and checks CORS and Range, which the app needs, then prints the value for
 * VITE_MODEL_BASE_URL. Model weights never go into git (spec rule 5); this is how they reach users instead.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { head, put } from "@vercel/blob";
import { DEFAULT_PACK, MODEL_PACKS } from "../src/recitation/asr/modelPack";

const [dir, packId = DEFAULT_PACK.id] = process.argv.slice(2);
const pack = MODEL_PACKS.find((p) => p.id === packId);
if (!dir || !pack) {
  console.error(`usage: npx tsx scripts/upload-models.ts <dir> [${MODEL_PACKS.map((p) => p.id).join(" | ")}]`);
  process.exit(1);
}
if (!process.env.BLOB_READ_WRITE_TOKEN && fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error(
    "No BLOB_READ_WRITE_TOKEN. Put this line in quran-v2/.env.local (it is gitignored):\n" +
      '  BLOB_READ_WRITE_TOKEN="vercel_blob_rw_…"\n' +
      "Copy it from Vercel → Storage → your Blob store → .env.local tab.",
  );
  process.exit(1);
}

async function sha256(file: string) {
  const h = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}

let base = "";
for (const f of pack.files) {
  const local = path.join(dir, f.name);
  const pathname = `${pack.id}/${pack.version}/${f.name}`;
  if (!fs.existsSync(local)) throw new Error(`missing ${local}`);
  const size = fs.statSync(local).size;
  const hash = await sha256(local);
  if (size !== f.bytes || hash !== f.sha256) {
    throw new Error(`${local} is not the file this pack expects (size ${size} vs ${f.bytes}, sha256 ${hash.slice(0, 12)}… vs ${f.sha256.slice(0, 12)}…)`);
  }
  const existing = await head(pathname).catch(() => null);
  let url: string;
  if (existing && existing.size === f.bytes) {
    url = existing.url;
    console.log(`= ${pathname} already uploaded`);
  } else {
    const res = await put(pathname, fs.createReadStream(local), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      multipart: f.bytes > 8 << 20,
      contentType: "application/octet-stream",
      cacheControlMaxAge: 365 * 24 * 3600, // a pack version never changes; a new model gets a new version path
    });
    url = res.url;
    console.log(`↑ ${pathname} (${(f.bytes / 1e6).toFixed(1)} MB)`);
  }
  base = url.slice(0, url.length - pathname.length - 1);

  // The app fetches cross-origin from a COEP page and resumes with Range: check both.
  const r = await fetch(url, { headers: { Range: "bytes=1-4", Origin: "https://example.com" } });
  const cors = r.headers.get("access-control-allow-origin");
  const ok = r.status === 206 && (cors === "*" || cors === "https://example.com");
  console.log(`  ${ok ? "✔" : "✘"} Range → ${r.status}, CORS → ${cors ?? "none"}`);
  if (!ok) process.exitCode = 1;
}
console.log(`\nVITE_MODEL_BASE_URL=${base}`);
