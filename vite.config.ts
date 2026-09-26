import fs from "fs";
import path from "path";
import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Cross-origin isolation, needed for multi-threaded WebAssembly (SharedArrayBuffer) in voice features.
 * vercel.json sends the same headers in production.
 */
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/**
 * Local model hosting for dev and preview: serves MODELS_DIR at /models, laid out as the real host is
 * (`<pack id>/<version>/<file>`), with Range requests so resumable downloads can be tested.
 */
function localModels(): Plugin {
  const dir = process.env.MODELS_DIR && path.resolve(process.env.MODELS_DIR);
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    if (!dir || !req.url?.startsWith("/models/")) return next();
    const file = path.join(dir, decodeURIComponent(req.url.slice("/models/".length).split("?")[0]));
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.statusCode = 404;
      return res.end();
    }
    const size = fs.statSync(file).size;
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Number(range[2]) : size - 1;
    if (start >= size) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${size}`);
      return res.end();
    }
    res.statusCode = range ? 206 : 200;
    if (range) res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", String(end - start + 1));
    res.setHeader("Accept-Ranges", "bytes");
    fs.createReadStream(file, { start, end }).pipe(res);
  };
  return {
    name: "local-models",
    configureServer: (server) => void server.middlewares.use(serve),
    configurePreviewServer: (server) => void server.middlewares.use(serve),
  };
}

export default defineConfig({
  plugins: [
    react(),
    localModels(),
    VitePWA({
      // A new version waits for the reader to accept it (UpdatePrompt); the page never reloads by itself.
      registerType: "prompt",
      includeManifestIcons: false, // already matched by globPatterns
      manifest: {
        name: "Itqān · Qur'an Study",
        short_name: "Itqān",
        description: "Read the mushaf, study mutashābihāt and practise recitation.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f7f5ef",
        theme_color: "#f7f5ef",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The app shell, fonts and reader data work offline from the first visit.
        globPatterns: ["**/*.{html,js,css,woff2,png,ico}", "data/*.json"],
        // Voice data is only needed once voice is used: cached on first use instead.
        globIgnores: ["data/recitation-words.json"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/models\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname === "/data/recitation-words.json",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "recitation-data" },
          },
        ],
      },
    }),
  ],
  server: { headers: isolation },
  preview: { headers: isolation },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
