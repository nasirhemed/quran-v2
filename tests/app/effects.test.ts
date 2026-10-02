import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? files(p) : /\.tsx?$/.test(d.name) ? [p] : [];
  });

describe("effects", () => {
  // React calls whatever an effect returns as its cleanup. `useEffect(() => window.scrollTo(0, 0), …)` returned
  // undefined until Chrome's scroll methods started returning a Promise; then Practice's Start crashed with
  // "n is not a function". An effect's body must be a block, so it only returns a cleanup on purpose.
  it("never return a value by accident", () => {
    const src = path.resolve(__dirname, "../../src");
    const offenders = files(src).flatMap((file) =>
      fs
        .readFileSync(file, "utf-8")
        .split("\n")
        .flatMap((line, i) => (/use(Layout)?Effect\(\s*(async\s*)?\(\s*\)\s*=>\s*[^{\s]/.test(line) ? [`${path.relative(src, file)}:${i + 1}`] : []))
    );
    expect(offenders).toEqual([]);
  });
});
