/// <reference types="vite/client" />

interface ImportMetaEnv {
  /// Set only when the frontend is served from a different origin than its API (a phone
  /// pointed at a LAN address or a tunnel). Empty for both `npm run dev` and production.
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
