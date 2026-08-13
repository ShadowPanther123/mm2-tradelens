/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** HTTPS endpoint of the values-api snapshot route (required in production). */
  readonly VITE_SNAPSHOT_URL?: string;
  /** Raw Ed25519 signing public key (base64) used to verify snapshots. */
  readonly VITE_SNAPSHOT_PUBLIC_KEY?: string;
  /** Set to "true"/"1" to exclude the OCR feature from a lightweight build. */
  readonly VITE_OCR_DISABLED?: string;
  /** Base URL for the optional anonymous community trade feed. */
  readonly VITE_COMMUNITY_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
