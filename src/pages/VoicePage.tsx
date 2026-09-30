import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { choosePack, MODEL_PACKS, selectedPack, type ModelPack } from "@/recitation/asr/modelPack";
import { ModelStore, OpfsFileStore, type PackStatus } from "@/recitation/asr/modelStore";
import { getVoiceSupport } from "@/recitation/support";

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;

interface Row {
  status: PackStatus;
  progress: number | null;
  error: string | null;
}

/** `embedded`: rendered inside the Settings page, which supplies the heading and outer layout. */
export default function VoicePage({ embedded = false }: { embedded?: boolean }) {
  const support = getVoiceSupport();
  const store = useRef<ModelStore | null>(null);
  const aborts = useRef(new Map<string, AbortController>());
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [selected, setSelected] = useState(() => selectedPack().id);
  const [storage, setStorage] = useState<{ persisted: boolean; usage?: number; quota?: number } | null>(null);
  const [license, setLicense] = useState<Record<string, string>>({});

  const empty: Row = { status: { state: "absent" }, progress: null, error: null };
  const patch = (id: string, p: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...(r[id] ?? empty), ...p } }));

  const refresh = useCallback(async () => {
    if (!store.current) return;
    for (const pack of MODEL_PACKS) {
      const status = await store.current.status(pack);
      patch(pack.id, { status });
      if (status.state === "ready" && !license[pack.id]) {
        const text = await (await store.current.file(pack, "LICENSE")).text();
        setLicense((l) => ({ ...l, [pack.id]: text }));
      }
    }
    const [persisted, est] = await Promise.all([navigator.storage.persisted(), navigator.storage.estimate()]);
    setStorage({ persisted, usage: est.usage, quota: est.quota });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!support.supported) return;
    store.current = new ModelStore(new OpfsFileStore());
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const download = async (pack: ModelPack) => {
    if (!store.current) return;
    const ctl = new AbortController();
    aborts.current.set(pack.id, ctl);
    patch(pack.id, { progress: 0, error: null });
    // Ask the browser not to evict the models under storage pressure (spec §10.5).
    if (!(await navigator.storage.persisted())) await navigator.storage.persist().catch(() => false);
    try {
      await store.current.download(pack, (p) => patch(pack.id, { progress: p.bytes / p.total }), ctl.signal);
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      patch(pack.id, { error: aborted ? "Paused. Download again to resume." : (e as Error).message });
    } finally {
      aborts.current.delete(pack.id);
      patch(pack.id, { progress: null });
      refresh();
    }
  };

  const remove = async (pack: ModelPack) => {
    aborts.current.get(pack.id)?.abort();
    await store.current?.remove(pack);
    setLicense((l) => {
      const { [pack.id]: _, ...rest } = l;
      return rest;
    });
    refresh();
  };

  const choose = (id: string) => {
    setSelected(id);
    choosePack(id);
  };

  if (!support.supported) {
    return (
      <div className={embedded ? "" : "max-w-xl mx-auto px-4 py-8"}>
        {!embedded && <h1 className="text-xl font-semibold text-ink mb-2">Voice</h1>}
        <p className="text-sm text-muted">
          Voice features need a browser with {support.missing.join(", ")}. Recent Chrome on Android or desktop works.
          Everything else in Itqān works as usual.
        </p>
      </div>
    );
  }

  return (
    <div className={embedded ? "space-y-6" : "max-w-xl mx-auto px-4 py-8 space-y-6"}>
      <div>
        {!embedded && <h1 className="text-xl font-semibold text-ink mb-2">Voice</h1>}
        <p className="text-sm text-muted">
          Recite and Itqān follows along or checks your recitation afterwards. Listening happens entirely on this device:
          your voice is never uploaded. First, download a speech model (once; it then works offline).
        </p>
      </div>

      <div className="space-y-3">
        {MODEL_PACKS.map((pack) => {
          const row = rows[pack.id];
          const total = pack.files.reduce((s, f) => s + f.bytes, 0);
          const st = row?.status;
          const busy = row?.progress != null;
          const ready = st?.state === "ready";
          return (
            <div key={pack.id} className="bg-card border border-edge rounded-lg p-4">
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="pack"
                  className="mt-1 accent-[var(--primary)]"
                  checked={selected === pack.id}
                  disabled={pack.runnable === false}
                  onChange={() => choose(pack.id)}
                  aria-label={`Use ${pack.label}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ink text-sm">{pack.label}</div>
                  <p className="text-xs text-muted mt-0.5">{pack.description}</p>
                  <p className="text-xs text-faint mt-1">
                    {mb(total)} · licence {pack.license}
                    {pack.runnable === false && " · not usable yet"}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {busy ? (
                      <>
                        <div className="flex-1 min-w-[8rem] h-2 rounded-full bg-card2 overflow-hidden">
                          <div className="h-full bg-primary transition-[width]" style={{ width: `${(row!.progress! * 100).toFixed(1)}%` }} />
                        </div>
                        <span className="text-xs text-muted tabular-nums">{Math.floor(row!.progress! * 100)}%</span>
                        <button onClick={() => aborts.current.get(pack.id)?.abort()} className="text-xs font-medium text-muted hover:text-ink">
                          Pause
                        </button>
                      </>
                    ) : ready ? (
                      <>
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-primary-soft text-primary">Downloaded</span>
                        {pack.runnable !== false && (
                          <Link href="/transcribe" className="px-3 py-1 rounded-full text-xs font-semibold bg-primary text-on-primary">
                            Try it
                          </Link>
                        )}
                        <button onClick={() => remove(pack).then(() => download(pack))} className="text-xs font-medium text-muted hover:text-ink">
                          Re-download
                        </button>
                        <button onClick={() => remove(pack)} className="text-xs font-medium text-red-500 hover:underline">
                          Delete
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => download(pack)}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold bg-primary text-on-primary"
                        >
                          {st?.state === "partial" ? `Resume (${mb(st.bytes)} of ${mb(st.total)})` : `Download ${mb(total)}`}
                        </button>
                        {st?.state === "partial" && (
                          <button onClick={() => remove(pack)} className="text-xs font-medium text-red-500 hover:underline">
                            Delete
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {row?.error && <p className="text-xs text-red-500 mt-2">{row.error}</p>}
                  {license[pack.id] && (
                    <details className="mt-3">
                      <summary className="text-xs text-muted cursor-pointer">Model licence ({pack.license})</summary>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px] leading-snug text-ink-soft bg-card2 rounded p-2">
                        {license[pack.id]}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {storage && (
        <p className="text-xs text-faint">
          Storage: {storage.usage != null ? mb(storage.usage) : "?"} used
          {storage.quota != null && ` of ${mb(storage.quota)} available`}.{" "}
          {storage.persisted ? "Kept by the browser." : "The browser may clear it if the device runs low on space."}
        </p>
      )}

      <div className="border-t border-edge pt-4 text-xs text-muted space-y-1">
        <p>
          <span className="font-semibold text-ink-soft">Please note:</span> the feedback comes from a speech model and can be wrong.
          It is a study aid, not a religious ruling on your recitation. When in doubt, check with a teacher.
        </p>
      </div>
    </div>
  );
}
