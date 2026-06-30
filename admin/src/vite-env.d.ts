/// <reference types="vite/client" />

declare const __ADMIN_BUILD__: string;

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
