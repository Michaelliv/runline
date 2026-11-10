import { shiftClient } from "../../_shared/shiftCredentials.js";

// Deploys wait for the build (up to about a minute) before answering.
export const { credential: shiftWorkersCredential, request } = shiftClient(
  "shiftWorkers",
  { probe: "services/workers/apps", timeoutMs: 120_000 },
);
