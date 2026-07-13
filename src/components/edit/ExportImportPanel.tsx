import { useCallback, useRef } from "react";

interface ExportImportPanelProps {
  onExport: () => string;
  onImport: (json: string) => void;
  onClose: () => void;
}

export default function ExportImportPanel({
  onExport,
  onImport,
  onClose,
}: ExportImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(() => {
    const json = onExport();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "quran-reader-local-phrases.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [onExport]);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          onImport(reader.result as string);
          onClose();
        } catch (err) {
          alert("Failed to import: " + (err instanceof Error ? err.message : "Invalid file"));
        }
      };
      reader.readAsText(file);
    },
    [onImport, onClose]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface-light border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm mx-4">
        <div className="p-4 border-b border-slate-700">
          <h3 className="text-lg font-semibold text-slate-200 font-sans">
            Export / Import
          </h3>
        </div>

        <div className="p-4 space-y-3">
          <button
            onClick={handleExport}
            className="w-full px-4 py-3 rounded-lg text-sm bg-surface hover:bg-surface-lighter border border-slate-700 text-slate-200 transition-colors font-sans text-left"
          >
            <div className="font-medium">Export Phrases</div>
            <div className="text-xs text-slate-400 mt-0.5">
              Download your custom phrases as a JSON file
            </div>
          </button>

          <button
            onClick={handleImport}
            className="w-full px-4 py-3 rounded-lg text-sm bg-surface hover:bg-surface-lighter border border-slate-700 text-slate-200 transition-colors font-sans text-left"
          >
            <div className="font-medium">Import Phrases</div>
            <div className="text-xs text-slate-400 mt-0.5">
              Load phrases from a JSON file (replaces current)
            </div>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        <div className="p-4 border-t border-slate-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors font-sans"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
