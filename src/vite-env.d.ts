/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /** where model packs are hosted (spec §10.5); defaults to /models, served by the dev server from MODELS_DIR */
  readonly VITE_MODEL_BASE_URL?: string;
}
