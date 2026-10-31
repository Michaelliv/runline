import { shiftClient } from "../../_shared/shiftCredentials.js";

/**
 * Extraction runs synchronously; a long multi-page PDF takes minutes, not
 * seconds. The target declares that deadline so the transport holds the
 * request open for the whole extraction.
 */
export const EXTRACT_TIMEOUT_MS = 5 * 60_000;

export const { credential: shiftOcrCredential, request } = shiftClient(
  "shiftOcr",
  { timeoutMs: EXTRACT_TIMEOUT_MS },
);
