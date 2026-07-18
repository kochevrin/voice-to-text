// Minimal import.meta.env typing. `vite` is not a direct dependency (pnpm
// strict layout), so `/// <reference types="vite/client" />` cannot resolve;
// declare the env vars this app actually reads instead.

interface ImportMetaEnv {
  readonly VITE_MOCK_TAURI?: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
