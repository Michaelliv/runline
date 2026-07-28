import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { registerObjectActions } from "./objects.js";

/**
 * Shift Objects — the organization's durable object bucket in the
 * Shift cloud: upload binary files through signed grants, mint
 * download grants, and record append-only provenance links. The API
 * key is the tenant authority; the cloud derives the organization from
 * it (SHFT-852), so no org ID is sent.
 */
export default function shiftObjects(rl: RunlinePluginAPI) {
  rl.setName("shiftObjects");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema(
    t.Object({
      apiKey: t.String({
        description: "Shift Labs API key",
        env: "SHIFT_LABS_API_KEY",
      }),
    }),
  );

  registerObjectActions(rl);
}
