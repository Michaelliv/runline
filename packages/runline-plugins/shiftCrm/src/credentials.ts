import { shiftClient } from "../../_shared/shiftCredentials.js";

/**
 * A user-subject Shift CRM API key, signed like every Shift key. The probe
 * reads the key's own CRM access: a key without a grant is rejected there.
 */
export const { credential: shiftCrmCredential, request } = shiftClient(
  "shiftCrm",
  { probe: "crm/access/me" },
);
