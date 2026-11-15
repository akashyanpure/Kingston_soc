/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" installs the dev-only fetch shim in src/dev/mockApi.ts (no backend needed). */
  readonly VITE_MOCK_API?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
