import { shiftClient } from "../../_shared/shiftCredentials.js";

export const { credential: shiftObjectsCredential, request } =
  shiftClient("shiftObjects");
